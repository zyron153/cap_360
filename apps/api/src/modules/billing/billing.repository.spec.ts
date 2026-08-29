import { Test } from "@nestjs/testing";
import { BillingRepository } from "./billing.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "d".repeat(64);

const tx = {
  payment: { create: jest.fn(), aggregate: jest.fn() },
  invoice: { update: jest.fn() },
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
