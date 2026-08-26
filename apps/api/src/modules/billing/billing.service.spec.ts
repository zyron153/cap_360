import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bull";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { PrismaService } from "../../prisma/prisma.service";
import { generateReceiptPdf } from "./receipt.pdf";

jest.mock("./receipt.pdf", () => ({ generateReceiptPdf: jest.fn() }));

const repo = {
  nextInvoiceNumber: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findByIdLite: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
  createPayment: jest.fn(),
  sumPayments: jest.fn(),
  findServiceById: jest.fn(),
};
const r2 = { isConfigured: jest.fn(), upload: jest.fn(), signedUrl: jest.fn() };
const prisma = {
  eFaturaSubmission: {
    create: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  setting: { findUnique: jest.fn() },
};
const efaturaQueue = { add: jest.fn() };
const generateReceiptPdfMock = generateReceiptPdf as jest.Mock;

const INVOICE = {
  id: "inv-1",
  status: "issued",
  total: "2000",
  invoiceNumber: "INV-2026-0001",
};

describe("BillingService", () => {
  let service: BillingService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BillingRepository, useValue: repo },
        { provide: R2Service, useValue: r2 },
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken("efatura"), useValue: efaturaQueue },
      ],
    }).compile();
    service = mod.get(BillingService);
    jest.clearAllMocks();
    r2.isConfigured.mockReturnValue(false);
  });

  describe("recordPayment — payment status machine", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      repo.createPayment.mockResolvedValue({});
      repo.updateStatus.mockResolvedValue({});
    });

    it("transitions to paid when the full amount is recorded", async () => {
      repo.sumPayments.mockResolvedValue({ _sum: { amount: "2000" } });
      await service.recordPayment("inv-1", { amount: 2000, method: "cash" });
      expect(repo.updateStatus).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ status: "paid", amountPaid: 2000 })
      );
    });

    it("transitions to partially_paid when a partial amount is recorded", async () => {
      repo.sumPayments.mockResolvedValue({ _sum: { amount: "800" } });
      await service.recordPayment("inv-1", { amount: 800, method: "bank_transfer" });
      expect(repo.updateStatus).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ status: "partially_paid", amountPaid: 800 })
      );
    });

    it("calculates remaining balance correctly across two payments", async () => {
      // First payment: 500
      repo.sumPayments.mockResolvedValue({ _sum: { amount: "500" } });
      await service.recordPayment("inv-1", { amount: 500, method: "cash" });
      expect(repo.updateStatus).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ status: "partially_paid", amountPaid: 500 })
      );

      // Second payment: remaining 1500
      repo.sumPayments.mockResolvedValue({ _sum: { amount: "2000" } });
      await service.recordPayment("inv-1", { amount: 1500, method: "cash" });
      expect(repo.updateStatus).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ status: "paid", amountPaid: 2000 })
      );
    });

    it("throws BadRequestException on a paid invoice", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "paid" });
      await expect(
        service.recordPayment("inv-1", { amount: 100, method: "cash" })
      ).rejects.toThrow(BadRequestException);
      expect(repo.createPayment).not.toHaveBeenCalled();
    });

    it("throws BadRequestException on a cancelled invoice", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "cancelled" });
      await expect(
        service.recordPayment("inv-1", { amount: 100, method: "cash" })
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException for an unknown invoice id", async () => {
      repo.findByIdLite.mockResolvedValue(null);
      await expect(
        service.recordPayment("inv-999", { amount: 100, method: "cash" })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("createDraft", () => {
    it("creates a draft invoice with status=draft and correct totals", async () => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0002");
      repo.create.mockResolvedValue({});

      await service.createDraft({
        patientId: "patient-1",
        appointmentId: "appt-1",
        serviceId: "service-1",
        serviceName: "Consulta Geral",
        unitPrice: 1500,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceNumber: "INV-2026-0002",
          subtotal: 1500,
          total: 1500,
          status: "draft",
        })
      );
    });
  });

  describe("getEFaturaStatus", () => {
    it("returns the submission record for a known invoice", async () => {
      const sub = { invoiceId: "inv-1", status: "accepted", atcud: "ABCDE-1" };
      prisma.eFaturaSubmission.findUnique.mockResolvedValue(sub);
      expect(await service.getEFaturaStatus("inv-1")).toEqual(sub);
    });

    it("throws NotFoundException when no submission exists", async () => {
      prisma.eFaturaSubmission.findUnique.mockResolvedValue(null);
      await expect(service.getEFaturaStatus("inv-x")).rejects.toThrow(NotFoundException);
    });
  });

  describe("retryEFatura", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      prisma.eFaturaSubmission.upsert.mockResolvedValue({});
      efaturaQueue.add.mockResolvedValue({});
    });

    it("resets submission to 'pending' and clears error fields", async () => {
      await service.retryEFatura("inv-1");
      expect(prisma.eFaturaSubmission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "pending",
            errorCode: null,
            errorMessage: null,
          }),
        })
      );
    });

    it("enqueues a submit job with 3 attempts", async () => {
      await service.retryEFatura("inv-1");
      expect(efaturaQueue.add).toHaveBeenCalledWith(
        "submit",
        { invoiceId: "inv-1" },
        expect.objectContaining({ attempts: 3 })
      );
    });

    it("returns { queued: true }", async () => {
      expect(await service.retryEFatura("inv-1")).toEqual({ queued: true });
    });

    it("throws NotFoundException for an unknown invoice", async () => {
      repo.findByIdLite.mockResolvedValue(null);
      await expect(service.retryEFatura("inv-x")).rejects.toThrow(NotFoundException);
      expect(efaturaQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("getReceiptUrl — clinic data on generated receipts", () => {
    const FULL_INVOICE = {
      id: "inv-1",
      invoiceNumber: "INV-2026-0001",
      issuedAt: new Date("2026-08-01T00:00:00Z"),
      pdfR2Key: null,
      patient: { fullName: "Maria Silva", phone: "+2389912345" },
      items: [{ description: "Consulta Geral", quantity: 1, unitPrice: "1500", total: "1500" }],
      subtotal: "1500",
      total: "1500",
      amountPaid: "1500",
      status: "paid",
    };
    const CLINIC = { name: "Clínica Teste", nif: "999888777", address: "Rua Teste", phone: "+238 999 0000", email: "teste@maissaudecv.com" };

    beforeEach(() => {
      repo.findById.mockResolvedValue(FULL_INVOICE);
      r2.isConfigured.mockReturnValue(true);
      r2.upload.mockResolvedValue(undefined);
      r2.signedUrl.mockResolvedValue("https://signed.url/receipt.pdf");
      repo.update.mockResolvedValue({});
      generateReceiptPdfMock.mockResolvedValue(Buffer.from("pdf"));
    });

    it("fetches the clinic setting and passes it into generateReceiptPdf", async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: CLINIC });
      await service.getReceiptUrl("inv-1");
      expect(generateReceiptPdfMock).toHaveBeenCalledWith(
        expect.objectContaining({ clinic: expect.objectContaining(CLINIC) })
      );
    });

    it("falls back to sensible defaults when the clinic setting is not configured", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      await service.getReceiptUrl("inv-1");
      const call = generateReceiptPdfMock.mock.calls[0][0];
      expect(call.clinic.name).toBeTruthy();
      expect(typeof call.clinic.name).toBe("string");
    });

    it("does not call generateReceiptPdf again when a pdfR2Key already exists", async () => {
      repo.findById.mockResolvedValue({ ...FULL_INVOICE, pdfR2Key: "receipts/existing.pdf" });
      await service.getReceiptUrl("inv-1");
      expect(generateReceiptPdfMock).not.toHaveBeenCalled();
    });
  });
});
