import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { PrismaService } from "../../prisma/prisma.service";
import { HealthPlansService } from "../health-plans/health-plans.service";
import { ServicesService } from "../services/services.service";
import { ParametrizacaoService } from "../parametrizacao/parametrizacao.service";
import { EFaturaService } from "../efatura/efatura.service";
import { cvDayStart, cvDayEnd } from "../../common/cabo-verde-time";
import { generateReceiptPdf } from "./receipt.pdf";
import { InvoiceStatus } from "@cap/database";
import { RequestContext } from "../../common/context/request-context";
import {
  CreateInvoiceDto,
  RecordPaymentDto,
  InvoiceListQuery,
  UpdateInvoiceItemDto,
  CreateDraftServiceDto,
} from "@cap/types";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly repo: BillingRepository,
    private readonly r2: R2Service,
    private readonly prisma: PrismaService,
    private readonly healthPlansService: HealthPlansService,
    private readonly servicesService: ServicesService,
    private readonly parametrizacaoService: ParametrizacaoService,
    private readonly efatura: EFaturaService,
  ) {}

  /** Nova Fatura's "sem preço definido" flow: creates the missing Service and links it back to
   * the TIPO_SERVICO Parametrizacao entry that triggered it, as one step — see CreateDraftServiceSchema. */
  async createDraftService(dto: CreateDraftServiceDto) {
    // durationMinutes isn't collected in the Nova Fatura flow this serves — 30 matches
    // CreateServiceSchema's own default for the same field on the admin-facing endpoint.
    const service = await this.servicesService.create({ name: dto.name, code: dto.code, price: dto.price, durationMinutes: 30 });
    await this.parametrizacaoService.update(dto.parametrizacaoId, { codigo: service.id });
    return service;
  }

  /** Appends a negative "Desconto Plano de Saúde" line to `itemsData` when the patient has an
   * active health plan with a coverage % configured, keeping catalogue-price items untouched for
   * auditability. Returns the (possibly reduced) subtotal and a healthPlanId to connect the
   * invoice to, if one wasn't already supplied. Applied identically at manual creation and at the
   * appointment-completion auto-draft — a patient's coverage shouldn't depend on which path built
   * the invoice. */
  private async applyHealthPlanDiscount(
    patientId: string,
    subtotal: number,
    itemsData: { serviceId?: string | null; description: string; quantity: number; unitPrice: number; total: number }[],
    explicitHealthPlanId?: string
  ): Promise<{ subtotal: number; healthPlanId?: string }> {
    if (subtotal <= 0) return { subtotal, healthPlanId: explicitHealthPlanId };

    const coverage = await this.healthPlansService.getActiveCoverage(patientId);
    if (!coverage) return { subtotal, healthPlanId: explicitHealthPlanId };

    const discountAmount = Math.round(subtotal * (coverage.coveragePercent / 100) * 100) / 100;
    if (discountAmount <= 0) return { subtotal, healthPlanId: explicitHealthPlanId };

    itemsData.push({
      serviceId: null,
      description: `Desconto Plano de Saúde (${coverage.coveragePercent}%) — ${coverage.productName}`,
      quantity: 1,
      unitPrice: -discountAmount,
      total: -discountAmount,
    });

    return {
      subtotal: subtotal - discountAmount,
      healthPlanId: explicitHealthPlanId ?? coverage.healthPlanId,
    };
  }

  /** nextInvoiceNumber() is race-safe only up to its own transaction; two concurrent creates can
   * still read the same COUNT. The unique index catches that, so a collision just takes the next number. */
  private async createNumbered(build: (invoiceNumber: string) => Parameters<BillingRepository["create"]>[0]) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.repo.create(build(await this.repo.nextInvoiceNumber()));
      } catch (e) {
        const dup = (e as { code?: string; meta?: { target?: unknown } })?.code === "P2002" && String((e as { meta?: { target?: unknown } }).meta?.target).includes("invoiceNumber");
        if (!dup || attempt >= 4) throw e;
      }
    }
  }

  async create(dto: CreateInvoiceDto, callerRoles: string[] = []) {
    let subtotal = 0;
    const itemsData: { serviceId?: string | null; description: string; quantity: number; unitPrice: number; total: number }[] = [];
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

    const discounted = await this.applyHealthPlanDiscount(dto.patientId, subtotal, itemsData, dto.healthPlanId);
    subtotal = discounted.subtotal;

    // The fiscal-document row is created in the same insert as the invoice (atomic); the job that
    // sends it is queued afterwards, and the sweeper covers a failed enqueue.
    const issuedAt = new Date();
    const { enabled, goLiveAt } = await this.efatura.reporting();
    const report = enabled && (!goLiveAt || issuedAt >= goLiveAt);

    const invoice = await this.createNumbered((invoiceNumber) => ({
      invoiceNumber,
      patient: { connect: { id: dto.patientId } },
      ...(dto.appointmentId
        ? { appointment: { connect: { id: dto.appointmentId } } }
        : {}),
      ...(discounted.healthPlanId
        ? { healthPlan: { connect: { id: discounted.healthPlanId } } }
        : {}),
      subtotal,
      total: subtotal,
      status: "issued",
      issuedAt,
      notes: dto.notes,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      items: { create: itemsData },
      ...(report ? { efaturaSubmissions: { create: { purpose: "issue" } } } : {}),
    }));

    for (const s of invoice.efaturaSubmissions) await this.efatura.enqueue(s.id);
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
              ...(from ? { gte: cvDayStart(from) } : {}),
              ...(to ? { lte: cvDayEnd(to) } : {}),
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
          efaturaSubmissions: { where: { purpose: "issue" }, select: { status: true, iud: true, documentTypeCode: true } },
          appointment: { select: { id: true, scheduledAt: true, service: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.repo.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** The invoice's own fiscal document (FTE/FRE/TVE). */
  async getEFaturaStatus(invoiceId: string) {
    const submission = await this.efatura.primaryFor(invoiceId);
    if (!submission) throw new NotFoundException("No E-Factura submission for this invoice");
    return submission;
  }

  /** Every fiscal document sent for the invoice: the issue document, receipts, credit notes, cancel events. */
  getEFaturaDocuments(invoiceId: string) {
    return this.efatura.documents(invoiceId);
  }

  async retryEFatura(invoiceId: string) {
    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    const count = await this.efatura.retry(invoiceId);
    return { queued: count > 0, count };
  }

  async cancel(invoiceId: string, reason: string) {
    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (invoice.status === "cancelled") return invoice; // idempotent — already cancelled
    if (invoice.status === "paid") {
      throw new BadRequestException("Cannot cancel a fully paid invoice");
    }

    // The invoice and its fiscal documents change together or not at all. Nothing sent to DNRE is
    // ever cancelled locally without telling DNRE: an authorized document is voided with an FDC
    // event (nothing paid) or reversed with a credit note (partially paid); one that never got
    // authorized is just cancelled here and will never be sent.
    RequestContext.setAuditDiff({ status: invoice.status }, { status: "cancelled", cancelReason: reason });
    const { invoice: updated, efaturaIds } = await this.repo.cancelAtomic(
      invoiceId,
      { status: "cancelled", cancelReason: reason, cancelledAt: new Date() },
      (tx) => this.efatura.planVoid(tx, invoiceId, reason, Number(invoice.amountPaid) > 0)
    );
    for (const id of efaturaIds) await this.efatura.enqueue(id);
    return updated;
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto, recordedById?: string) {
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

    // A draft invoice (the appointment-completion auto-invoice) was never issued or reported to
    // e-Fatura the way create() issues a manual one — its first payment is what makes it real,
    // so that is when its fiscal document is created. Every payment on a reported invoice also
    // gets a receipt row (it becomes an RCE, or turns out redundant if the invoice was an FRE/TVE).
    const wasDraft = invoice.status === "draft";
    const { enabled, goLiveAt } = await this.efatura.reporting();

    // Insert + re-sum + status update + fiscal rows all happen inside one transaction
    // (BillingRepository) — a concurrent payment can't read a stale sum between the steps.
    const { efaturaIds, ...result } = await this.repo.recordPaymentAtomic(
      invoiceId,
      {
        amount: dto.amount,
        method: dto.method as never,
        reference: dto.reference,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        idempotencyKey: dto.idempotencyKey,
        recordedById,
      },
      Number(invoice.total),
      wasDraft,
      { enabled, issueNew: enabled && (!goLiveAt || new Date() >= goLiveAt) }
    );

    for (const id of efaturaIds) await this.efatura.enqueue(id);
    return result;
  }

  async createDraft(data: {
    patientId: string;
    appointmentId: string;
    serviceId: string;
    serviceName: string;
    unitPrice: number;
  }) {
    const itemsData: { serviceId?: string | null; description: string; quantity: number; unitPrice: number; total: number }[] = [{
      serviceId: data.serviceId,
      description: data.serviceName,
      quantity: 1,
      unitPrice: data.unitPrice,
      total: data.unitPrice,
    }];
    const discounted = await this.applyHealthPlanDiscount(data.patientId, data.unitPrice, itemsData);

    return this.createNumbered((invoiceNumber) => ({
      invoiceNumber,
      patient: { connect: { id: data.patientId } },
      appointment: { connect: { id: data.appointmentId } },
      ...(discounted.healthPlanId
        ? { healthPlan: { connect: { id: discounted.healthPlanId } } }
        : {}),
      subtotal: discounted.subtotal,
      total: discounted.subtotal,
      status: "draft",
      items: {
        create: itemsData,
      },
    }));
  }

  /**
   * Edits one draft-invoice line item. Duration-driven edits (from the appointment-completion
   * flow or the invoice UI) recompute the price proportionally to the service's standard
   * duration and are never treated as an override — they follow the same pricing rule the
   * catalogue price itself represents, just scaled by actual time spent. A direct manual
   * unitPrice edit on a catalogued item, however, is subject to the same admin-only /
   * reason-required rule as create() — otherwise this endpoint would be a back door around it.
   */
  async updateItem(
    invoiceId: string,
    itemId: string,
    dto: UpdateInvoiceItemDto,
    callerRoles: string[] = []
  ) {
    const item = await this.repo.findItemForUpdate(invoiceId, itemId);
    if (!item) throw new NotFoundException(`Invoice item ${itemId} not found`);
    if (item.invoice.status !== "draft") {
      throw new BadRequestException("Only draft invoices can have their line items edited");
    }

    let unitPrice = dto.unitPrice ?? Number(item.unitPrice);
    const quantity = dto.quantity ?? item.quantity;
    let appointmentUpdate: { appointmentId: string; durationMinutes: number } | undefined;

    if (dto.durationMinutes !== undefined) {
      if (!item.invoice.appointmentId || !item.serviceId) {
        throw new BadRequestException(
          "Duration can only be edited on a line item generated from an appointment"
        );
      }
      const appointment = await this.repo.findAppointmentWithService(item.invoice.appointmentId);
      if (!appointment?.service || appointment.serviceId !== item.serviceId) {
        throw new BadRequestException("Could not resolve the service used to price this appointment");
      }
      const standardDuration = appointment.service.durationMinutes || dto.durationMinutes;
      unitPrice =
        Math.round((dto.durationMinutes / standardDuration) * Number(appointment.service.price) * 100) / 100;
      appointmentUpdate = { appointmentId: item.invoice.appointmentId, durationMinutes: dto.durationMinutes };
    } else if (dto.unitPrice !== undefined && item.serviceId) {
      const catalogueService = await this.repo.findServiceById(item.serviceId);
      if (catalogueService && Number(catalogueService.price) !== dto.unitPrice) {
        if (!callerRoles.includes("admin")) {
          throw new ForbiddenException(
            `Only an admin can bill service ${item.serviceId} at a price other than the catalogue price`
          );
        }
        if (dto.unitPrice < Number(catalogueService.price) && !dto.priceOverrideReason) {
          throw new BadRequestException(
            "priceOverrideReason is required when billing a service below its catalogue price"
          );
        }
        RequestContext.setAuditDiff(
          { unitPrice: Number(item.unitPrice) },
          { unitPrice: dto.unitPrice, reason: dto.priceOverrideReason ?? null }
        );
      }
    }

    const total = Math.round(unitPrice * quantity * 100) / 100;
    return this.repo.updateItemAtomic(invoiceId, itemId, { quantity, unitPrice, total }, appointmentUpdate);
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
        nif: invoice.patient.nif ?? null,
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
