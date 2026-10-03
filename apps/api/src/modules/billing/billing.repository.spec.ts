import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { BillingRepository } from "./billing.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "d".repeat(64);

const tx = {
  payment: { create: jest.fn(), aggregate: jest.fn() },
  invoice: { update: jest.fn() },
  invoiceItem: { update: jest.fn(), findMany: jest.fn() },
  appointment: { update: jest.fn() },
  eFaturaSubmission: { findFirst: jest.fn(), create: jest.fn() },
};

const prisma = {
  invoice: { findUnique: jest.fn() },
  $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
};

describe("BillingRepository — patient NIF decryption on findById", () => {
  let repo: BillingRepository;
  let encryption: EncryptionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        BillingRepository,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(BillingRepository);
    encryption = mod.get(EncryptionService);
    jest.clearAllMocks();
  });

  describe("recordPaymentAtomic — payment insert + status update in one transaction", () => {
    beforeEach(() => {
      tx.payment.create.mockResolvedValue({});
      tx.invoice.update.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000" });
    });

    it("does all writes inside a single $transaction, not as separate round-trips", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2000" } });
      await repo.recordPaymentAtomic("inv-1", { amount: 2000, method: "cash" as never, paidAt: new Date() }, 2000);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.payment.create).toHaveBeenCalled();
      expect(tx.payment.aggregate).toHaveBeenCalled();
      expect(tx.invoice.update).toHaveBeenCalled();
    });

    it("computes status=paid from the post-insert sum, inside the transaction", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2000" } });
      await repo.recordPaymentAtomic("inv-1", { amount: 2000, method: "cash" as never, paidAt: new Date() }, 2000);
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "paid", amountPaid: 2000 }) })
      );
    });

    it("computes status=partially_paid when the running total is under the invoice total", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "500" } });
      await repo.recordPaymentAtomic("inv-1", { amount: 500, method: "cash" as never, paidAt: new Date() }, 2000);
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "partially_paid", amountPaid: 500 }) })
      );
    });

    it("rejects a payment that would push the running total above the invoice total", async () => {
      // The post-insert sum already reflects this payment — nothing stopped it from exceeding
      // the invoice total before this fix, leaving amountPaid > total on a "paid" invoice.
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2500" } });
      await expect(
        repo.recordPaymentAtomic("inv-1", { amount: 500, method: "cash" as never, paidAt: new Date() }, 2000)
      ).rejects.toThrow(BadRequestException);
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it("allows a payment that lands exactly on the invoice total", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2000" } });
      await expect(
        repo.recordPaymentAtomic("inv-1", { amount: 2000, method: "cash" as never, paidAt: new Date() }, 2000)
      ).resolves.toBeDefined();
    });

    it("invalidates any previously-cached receipt PDF on every payment, not just the final one", async () => {
      // A receipt generated after a partial payment must not keep being served once amountPaid
      // changes again — getReceiptUrl only regenerates when pdfR2Key is null.
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "500" } });
      await repo.recordPaymentAtomic("inv-1", { amount: 500, method: "cash" as never, paidAt: new Date() }, 2000);
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pdfR2Key: null }) })
      );
    });

    it("attributes the payment to the staff member who recorded it", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2000" } });
      await repo.recordPaymentAtomic(
        "inv-1",
        { amount: 2000, method: "cash" as never, paidAt: new Date(), recordedById: "staff-1" },
        2000
      );
      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recordedById: "staff-1" }) })
      );
    });
  });

  describe("recordPaymentAtomic — fiscal (e-Fatura) rows are written in the same transaction", () => {
    const pay = { amount: 500, method: "cash" as never, paidAt: new Date() };

    beforeEach(() => {
      tx.payment.create.mockResolvedValue({ id: "pay-1" });
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "500" } });
      tx.invoice.update.mockResolvedValue({ id: "inv-1", status: "partially_paid", amountPaid: "500", issuedAt: null });
      tx.eFaturaSubmission.create.mockImplementation(async ({ data }: { data: { purpose: string } }) => ({ id: `new-${data.purpose}`, ...data }));
    });

    it("writes nothing fiscal when e-Fatura is off", async () => {
      const r = await repo.recordPaymentAtomic("inv-1", pay, 2000, false);
      expect(tx.eFaturaSubmission.create).not.toHaveBeenCalled();
      expect(r.efaturaIds).toEqual([]);
    });

    it("adds a receipt row for a payment on an invoice that already has its issue document", async () => {
      tx.eFaturaSubmission.findFirst.mockResolvedValue({ id: "primary-1", status: "accepted" });

      const r = await repo.recordPaymentAtomic("inv-1", pay, 2000, false, { enabled: true, issueNew: true });

      expect(tx.eFaturaSubmission.create).toHaveBeenCalledTimes(1);
      expect(tx.eFaturaSubmission.create).toHaveBeenCalledWith({
        data: { invoiceId: "inv-1", purpose: "receipt", paymentId: "pay-1", referencesId: "primary-1" },
      });
      expect(r.efaturaIds).toEqual(["new-receipt"]);
    });

    it("a draft's first payment creates the issue document AND its receipt row", async () => {
      tx.eFaturaSubmission.findFirst.mockResolvedValue(null);

      const r = await repo.recordPaymentAtomic("inv-1", pay, 2000, true, { enabled: true, issueNew: true });

      expect(tx.eFaturaSubmission.create).toHaveBeenNthCalledWith(1, { data: { invoiceId: "inv-1", purpose: "issue" } });
      expect(tx.eFaturaSubmission.create).toHaveBeenNthCalledWith(
        2,
        { data: { invoiceId: "inv-1", purpose: "receipt", paymentId: "pay-1", referencesId: "new-issue" } }
      );
      expect(r.efaturaIds).toEqual(["new-issue", "new-receipt"]);
    });

    it("does not report a draft that is paid before the go-live date", async () => {
      tx.eFaturaSubmission.findFirst.mockResolvedValue(null);
      const r = await repo.recordPaymentAtomic("inv-1", pay, 2000, true, { enabled: true, issueNew: false });
      expect(tx.eFaturaSubmission.create).not.toHaveBeenCalled();
      expect(r.efaturaIds).toEqual([]);
    });

    it("does not report a payment on an invoice that was never reported", async () => {
      tx.eFaturaSubmission.findFirst.mockResolvedValue(null);
      await repo.recordPaymentAtomic("inv-1", pay, 2000, false, { enabled: true, issueNew: true });
      expect(tx.eFaturaSubmission.create).not.toHaveBeenCalled();
    });

    it("re-queues an issue document that was parked waiting for payment", async () => {
      tx.eFaturaSubmission.findFirst.mockResolvedValue({ id: "primary-1", status: "pending" });
      const r = await repo.recordPaymentAtomic("inv-1", pay, 2000, false, { enabled: true, issueNew: true });
      expect(r.efaturaIds).toEqual(["new-receipt", "primary-1"]);
    });

    it("a payment that exceeds the total still rolls back before any fiscal row is written", async () => {
      tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "2500" } });
      await expect(repo.recordPaymentAtomic("inv-1", pay, 2000, false, { enabled: true, issueNew: true })).rejects.toThrow(BadRequestException);
      expect(tx.eFaturaSubmission.create).not.toHaveBeenCalled();
    });
  });

  describe("cancelAtomic — invoice cancellation + fiscal planning in one transaction", () => {
    it("runs the planner and the invoice update inside the same transaction, planner first", async () => {
      const order: string[] = [];
      tx.invoice.update.mockImplementation(async () => (order.push("update"), { id: "inv-1", status: "cancelled" }));

      const r = await repo.cancelAtomic("inv-1", { status: "cancelled" }, async (t) => {
        expect(t).toBe(tx);
        order.push("plan");
        return ["void-1"];
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["plan", "update"]);
      expect(r).toEqual({ invoice: { id: "inv-1", status: "cancelled" }, efaturaIds: ["void-1"] });
    });

    it("does not cancel the invoice when the planner refuses (e.g. document being sent)", async () => {
      tx.invoice.update.mockClear();
      await expect(
        repo.cancelAtomic("inv-1", { status: "cancelled" }, async () => {
          throw new Error("em envio");
        })
      ).rejects.toThrow("em envio");
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe("updateItemAtomic — item edit + optional appointment duration in one transaction", () => {
    beforeEach(() => {
      tx.invoiceItem.update.mockResolvedValue({});
      tx.appointment.update.mockResolvedValue({});
      tx.invoice.update.mockResolvedValue({ id: "inv-1", subtotal: "2250", total: "2250" });
    });

    it("re-sums every item's total into the invoice's subtotal/total, inside one transaction", async () => {
      tx.invoiceItem.findMany.mockResolvedValue([{ total: "2250" }]);
      await repo.updateItemAtomic("inv-1", "item-1", { quantity: 1, unitPrice: 2250, total: 2250 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.invoiceItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "item-1" }, data: { quantity: 1, unitPrice: 2250, total: 2250 } })
      );
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { subtotal: 2250, total: 2250 } })
      );
      expect(tx.appointment.update).not.toHaveBeenCalled();
    });

    it("sums across multiple line items on the same invoice", async () => {
      tx.invoiceItem.findMany.mockResolvedValue([{ total: "2250" }, { total: "500" }]);
      await repo.updateItemAtomic("inv-1", "item-1", { quantity: 1, unitPrice: 2250, total: 2250 });
      expect(tx.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { subtotal: 2750, total: 2750 } })
      );
    });

    it("also updates the appointment's duration when a duration-driven edit is passed", async () => {
      tx.invoiceItem.findMany.mockResolvedValue([{ total: "2250" }]);
      await repo.updateItemAtomic(
        "inv-1", "item-1",
        { quantity: 1, unitPrice: 2250, total: 2250 },
        { appointmentId: "appt-1", durationMinutes: 45 }
      );
      expect(tx.appointment.update).toHaveBeenCalledWith({
        where: { id: "appt-1" },
        data: { durationMinutes: 45 },
      });
    });
  });

  it("decrypts the joined patient's NIF — the invoice preview and receipt PDF must never show ciphertext", async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      patient: { id: "p1", fullName: "Maria Silva", nif: encryption.encrypt("289959195") },
    });
    const invoice = await repo.findById("inv-1");
    expect(invoice?.patient.nif).toBe("289959195");
  });

  it("leaves a patient with no NIF as null, no crash", async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      patient: { id: "p1", fullName: "João Costa", nif: null },
    });
    const invoice = await repo.findById("inv-1");
    expect(invoice?.patient.nif).toBeNull();
  });

  it("returns undefined untouched when the invoice doesn't exist", async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);
    const invoice = await repo.findById("inv-x");
    expect(invoice).toBeNull();
  });
});
