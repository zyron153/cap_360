import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { PrismaService } from "../../prisma/prisma.service";
import { EFaturaService } from "./efatura.service";
import { EncryptionService } from "../../common/services/encryption.service";
import type { EFaturaSubmitJob, EFaturaCancelJob } from "./efatura.types";

@Processor("efatura")
export class EFaturaProcessor {
  private readonly logger = new Logger(EFaturaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly efatura: EFaturaService,
    private readonly encryption: EncryptionService,
  ) {}

  @Process("submit")
  async handleSubmit(job: Job<EFaturaSubmitJob>) {
    const { invoiceId } = job.data;

    // Mark as submitting
    await this.prisma.eFaturaSubmission.upsert({
      where: { invoiceId },
      create: { invoiceId, status: "submitting" },
      update: { status: "submitting", retryCount: { increment: 1 } },
    });

    const cfg = await this.efatura.getConfig();
    if (!cfg) {
      // E-Factura not configured — leave as pending, don't fail the job
      await this.prisma.eFaturaSubmission.update({
        where: { invoiceId },
        data: { status: "pending" },
      });
      this.logger.warn(`E-Factura not configured — skipping invoice ${invoiceId}`);
      return;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        patient: { select: { fullName: true, nif: true } },
        items: true,
      },
    });

    if (!invoice) {
      this.logger.error(`Invoice ${invoiceId} not found`);
      await this.prisma.eFaturaSubmission.update({
        where: { invoiceId },
        data: { status: "error", errorMessage: "Invoice not found" },
      });
      return;
    }

    try {
      // patient.nif is stored encrypted — decrypt before it ever reaches the tax authority payload.
      // fullName can be null if the patient was erased (right to erasure) since this invoice was
      // issued — "Consumidor final" mirrors how e-invoicing systems report anonymous customers.
      const patient = {
        ...invoice.patient,
        fullName: invoice.patient.fullName ?? "Consumidor final",
        nif: invoice.patient.nif ? this.encryption.decrypt(invoice.patient.nif) : invoice.patient.nif,
      };
      const payload = this.efatura.buildPayload(cfg, {
        invoiceNumber: invoice.invoiceNumber,
        issuedAt: invoice.issuedAt,
        patient,
        items: invoice.items.map(item => ({
          ...item,
          unitPrice: Number(item.unitPrice),
          total: Number(item.total),
        })),
        subtotal: Number(invoice.subtotal),
        total: Number(invoice.total),
      });

      const result = await this.efatura.submitInvoice(cfg, payload);

      await this.prisma.eFaturaSubmission.update({
        where: { invoiceId },
        data: {
          status: result.status === "accepted" ? "accepted" : result.status === "pending" ? "pending" : "rejected",
          atcud: result.atcud,
          efaturaRef: result.referencia,
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
          submittedAt: new Date(),
          acceptedAt: result.status === "accepted" ? new Date() : null,
        },
      });

      this.logger.log(`Invoice ${invoice.invoiceNumber} submitted — ATCUD: ${result.atcud}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`E-Factura submission failed for ${invoiceId}: ${msg}`);

      await this.prisma.eFaturaSubmission.update({
        where: { invoiceId },
        data: {
          status: "error",
          errorMessage: msg.slice(0, 500),
          submittedAt: new Date(),
        },
      });

      throw err; // let Bull retry (attempts: 3 configured in BillingService)
    }
  }

  @Process("cancel")
  async handleCancel(job: Job<EFaturaCancelJob>) {
    const { invoiceId, efaturaRef } = job.data;

    const cfg = await this.efatura.getConfig();
    if (!cfg) return;

    try {
      await this.efatura.cancelInvoice(cfg, efaturaRef);

      await this.prisma.eFaturaSubmission.update({
        where: { invoiceId },
        data: { status: "cancelled" },
      });

      this.logger.log(`Invoice ${invoiceId} cancelled on E-Factura`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`E-Factura cancel failed for ${invoiceId}: ${msg}`);
      throw err;
    }
  }
}
