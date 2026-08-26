import { Test } from "@nestjs/testing";
import { EFaturaService } from "./efatura.service";
import { PrismaService } from "../../prisma/prisma.service";
import type { EFaturaConfig } from "./efatura.types";

const CFG: EFaturaConfig = {
  enabled: true,
  sandbox: false,
  endpoint: "https://mw.efatura.cv",
  nifContribuinte: "123456789",
  apiKey: "tok-abc",
  nomeEmpresa: "Clínica Mais Saúde",
};

const EFATURA_ROW = { enabled: true, sandbox: false, endpoint: "https://mw.efatura.cv", apiKey: "tok-abc" };
const CLINIC_ROW = { name: "Clínica Mais Saúde", nif: "123456789" };

const prisma = { setting: { findUnique: jest.fn() } };

// nif/nome now come from the "clinic" setting (single source of truth), not from
// integration_efatura directly — this mock lets each test override either row.
function mockSettings(overrides: { efatura?: Record<string, unknown> | null; clinic?: Record<string, unknown> | null } = {}) {
  prisma.setting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
    if (where.key === "integration_efatura") {
      return Promise.resolve(overrides.efatura === null ? null : { value: { ...EFATURA_ROW, ...overrides.efatura } });
    }
    if (where.key === "clinic") {
      return Promise.resolve(overrides.clinic === null ? null : { value: { ...CLINIC_ROW, ...overrides.clinic } });
    }
    return Promise.resolve(null);
  });
}

const BASE_INVOICE = {
  invoiceNumber: "INV-2026-0001",
  issuedAt: new Date("2026-08-01T00:00:00Z"),
  patient: { fullName: "Maria Silva", nif: "987654321" },
  items: [
    { description: "Consulta Geral", quantity: 1, unitPrice: "1500", total: "1500", serviceId: "svc-1" },
  ],
  subtotal: "1500",
  total: "1500",
};

