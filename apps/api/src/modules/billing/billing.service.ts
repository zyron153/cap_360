import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { PrismaService } from "../../prisma/prisma.service";
import { generateReceiptPdf } from "./receipt.pdf";
import { InvoiceStatus } from "@cap/database";
import { RequestContext } from "../../common/context/request-context";
import {
  CreateInvoiceDto,
  RecordPaymentDto,
  InvoiceListQuery,
} from "@cap/types";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly repo: BillingRepository,
    private readonly r2: R2Service,
    private readonly prisma: PrismaService,
    @InjectQueue("efatura") private readonly efaturaQueue: Queue,
  ) {}

  async create(dto: CreateInvoiceDto, callerRoles: string[] = []) {
    let subtotal = 0;
    const itemsData = [];
    const overrides: { serviceId: string; cataloguePrice: number; billedPrice: number }[] = [];

    for (const item of dto.items) {
      // Custom/off-catalogue line items (no serviceId) aren't an "override" — there's no
      // catalogue price to compare against, so anyone who can create invoices still can.
      // A catalogued service billed at a different price than Service.price IS an override,
      // and only admin may do that — everyone else must bill at the catalogue price.
      if (item.serviceId) {
        const catalogueService = await this.repo.findServiceById(item.serviceId);
        if (catalogueService && Number(catalogueService.price) !== item.unitPrice) {
          if (!callerRoles.includes("admin")) {
            throw new ForbiddenException(
              `Only an admin can bill service ${item.serviceId} at a price other than the catalogue price`
            );
          }
          overrides.push({
            serviceId: item.serviceId,
            cataloguePrice: Number(catalogueService.price),
            billedPrice: item.unitPrice,
          });
          this.logger.warn(
            `Invoice price override for patient ${dto.patientId}: service ${item.serviceId} ` +
            `catalogue price ${catalogueService.price}, billed at ${item.unitPrice}`
          );
        }
      }

      const total = item.unitPrice * item.quantity;
      subtotal += total;
      itemsData.push({
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total,
      });
    }

    // No hard price floor — an admin may still bill below catalogue — but underpricing must be
    // explained, not silent. Overpricing needs no reason: raising a price isn't the risk here.
    const underpriced = overrides.some((o) => o.billedPrice < o.cataloguePrice);
    if (underpriced && !dto.priceOverrideReason) {
      throw new BadRequestException(
        "priceOverrideReason is required when billing a service below its catalogue price"
      );
    }
    if (overrides.length > 0) {
      // Not really a before/after (this is a create) — piggybacking on the same audit-metadata
      // mechanism the rest of the app uses for mutations, with the override info in the "after" slot.
      RequestContext.setAuditDiff(null, { priceOverrides: overrides, reason: dto.priceOverrideReason ?? null });
    }

    const invoiceNumber = await this.repo.nextInvoiceNumber();

    const invoice = await this.repo.create({
      invoiceNumber,
      patient: { connect: { id: dto.patientId } },
      ...(dto.appointmentId
        ? { appointment: { connect: { id: dto.appointmentId } } }
        : {}),
      ...(dto.healthPlanId
        ? { healthPlan: { connect: { id: dto.healthPlanId } } }
        : {}),
      subtotal,
      total: subtotal,
      status: "issued",
      issuedAt: new Date(),
      notes: dto.notes,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      items: { create: itemsData },
    });

    // Create pending submission record then enqueue (fire-and-forget)
    await this.prisma.eFaturaSubmission.create({
      data: { invoiceId: invoice.id, status: "pending" },
    });
    await this.efaturaQueue.add(
      "submit",
      { invoiceId: invoice.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5_000 } }
    );

    return invoice;
  }

  async findById(id: string) {
    const invoice = await this.repo.findById(id);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async findAll(query: InvoiceListQuery) {
    const { patientId, status, from, to, page, limit } = query;
    const skip = (page - 1) * limit;

    const where = {
      ...(patientId ? { patientId } : {}),
      ...(status ? { status: status as InvoiceStatus } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.repo.findMany({
        where,
        skip,
        take: limit,
        include: {
          patient: { select: { id: true, fullName: true } },
          efaturaSubmission: { select: { status: true, atcud: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.repo.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getEFaturaStatus(invoiceId: string) {
    const submission = await this.prisma.eFaturaSubmission.findUnique({
      where: { invoiceId },
    });
    if (!submission) throw new NotFoundException("No E-Factura submission for this invoice");
    return submission;
  }

  async retryEFatura(invoiceId: string) {
    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    await this.prisma.eFaturaSubmission.upsert({
      where: { invoiceId },
      create: { invoiceId, status: "pending" },
      update: { status: "pending", errorCode: null, errorMessage: null },
    });

    await this.efaturaQueue.add(
      "submit",
      { invoiceId },
      { attempts: 3, backoff: { type: "exponential", delay: 5_000 } }
    );

    return { queued: true };
  }

  async cancel(invoiceId: string) {
    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (invoice.status === "cancelled") return invoice; // idempotent — already cancelled
    if (invoice.status === "paid") {
      throw new BadRequestException("Cannot cancel a fully paid invoice");
    }

    // Already reported to the tax authority — cancel it there too, via the same async
    // queue+processor the submit/retry flow already uses.
    const submission = await this.prisma.eFaturaSubmission.findUnique({ where: { invoiceId } });
    if (submission?.status === "accepted" && submission.efaturaRef) {
      await this.efaturaQueue.add(
        "cancel",
        { invoiceId, efaturaRef: submission.efaturaRef },
        { attempts: 3, backoff: { type: "exponential", delay: 5_000 } }
      );
    }

    return this.repo.update(invoiceId, { status: "cancelled" });
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto) {
    // Checked first, before the invoice even loads: a retried request (double-click, client
    // timeout retry) must replay the original outcome, not re-validate against state that the
    // original request may have already changed (e.g. this payment is what made it "paid").
    if (dto.idempotencyKey) {
      const replay = await this.repo.findPaymentReplay(dto.idempotencyKey);
      if (replay) return replay;
    }

    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (["paid", "cancelled"].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot record payment on a ${invoice.status} invoice`
      );
    }

    // Insert + re-sum + status update all happen inside one transaction (BillingRepository) —
    // a concurrent payment on this invoice can't read a stale sum between the two steps.
    return this.repo.recordPaymentAtomic(
      invoiceId,
      {
        amount: dto.amount,
        method: dto.method as never,
        reference: dto.reference,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        idempotencyKey: dto.idempotencyKey,
      },
      Number(invoice.total)
    );
  }

  async createDraft(data: {
    patientId: string;
    appointmentId: string;
    serviceId: string;
    serviceName: string;
    unitPrice: number;
  }) {
    const invoiceNumber = await this.repo.nextInvoiceNumber();
    return this.repo.create({
      invoiceNumber,
      patient: { connect: { id: data.patientId } },
      appointment: { connect: { id: data.appointmentId } },
      subtotal: data.unitPrice,
      total: data.unitPrice,
      status: "draft",
      items: {
        create: [{
          serviceId: data.serviceId,
          description: data.serviceName,
          quantity: 1,
          unitPrice: data.unitPrice,
          total: data.unitPrice,
        }],
      },
    });
  }

  // Configurações → Clínica is the single source of truth for the clinic's identity.
  // Falls back to placeholder values if the admin hasn't saved it yet, so receipt
  // generation never hard-fails on missing config.
  private async getClinicInfo() {
    const row = await this.prisma.setting.findUnique({ where: { key: "clinic" } });
    const clinic = row?.value as { name?: string; nif?: string; address?: string; phone?: string; email?: string } | undefined;
    return {
      name: clinic?.name || "CAP",
      nif: clinic?.nif || "—",
      address: clinic?.address || "Cabo Verde",
      phone: clinic?.phone || "—",
      email: clinic?.email || "—",
    };
  }

  async getReceiptUrl(invoiceId: string): Promise<{ url: string }> {
    const invoice = await this.repo.findById(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (!this.r2.isConfigured()) {
      return { url: `https://files.cap.cv/receipts/${invoice.invoiceNumber}.pdf` };
    }

    if (invoice.pdfR2Key) {
      return { url: await this.r2.signedUrl(invoice.pdfR2Key) };
    }

    const clinic = await this.getClinicInfo();
    const pdf = await generateReceiptPdf({
      clinic,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      // patient fields can be null here — right-to-erasure nulls them on soft-delete while the
      // invoice itself is retained for legal/billing reasons (see PatientsRepository.softDelete).
      patient: {
        fullName: invoice.patient.fullName ?? "Paciente removido",
        phone: invoice.patient.phone ?? "—",
      },
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
      })),
      subtotal: Number(invoice.subtotal),
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      status: invoice.status,
    });

    const key = `receipts/${invoice.invoiceNumber}.pdf`;
    await this.r2.upload(key, pdf, "application/pdf");
    await this.repo.update(invoiceId, { pdfR2Key: key });

    return { url: await this.r2.signedUrl(key) };
  }
}
