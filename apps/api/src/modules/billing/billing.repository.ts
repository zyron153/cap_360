import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { Prisma, PaymentMethod, InvoiceStatus } from "@cap/database";

@Injectable()
export class BillingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    // Session-level advisory lock keyed on year prevents duplicate numbers under concurrent load.
    // Lock is released automatically at transaction end or session close.
    await this.prisma.$executeRaw`SELECT pg_advisory_lock(${year}::bigint)`;
    const result = await this.prisma.$queryRaw<[{ next_seq: bigint }]>`
      SELECT (SELECT COUNT(*) FROM invoices
              WHERE "createdAt" >= ${new Date(`${year}-01-01`)}
                AND "createdAt" <  ${new Date(`${year + 1}-01-01`)}) + 1 AS next_seq
    `;
    const seq = String(Number(result[0].next_seq)).padStart(4, "0");
    await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${year}::bigint)`;
    return `INV-${year}-${seq}`;
  }

  create(data: Prisma.InvoiceCreateInput) {
    return this.prisma.invoice.create({
      data,
      include: { items: true, payments: true },
    });
  }

  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: { include: { service: { select: { name: true } } } },
        payments: true,
        patient: { select: { id: true, fullName: true, phone: true, nif: true } },
      },
    });
    if (!invoice) return invoice;
    // patient.nif is stored encrypted — decrypt for the invoice preview / receipt PDF
    return {
      ...invoice,
      patient: {
        ...invoice.patient,
        nif: invoice.patient.nif ? this.encryption.decrypt(invoice.patient.nif) : invoice.patient.nif,
      },
    };
  }

  findByIdLite(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, total: true, invoiceNumber: true },
    });
  }

  findMany(args: Prisma.InvoiceFindManyArgs) {
    return this.prisma.invoice.findMany(args);
  }

  count(args: Prisma.InvoiceCountArgs) {
    return this.prisma.invoice.count(args);
  }

  update(id: string, data: Prisma.InvoiceUpdateInput) {
    return this.prisma.invoice.update({
      where: { id },
      data,
      include: { items: true, payments: true },
    });
  }

  /** Looks up a payment by its client-supplied idempotency key and returns its invoice's
   * current state, shaped exactly like recordPaymentAtomic's return — a retried request just
   * replays the original outcome instead of erroring or recording a second payment. */
  async findPaymentReplay(idempotencyKey: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      select: { invoice: { select: { id: true, status: true, amountPaid: true } } },
    });
    return payment?.invoice ?? null;
  }

  /**
   * Inserts the payment, re-sums, and updates the invoice's status/amountPaid in one DB
   * transaction — a concurrent payment on the same invoice can no longer read a stale sum
   * between the insert and the status update, since both happen inside the same transaction.
   */
  recordPaymentAtomic(
    invoiceId: string,
    payment: { amount: number; method: PaymentMethod; reference?: string; paidAt: Date; idempotencyKey?: string },
    invoiceTotal: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          invoice: { connect: { id: invoiceId } },
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          paidAt: payment.paidAt,
          idempotencyKey: payment.idempotencyKey,
        },
      });

      const { _sum } = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      const totalPaid = Number(_sum.amount ?? 0);
      const amountDue = invoiceTotal - totalPaid;
      const status: InvoiceStatus = amountDue <= 0 ? "paid" : totalPaid > 0 ? "partially_paid" : "issued";

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: totalPaid, status },
        select: { id: true, status: true, amountPaid: true },
      });
    });
  }

  findServiceById(serviceId: string) {
    return this.prisma.service.findUnique({ where: { id: serviceId } });
  }
}
