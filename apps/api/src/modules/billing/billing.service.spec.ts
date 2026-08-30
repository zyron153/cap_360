import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException, ForbiddenException, Logger } from "@nestjs/common";
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
  recordPaymentAtomic: jest.fn(),
  findPaymentReplay: jest.fn(),
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

  // The actual status-machine math (paid / partially_paid) now lives inside
  // BillingRepository.recordPaymentAtomic, tested in billing.repository.spec.ts — it has to run
  // inside the same DB transaction as the insert, so it can't stay at the service level. These
  // tests cover what the service is actually responsible for: guards and correct delegation.
  describe("recordPayment — guards and delegation to the atomic repository call", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000" });
    });

    it("delegates to recordPaymentAtomic with the payment data and the invoice's current total", async () => {
      await service.recordPayment("inv-1", { amount: 800, method: "bank_transfer" });
      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ amount: 800, method: "bank_transfer" }),
        2000
      );
    });

    it("throws BadRequestException on a paid invoice, without recording a payment", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "paid" });
      await expect(
        service.recordPayment("inv-1", { amount: 100, method: "cash" })
      ).rejects.toThrow(BadRequestException);
      expect(repo.recordPaymentAtomic).not.toHaveBeenCalled();
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

  describe("recordPayment — idempotency key replay", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000" });
    });

    it("returns the original result without recording again when the key was already used", async () => {
      repo.findPaymentReplay.mockResolvedValue({ id: "inv-1", status: "partially_paid", amountPaid: "800" });

      const result = await service.recordPayment("inv-1", { amount: 800, method: "cash", idempotencyKey: "key-abc" });

      expect(result).toEqual({ id: "inv-1", status: "partially_paid", amountPaid: "800" });
      expect(repo.recordPaymentAtomic).not.toHaveBeenCalled();
    });

    it("records normally and passes the key through when it hasn't been used before", async () => {
      repo.findPaymentReplay.mockResolvedValue(null);

      await service.recordPayment("inv-1", { amount: 800, method: "cash", idempotencyKey: "key-new" });

      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ idempotencyKey: "key-new" }),
        2000
      );
    });

    it("skips the replay check entirely when no key is provided", async () => {
      await service.recordPayment("inv-1", { amount: 800, method: "cash" });
      expect(repo.findPaymentReplay).not.toHaveBeenCalled();
      expect(repo.recordPaymentAtomic).toHaveBeenCalled();
    });
  });

  describe("create — price-override visibility", () => {
    beforeEach(() => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0003");
      repo.create.mockResolvedValue({});
    });

    it("logs a warning when an admin overrides a line item's price", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
      } as never, ["admin"]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("service-1"));
      warnSpy.mockRestore();
    });

    it("does not warn when the price matches the catalogue", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 1500 }],
      } as never, ["receptionist"]);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does not warn for a line item with no serviceId (off-catalogue / custom item)", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 250 }],
      } as never, ["receptionist"]);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(repo.findServiceById).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("still creates the invoice at the submitted price when an admin overrides the catalogue", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
      } as never, ["admin"]);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 500, total: 500 }));
    });

    it("rejects a non-admin trying to override a catalogued service's price", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });

      await expect(
        service.create({
          patientId: "patient-1",
          items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
        } as never, ["receptionist"])
      ).rejects.toThrow(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("lets a non-admin create an off-catalogue custom line item — there's no catalogue price to override", async () => {
      await service.create({
        patientId: "patient-1",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 250 }],
      } as never, ["receptionist"]);

      expect(repo.create).toHaveBeenCalled();
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

  describe("cancel", () => {
    it("throws NotFoundException for an unknown invoice", async () => {
      repo.findByIdLite.mockResolvedValue(null);
      await expect(service.cancel("inv-x")).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when the invoice is already fully paid", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "paid" });
      await expect(service.cancel("inv-1")).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("is idempotent — returns the invoice as-is when already cancelled, without re-cancelling", async () => {
      const cancelled = { ...INVOICE, status: "cancelled" };
      repo.findByIdLite.mockResolvedValue(cancelled);
      expect(await service.cancel("inv-1")).toEqual(cancelled);
      expect(repo.update).not.toHaveBeenCalled();
      expect(efaturaQueue.add).not.toHaveBeenCalled();
    });

    it("sets status to cancelled for an issued invoice with no E-Factura submission", async () => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      prisma.eFaturaSubmission.findUnique.mockResolvedValue(null);
      repo.update.mockResolvedValue({ ...INVOICE, status: "cancelled" });

      await service.cancel("inv-1");

      expect(repo.update).toHaveBeenCalledWith("inv-1", { status: "cancelled" });
      expect(efaturaQueue.add).not.toHaveBeenCalled();
    });

    it("also enqueues an E-Factura cancel job when the invoice was already accepted there", async () => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      prisma.eFaturaSubmission.findUnique.mockResolvedValue({
        invoiceId: "inv-1",
        status: "accepted",
        efaturaRef: "REF123",
      });
      repo.update.mockResolvedValue({ ...INVOICE, status: "cancelled" });

      await service.cancel("inv-1");

      expect(efaturaQueue.add).toHaveBeenCalledWith(
        "cancel",
        { invoiceId: "inv-1", efaturaRef: "REF123" },
        expect.objectContaining({ attempts: 3 })
      );
    });

    it("does not enqueue an E-Factura cancel job when the submission was never accepted (still pending/rejected)", async () => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      prisma.eFaturaSubmission.findUnique.mockResolvedValue({
        invoiceId: "inv-1",
        status: "pending",
        efaturaRef: null,
      });
      repo.update.mockResolvedValue({ ...INVOICE, status: "cancelled" });

      await service.cancel("inv-1");

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
    const CLINIC = { name: "Clínica Teste", nif: "999888777", address: "Rua Teste", phone: "+238 999 0000", email: "teste@cap.cv" };

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
