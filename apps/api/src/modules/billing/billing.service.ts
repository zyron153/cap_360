import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { PrismaService } from "../../prisma/prisma.service";
import { generateReceiptPdf } from "./receipt.pdf";
import { InvoiceStatus } from "@cap/database";
import {
  CreateInvoiceDto,
  RecordPaymentDto,
  InvoiceListQuery,
} from "@cap/types";

@Injectable()
export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly r2: R2Service,
    private readonly prisma: PrismaService,
    @InjectQueue("efatura") private readonly efaturaQueue: Queue,
  ) {}

  async create(dto: CreateInvoiceDto) {
    let subtotal = 0;
    const itemsData = [];

    for (const item of dto.items) {
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

    const invoiceNumber = await this.repo.nextInvoiceNumber();

    const invoice = await this.repo.create({
      invoiceNumber,
      patient: { connect: { id: dto.patientId } },
      ...(dto.appointmentId
        ? { appointment: { connect: { id: dto.appointmentId } } }
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

  async recordPayment(invoiceId: string, dto: RecordPaymentDto) {
    const invoice = await this.repo.findByIdLite(invoiceId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (["paid", "cancelled"].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot record payment on a ${invoice.status} invoice`
      );
    }

    await this.repo.createPayment({
      invoice: { connect: { id: invoiceId } },
      amount: dto.amount,
      method: dto.method as never,
      reference: dto.reference,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
    });

    const { _sum } = await this.repo.sumPayments(invoiceId);
    const totalPaid = Number(_sum.amount ?? 0);
    const amountDue = Number(invoice.total) - totalPaid;

    let newStatus: string;
    if (amountDue <= 0) {
      newStatus = "paid";
    } else if (totalPaid > 0) {
      newStatus = "partially_paid";
    } else {
      newStatus = "issued";
    }

    return this.repo.updateStatus(invoiceId, {
      amountPaid: totalPaid,
      status: newStatus as never,
    });
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
      patient: invoice.patient,
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
