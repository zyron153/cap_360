import { Test } from "@nestjs/testing";
import { EFaturaProcessor } from "./efatura.processor";
import { EFaturaService } from "./efatura.service";
import { PrismaService } from "../../prisma/prisma.service";
import type { EFaturaConfig } from "./efatura.types";
import type { Job } from "bull";

const CFG: EFaturaConfig = {
  enabled: true, sandbox: false,
  endpoint: "https://mw.efatura.cv",
  nifContribuinte: "123456789",
  apiKey: "tok-abc",
  nomeEmpresa: "Clínica Mais Saúde",
};

const DB_INVOICE = {
  id: "inv-1",
  invoiceNumber: "INV-2026-0001",
  issuedAt: new Date("2026-08-01"),
  patient: { fullName: "Maria Silva", nif: "987654321" },
  items: [
    { description: "Consulta Geral", quantity: 1, unitPrice: "1500", total: "1500", serviceId: "svc-1" },
  ],
  subtotal: "1500",
  total: "1500",
};

function makeJob<T>(data: T): Job<T> {
  return { data } as Job<T>;
}

const prisma = {
  eFaturaSubmission: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  invoice: { findUnique: jest.fn() },
};

const efatura = {
  getConfig: jest.fn(),
  buildPayload: jest.fn(),
  submitInvoice: jest.fn(),
  cancelInvoice: jest.fn(),
};

describe("EFaturaProcessor", () => {
  let processor: EFaturaProcessor;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EFaturaProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: EFaturaService, useValue: efatura },
      ],
    }).compile();
    processor = mod.get(EFaturaProcessor);
    jest.clearAllMocks();
  });

  /* ── handleSubmit ───────────────────────────────────────────────── */

  describe("handleSubmit", () => {
    beforeEach(() => {
      prisma.eFaturaSubmission.upsert.mockResolvedValue({});
      prisma.eFaturaSubmission.update.mockResolvedValue({});
      prisma.invoice.findUnique.mockResolvedValue(DB_INVOICE);
      efatura.getConfig.mockResolvedValue(CFG);
      efatura.buildPayload.mockReturnValue({});
      efatura.submitInvoice.mockResolvedValue({
        atcud: "ABCDE-1", referencia: "REF123", status: "accepted",
      });
    });

    it("upserts submission to 'submitting' before fetching config", async () => {
      await processor.handleSubmit(makeJob({ invoiceId: "inv-1" }));
      expect(prisma.eFaturaSubmission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: "inv-1" },
          create: expect.objectContaining({ status: "submitting" }),
          update: expect.objectContaining({ status: "submitting" }),
        })
      );
    });

    it("sets submission to 'pending' and returns early when config is missing", async () => {
      efatura.getConfig.mockResolvedValue(null);
      await processor.handleSubmit(makeJob({ invoiceId: "inv-1" }));
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: "inv-1" },
          data: expect.objectContaining({ status: "pending" }),
        })
      );
      expect(efatura.submitInvoice).not.toHaveBeenCalled();
    });

    it("returns early without submitting when invoice is not found", async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await processor.handleSubmit(makeJob({ invoiceId: "inv-missing" }));
      expect(efatura.submitInvoice).not.toHaveBeenCalled();
    });

    it("updates submission to 'error' when invoice is not found", async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await processor.handleSubmit(makeJob({ invoiceId: "inv-missing" }));
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: "inv-missing" },
          data: expect.objectContaining({ status: "error" }),
        })
      );
    });

    it("stores 'accepted' status and ATCUD on successful submission", async () => {
      await processor.handleSubmit(makeJob({ invoiceId: "inv-1" }));
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: "inv-1" },
          data: expect.objectContaining({
            status: "accepted",
            atcud: "ABCDE-1",
            efaturaRef: "REF123",
          }),
        })
      );
    });

    it("preserves 'pending' status when middleware responds with pending", async () => {
      efatura.submitInvoice.mockResolvedValue({
        atcud: "ABCDE-2", referencia: "REF456", status: "pending",
      });
      await processor.handleSubmit(makeJob({ invoiceId: "inv-1" }));
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "pending" }),
        })
      );
    });

    it("updates submission to 'error' and rethrows when submitInvoice throws", async () => {
      const err = new Error("Network error");
      efatura.submitInvoice.mockRejectedValue(err);
      await expect(processor.handleSubmit(makeJob({ invoiceId: "inv-1" }))).rejects.toThrow("Network error");
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "error" }),
        })
      );
    });

    it("truncates long error messages to 500 chars before storing", async () => {
      const longMsg = "X".repeat(600);
      efatura.submitInvoice.mockRejectedValue(new Error(longMsg));
      await expect(processor.handleSubmit(makeJob({ invoiceId: "inv-1" }))).rejects.toThrow();
      // update is called with a single object arg: { where, data }
      const updateCall = prisma.eFaturaSubmission.update.mock.calls.find(
        (c: [{ where: unknown; data: { errorMessage?: string } }]) => c[0]?.data?.errorMessage
      );
      expect(updateCall[0].data.errorMessage.length).toBeLessThanOrEqual(500);
    });

    it("increments retryCount on re-submission via upsert update path", async () => {
      await processor.handleSubmit(makeJob({ invoiceId: "inv-1" }));
      expect(prisma.eFaturaSubmission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            retryCount: { increment: 1 },
          }),
        })
      );
    });
  });

  /* ── handleCancel ───────────────────────────────────────────────── */

  describe("handleCancel", () => {
    beforeEach(() => {
      prisma.eFaturaSubmission.update.mockResolvedValue({});
      efatura.getConfig.mockResolvedValue(CFG);
      efatura.cancelInvoice.mockResolvedValue(undefined);
    });

    it("returns early without calling cancelInvoice when config is missing", async () => {
      efatura.getConfig.mockResolvedValue(null);
      await processor.handleCancel(makeJob({ invoiceId: "inv-1", efaturaRef: "REF123" }));
      expect(efatura.cancelInvoice).not.toHaveBeenCalled();
    });

    it("calls cancelInvoice with the config and efaturaRef", async () => {
      await processor.handleCancel(makeJob({ invoiceId: "inv-1", efaturaRef: "REF123" }));
      expect(efatura.cancelInvoice).toHaveBeenCalledWith(CFG, "REF123");
    });

    it("updates submission status to 'cancelled' on success", async () => {
      await processor.handleCancel(makeJob({ invoiceId: "inv-1", efaturaRef: "REF123" }));
      expect(prisma.eFaturaSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: "inv-1" },
          data: { status: "cancelled" },
        })
      );
    });

    it("rethrows when cancelInvoice throws (allows Bull to retry)", async () => {
      efatura.cancelInvoice.mockRejectedValue(new Error("Timeout"));
      await expect(
        processor.handleCancel(makeJob({ invoiceId: "inv-1", efaturaRef: "REF123" }))
      ).rejects.toThrow("Timeout");
    });

    it("does not update submission status when cancel fails", async () => {
      efatura.cancelInvoice.mockRejectedValue(new Error("Fail"));
      await expect(
        processor.handleCancel(makeJob({ invoiceId: "inv-1", efaturaRef: "REF123" }))
      ).rejects.toThrow();
      expect(prisma.eFaturaSubmission.update).not.toHaveBeenCalled();
    });
  });
});
