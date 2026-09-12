import { Injectable, BadRequestException } from "@nestjs/common";
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
    // pg_advisory_xact_lock (transaction-scoped, auto-released at commit/rollback — no manual
    // unlock to forget) inside $transaction, which pins one physical connection for the whole
    // callback. Plain pg_advisory_lock/unlock as two separate top-level calls was a real bug:
    // Prisma's pool doesn't guarantee they land on the same connection, so the unlock could
    // silently no-op on a different session while the lock-holding connection went back to the
    // pool still holding it — a permanent deadlock for every future call, reproduced live in this
    // dev DB (idle connection holding the lock, three others blocked on it indefinitely).
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${year}::bigint)`;
      const result = await tx.$queryRaw<[{ next_seq: bigint }]>`
        SELECT (SELECT COUNT(*) FROM invoices
                WHERE "createdAt" >= ${new Date(`${year}-01-01`)}
                  AND "createdAt" <  ${new Date(`${year + 1}-01-01`)}) + 1 AS next_seq
      `;
      const seq = String(Number(result[0].next_seq)).padStart(4, "0");
      return `INV-${year}-${seq}`;
    });
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
        payments: { include: { recordedBy: { select: { id: true, fullName: true } } } },
        patient: { select: { id: true, fullName: true, phone: true, nif: true } },
        appointment: {
          select: { id: true, serviceId: true, durationMinutes: true, service: { select: { durationMinutes: true } } },
        },
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
    payment: { amount: number; method: PaymentMethod; reference?: string; paidAt: Date; idempotencyKey?: string; recordedById?: string },
    invoiceTotal: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          invoiceId,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          paidAt: payment.paidAt,
          idempotencyKey: payment.idempotencyKey,
          recordedById: payment.recordedById,
        },
      });

      const { _sum } = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      const totalPaid = Number(_sum.amount ?? 0);

      // Nothing previously stopped a payment from pushing amountPaid past the invoice total —
      // throwing inside the transaction rolls back the payment insert above along with it.
      if (totalPaid > invoiceTotal) {
        throw new BadRequestException(
          `This payment would bring the total paid (${totalPaid}) above the invoice total (${invoiceTotal})`
        );
      }

      const amountDue = invoiceTotal - totalPaid;
      const status: InvoiceStatus = amountDue <= 0 ? "paid" : totalPaid > 0 ? "partially_paid" : "issued";

      return tx.invoice.update({
        where: { id: invoiceId },
        // pdfR2Key: null invalidates any previously-cached receipt — getReceiptUrl only
        // regenerates when it's unset, so a stale receipt showing the pre-payment balance would
        // otherwise keep being served after this payment changes amountPaid/status.
        data: { amountPaid: totalPaid, status, pdfR2Key: null },
        select: { id: true, status: true, amountPaid: true },
      });
    });
  }

  findServiceById(serviceId: string) {
    return this.prisma.service.findUnique({ where: { id: serviceId } });
  }

  findItemForUpdate(invoiceId: string, itemId: string) {
    return this.prisma.invoiceItem.findFirst({
      where: { id: itemId, invoiceId },
      include: { invoice: { select: { status: true, appointmentId: true } } },
    });
  }

  findAppointmentWithService(appointmentId: string) {
    return this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        serviceId: true,
        service: { select: { price: true, durationMinutes: true } },
      },
    });
  }

  /**
   * Updates one line item, optionally the appointment's actual duration alongside it, then
   * re-sums every item on the invoice into its subtotal/total — all inside one transaction so a
   * concurrent payment or item edit can't read a stale total in between.
   */
  updateItemAtomic(
    invoiceId: string,
    itemId: string,
    itemData: { quantity: number; unitPrice: number; total: number },
    appointmentUpdate?: { appointmentId: string; durationMinutes: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceItem.update({ where: { id: itemId }, data: itemData });

      if (appointmentUpdate) {
        await tx.appointment.update({
          where: { id: appointmentUpdate.appointmentId },
          data: { durationMinutes: appointmentUpdate.durationMinutes },
        });
      }

      const items = await tx.invoiceItem.findMany({ where: { invoiceId }, select: { total: true } });
      const total = items.reduce((sum, i) => sum + Number(i.total), 0);

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { subtotal: total, total },
        include: { items: true, payments: true },
      });
    });
  }
}