describe("EFaturaService", () => {
  let service: EFaturaService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EFaturaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(EFaturaService);
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation();
  });

  afterEach(() => fetchSpy.mockRestore());

  /* ── getConfig ──────────────────────────────────────────────────── */

  describe("getConfig", () => {
    it("returns null when the integration_efatura setting row does not exist", async () => {
      mockSettings({ efatura: null });
      expect(await service.getConfig()).toBeNull();
    });

    it("returns null when enabled=false", async () => {
      mockSettings({ efatura: { enabled: false } });
      expect(await service.getConfig()).toBeNull();
    });

    it("returns null when apiKey is empty", async () => {
      mockSettings({ efatura: { apiKey: "" } });
      expect(await service.getConfig()).toBeNull();
    });

    it("returns null when the clinic setting row does not exist at all", async () => {
      mockSettings({ clinic: null });
      expect(await service.getConfig()).toBeNull();
    });

    it("returns null when the clinic has no NIF configured", async () => {
      mockSettings({ clinic: { nif: "" } });
      expect(await service.getConfig()).toBeNull();
    });

    it("returns null when the clinic has no name configured", async () => {
      mockSettings({ clinic: { name: "" } });
      expect(await service.getConfig()).toBeNull();
    });

    it("merges nifContribuinte/nomeEmpresa from the clinic setting — single source of truth", async () => {
      mockSettings({});
      const cfg = await service.getConfig();
      expect(cfg?.nifContribuinte).toBe(CLINIC_ROW.nif);
      expect(cfg?.nomeEmpresa).toBe(CLINIC_ROW.name);
    });

    it("does not use a stale nifContribuinte/nomeEmpresa stored on the integration_efatura row itself", async () => {
      mockSettings({ efatura: { nifContribuinte: "000000000", nomeEmpresa: "Nome Antigo Errado" } });
      const cfg = await service.getConfig();
      expect(cfg?.nifContribuinte).toBe(CLINIC_ROW.nif);
      expect(cfg?.nomeEmpresa).toBe(CLINIC_ROW.name);
    });

    it("returns the rest of the E-Fatura fields unchanged", async () => {
      mockSettings({});
      const cfg = await service.getConfig();
      expect(cfg).toMatchObject({
        enabled: true, sandbox: false,
        endpoint: "https://mw.efatura.cv", apiKey: "tok-abc",
      });
    });
  });

  /* ── submitInvoice ──────────────────────────────────────────────── */

  describe("submitInvoice", () => {
    const MOCK_RESPONSE = { atcud: "ABCDE-1", referencia: "REF123", status: "accepted" };

    beforeEach(() => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      } as unknown as Response);
    });

    it("POSTs to the configured endpoint", async () => {
      await service.submitInvoice(CFG, {} as never);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${CFG.endpoint}/api/v1/invoices`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("sends Authorization and X-NIF headers", async () => {
      await service.submitInvoice(CFG, {} as never);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${CFG.apiKey}`,
            "X-NIF": CFG.nifContribuinte,
          }),
        })
      );
    });

    it("uses the sandbox base URL when sandbox=true", async () => {
      await service.submitInvoice({ ...CFG, sandbox: true }, {} as never);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("sandbox.mw.efatura.cv"),
        expect.anything()
      );
    });

    it("returns the parsed response body", async () => {
      const result = await service.submitInvoice(CFG, {} as never);
      expect(result).toEqual(MOCK_RESPONSE);
    });

    it("throws on a non-ok HTTP response with the status code in the message", async () => {
      fetchSpy.mockResolvedValue({
        ok: false, status: 422,
        text: () => Promise.resolve("Invalid NIF"),
      } as unknown as Response);
      await expect(service.submitInvoice(CFG, {} as never)).rejects.toThrow("422");
    });

    it("throws when the response body cannot be read (uses statusText as fallback)", async () => {
      fetchSpy.mockResolvedValue({
        ok: false, status: 503, statusText: "Service Unavailable",
        text: () => Promise.reject(new Error("body gone")),
      } as unknown as Response);
      await expect(service.submitInvoice(CFG, {} as never)).rejects.toThrow("503");
    });
  });

  /* ── cancelInvoice ──────────────────────────────────────────────── */

  describe("cancelInvoice", () => {
    it("POSTs to the cancel endpoint with the encoded reference", async () => {
      fetchSpy.mockResolvedValue({ ok: true } as Response);
      await service.cancelInvoice(CFG, "REF/123");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${CFG.endpoint}/api/v1/invoices/${encodeURIComponent("REF/123")}/cancel`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("uses sandbox URL when sandbox=true", async () => {
      fetchSpy.mockResolvedValue({ ok: true } as Response);
      await service.cancelInvoice({ ...CFG, sandbox: true }, "REF123");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("sandbox.mw.efatura.cv"),
        expect.anything()
      );
    });

    it("throws on non-ok HTTP response", async () => {
      fetchSpy.mockResolvedValue({
        ok: false, status: 404,
        text: () => Promise.resolve("Not found"),
      } as unknown as Response);
      await expect(service.cancelInvoice(CFG, "BAD")).rejects.toThrow("404");
    });

    it("resolves without returning a value on success", async () => {
      fetchSpy.mockResolvedValue({ ok: true } as Response);
      await expect(service.cancelInvoice(CFG, "REF123")).resolves.toBeUndefined();
    });
  });

  /* ── buildPayload ───────────────────────────────────────────────── */

  describe("buildPayload", () => {
    it("sets TaxRegistrationNumber and CompanyName from config", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.TaxRegistrationNumber).toBe(CFG.nifContribuinte);
      expect(p.CompanyName).toBe(CFG.nomeEmpresa);
    });

    it("sets InvoiceType to FT and DocumentStatus to N", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.InvoiceType).toBe("FT");
      expect(p.Invoice.DocumentStatus).toBe("N");
    });

    it("formats InvoiceDate as YYYY-MM-DD from issuedAt", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.InvoiceDate).toBe("2026-08-01");
    });

    it("falls back to today's date when issuedAt is null", () => {
      const today = new Date().toISOString().slice(0, 10);
      const p = service.buildPayload(CFG, { ...BASE_INVOICE, issuedAt: null });
      expect(p.Invoice.InvoiceDate).toBe(today);
    });

    it("maps patient NIF to CustomerTaxRegistrationNumber", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.CustomerTaxRegistrationNumber).toBe("987654321");
    });

    it("omits CustomerTaxRegistrationNumber when patient has no NIF", () => {
      const p = service.buildPayload(CFG, {
        ...BASE_INVOICE,
        patient: { fullName: "João Costa", nif: null },
      });
      expect(p.Invoice.CustomerTaxRegistrationNumber).toBeUndefined();
    });

    it("sets GrossTotal and NetTotal to the numeric invoice total", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.DocumentTotals.GrossTotal).toBe(1500);
      expect(p.Invoice.DocumentTotals.NetTotal).toBe(1500);
    });

    it("assigns sequential LineNumber starting at 1", () => {
      const p = service.buildPayload(CFG, {
        ...BASE_INVOICE,
        items: [
          { description: "A", quantity: 1, unitPrice: "500", total: "500", serviceId: null },
          { description: "B", quantity: 2, unitPrice: "250", total: "500", serviceId: "s2" },
        ],
      });
      expect(p.Invoice.Lines[0].LineNumber).toBe(1);
      expect(p.Invoice.Lines[1].LineNumber).toBe(2);
    });

    it("falls back to 'SVC' ProductCode when serviceId is null", () => {
      const p = service.buildPayload(CFG, {
        ...BASE_INVOICE,
        items: [{ ...BASE_INVOICE.items[0], serviceId: null }],
      });
      expect(p.Invoice.Lines[0].ProductCode).toBe("SVC");
    });

    it("uses serviceId as ProductCode when present", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.Lines[0].ProductCode).toBe("svc-1");
    });

    it("casts string Decimal values to numbers for UnitPrice and DebitAmount", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(typeof p.Invoice.Lines[0].UnitPrice).toBe("number");
      expect(typeof p.Invoice.Lines[0].DebitAmount).toBe("number");
    });

    it("sets UnitOfMeasure to UN", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.Lines[0].UnitOfMeasure).toBe("UN");
    });

    // TODO: TaxPayable is hardcoded to 0 — Cape Verde IVA rate not implemented.
    it("TODO — TaxPayable is always 0 (IVA not implemented)", () => {
      const p = service.buildPayload(CFG, BASE_INVOICE);
      expect(p.Invoice.DocumentTotals.TaxPayable).toBe(0);
    });
  });
});
