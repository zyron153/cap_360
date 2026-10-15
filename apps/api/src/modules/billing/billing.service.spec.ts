import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException, ForbiddenException, Logger } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { PrismaService } from "../../prisma/prisma.service";
import { HealthPlansService } from "../health-plans/health-plans.service";
import { ServicesService } from "../services/services.service";
import { ParametrizacaoService } from "../parametrizacao/parametrizacao.service";
import { EFaturaService } from "../efatura/efatura.service";
import { generateReceiptPdf } from "./receipt.pdf";
import { RequestContext } from "../../common/context/request-context";

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
  findItemForUpdate: jest.fn(),
  findAppointmentWithService: jest.fn(),
  updateItemAtomic: jest.fn(),
  cancelAtomic: jest.fn(),
};
const r2 = { isConfigured: jest.fn(), upload: jest.fn(), signedUrl: jest.fn() };
const prisma = {
  setting: { findUnique: jest.fn() },
};
const efatura = {
  reporting: jest.fn(),
  enqueue: jest.fn(),
  primaryFor: jest.fn(),
  documents: jest.fn(),
  retry: jest.fn(),
  planVoid: jest.fn(),
};
const healthPlansService = { getActiveCoverage: jest.fn() };
const servicesService = { create: jest.fn() };
const parametrizacaoService = { update: jest.fn() };
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
        { provide: HealthPlansService, useValue: healthPlansService },
        { provide: ServicesService, useValue: servicesService },
        { provide: ParametrizacaoService, useValue: parametrizacaoService },
        { provide: EFaturaService, useValue: efatura },
      ],
    }).compile();
    service = mod.get(BillingService);
    jest.clearAllMocks();
    r2.isConfigured.mockReturnValue(false);
    // No active health plan by default — individual tests below override this to exercise the
    // discount path. Without this default, every pre-existing create()/createDraft() test would
    // need its own mock just to avoid a hanging jest.fn() promise.
    healthPlansService.getActiveCoverage.mockResolvedValue(null);
    // e-Fatura reporting is off unless a test switches it on.
    efatura.reporting.mockResolvedValue({ enabled: false, goLiveAt: null });
    efatura.enqueue.mockResolvedValue(undefined);
  });

  // The actual status-machine math (paid / partially_paid) now lives inside
  // BillingRepository.recordPaymentAtomic, tested in billing.repository.spec.ts — it has to run
  // inside the same DB transaction as the insert, so it can't stay at the service level. These
  // tests cover what the service is actually responsible for: guards and correct delegation.
  describe("recordPayment — guards and delegation to the atomic repository call", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000", efaturaIds: [] });
    });

    it("delegates to recordPaymentAtomic with the payment data and the invoice's current total", async () => {
      await service.recordPayment("inv-1", { amount: 800, method: "bank_transfer" });
      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ amount: 800, method: "bank_transfer" }),
        2000,
        false,
        { enabled: false, issueNew: false }
      );
    });

    it("passes the recording staff member's id through to the atomic repository call", async () => {
      await service.recordPayment("inv-1", { amount: 800, method: "cash" }, "staff-1");
      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ recordedById: "staff-1" }),
        2000,
        false,
        { enabled: false, issueNew: false }
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

  describe("recordPayment — draft invoices (appointment auto-invoice) catching up on issuance", () => {
    beforeEach(() => {
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000", efaturaIds: [] });
    });

    it("marks the payment as issuing when the invoice was still a draft, and queues the fiscal rows it created", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "draft" });
      efatura.reporting.mockResolvedValue({ enabled: true, goLiveAt: null });
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000", efaturaIds: ["sub-issue", "sub-receipt"] });

      const result = await service.recordPayment("inv-1", { amount: 2000, method: "cash" });

      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ amount: 2000, method: "cash" }),
        2000,
        true,
        { enabled: true, issueNew: true }
      );
      expect(efatura.enqueue).toHaveBeenCalledWith("sub-issue");
      expect(efatura.enqueue).toHaveBeenCalledWith("sub-receipt");
      expect(result).toEqual({ id: "inv-1", status: "paid", amountPaid: "2000" }); // efaturaIds stays internal
    });

    it("does not issue a NEW fiscal document for a draft paid before the go-live date", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "draft" });
      efatura.reporting.mockResolvedValue({ enabled: true, goLiveAt: new Date(Date.now() + 86_400_000) });

      await service.recordPayment("inv-1", { amount: 2000, method: "cash" });

      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1", expect.anything(), 2000, true, { enabled: true, issueNew: false }
      );
    });

    it("reports payments on an already-issued invoice too (receipt rows), without a new issue document", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "partially_paid" });
      efatura.reporting.mockResolvedValue({ enabled: true, goLiveAt: null });

      await service.recordPayment("inv-1", { amount: 500, method: "cash" });

      expect(repo.recordPaymentAtomic).toHaveBeenCalledWith(
        "inv-1", expect.objectContaining({ amount: 500 }), 2000, false, { enabled: true, issueNew: true }
      );
    });
  });

  describe("recordPayment — idempotency key replay", () => {
    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      repo.recordPaymentAtomic.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: "2000", efaturaIds: [] });
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
        2000,
        false,
        { enabled: false, issueNew: false }
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
      repo.create.mockResolvedValue({ efaturaSubmissions: [] });
    });

    it("logs a warning when an admin overrides a line item's price", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        priceOverrideReason: "Paciente em dificuldade financeira",
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
        priceOverrideReason: "Desconto autorizado",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
      } as never, ["admin"]);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 500, total: 500 }));
    });

    it("requires priceOverrideReason when an admin bills below the catalogue price", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await expect(
        service.create({
          patientId: "patient-1",
          items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
        } as never, ["admin"])
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("does not require a reason when an admin bills ABOVE the catalogue price", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 2000 }],
      } as never, ["admin"]);

      expect(repo.create).toHaveBeenCalled();
    });

    it("records the override and reason in the audit diff", async () => {
      repo.findServiceById.mockResolvedValue({ id: "service-1", name: "Consulta Geral", price: "1500" });
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);

      await service.create({
        patientId: "patient-1",
        priceOverrideReason: "Desconto autorizado",
        items: [{ serviceId: "service-1", description: "Consulta Geral", quantity: 1, unitPrice: 500 }],
      } as never, ["admin"]);

      expect(diffSpy).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ reason: "Desconto autorizado" })
      );
      diffSpy.mockRestore();
    });

    it("connects the invoice to a health plan when healthPlanId is provided", async () => {
      await service.create({
        patientId: "patient-1",
        healthPlanId: "plan-1",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 250 }],
      } as never, ["receptionist"]);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ healthPlan: { connect: { id: "plan-1" } } })
      );
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

  describe("create — health-plan discount", () => {
    beforeEach(() => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0004");
      repo.create.mockResolvedValue({ efaturaSubmissions: [] });
    });

    it("adds no discount line when the patient has no active health plan", async () => {
      await service.create({
        patientId: "patient-1",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 1000 }],
      } as never, ["receptionist"]);

      const call = repo.create.mock.calls[0][0];
      expect(call.items.create).toHaveLength(1);
      expect(call.subtotal).toBe(1000);
      expect(call.total).toBe(1000);
    });

    it("appends a negative discount line and reduces the total when the patient has an active plan", async () => {
      healthPlansService.getActiveCoverage.mockResolvedValue({
        healthPlanId: "plan-1",
        coveragePercent: 80,
        productName: "Plano Familiar",
      });

      await service.create({
        patientId: "patient-1",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 1000 }],
      } as never, ["receptionist"]);

      const call = repo.create.mock.calls[0][0];
      expect(call.items.create).toHaveLength(2);
      expect(call.items.create[1]).toEqual(
        expect.objectContaining({ serviceId: null, unitPrice: -800, total: -800 })
      );
      expect(call.items.create[1].description).toContain("80%");
      expect(call.subtotal).toBe(200);
      expect(call.total).toBe(200);
      expect(call.healthPlan).toEqual({ connect: { id: "plan-1" } });
    });

    it("prefers the caller-supplied healthPlanId over the patient's own active plan for the invoice link", async () => {
      healthPlansService.getActiveCoverage.mockResolvedValue({
        healthPlanId: "plan-1",
        coveragePercent: 80,
        productName: "Plano Familiar",
      });

      await service.create({
        patientId: "patient-1",
        healthPlanId: "explicit-plan",
        items: [{ description: "Item avulso", quantity: 1, unitPrice: 1000 }],
      } as never, ["receptionist"]);

      expect(repo.create.mock.calls[0][0].healthPlan).toEqual({ connect: { id: "explicit-plan" } });
    });

    it("does not add a discount line for a zero-value invoice", async () => {
      healthPlansService.getActiveCoverage.mockResolvedValue({
        healthPlanId: "plan-1",
        coveragePercent: 80,
        productName: "Plano Familiar",
      });

      await service.create({
        patientId: "patient-1",
        items: [{ description: "Item gratuito", quantity: 1, unitPrice: 0 }],
      } as never, ["receptionist"]);

      expect(repo.create.mock.calls[0][0].items.create).toHaveLength(1);
    });
  });

  describe("createDraft", () => {
    it("creates a draft invoice with status=draft and correct totals", async () => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0002");
      repo.create.mockResolvedValue({ efaturaSubmissions: [] });

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

    it("adds a health-plan discount line to the auto-generated draft too", async () => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0005");
      repo.create.mockResolvedValue({ efaturaSubmissions: [] });
      healthPlansService.getActiveCoverage.mockResolvedValue({
        healthPlanId: "plan-1",
        coveragePercent: 50,
        productName: "Plano Individual",
      });

      await service.createDraft({
        patientId: "patient-1",
        appointmentId: "appt-1",
        serviceId: "service-1",
        serviceName: "Consulta Geral",
        unitPrice: 1500,
      });

      const call = repo.create.mock.calls[0][0];
      expect(call.items.create).toHaveLength(2);
      expect(call.items.create[1]).toEqual(
        expect.objectContaining({ serviceId: null, unitPrice: -750, total: -750 })
      );
      expect(call.subtotal).toBe(750);
      expect(call.total).toBe(750);
      expect(call.healthPlan).toEqual({ connect: { id: "plan-1" } });
    });
  });

  describe("updateItem", () => {
    beforeEach(() => {
      repo.updateItemAtomic.mockResolvedValue({});
    });

    it("rejects editing an item on a non-draft invoice", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "1500", serviceId: "service-1",
        invoice: { status: "issued", appointmentId: "appt-1" },
      });

      await expect(
        service.updateItem("inv-1", "item-1", { quantity: 2 } as never)
      ).rejects.toThrow(BadRequestException);
      expect(repo.updateItemAtomic).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the item doesn't belong to the invoice", async () => {
      repo.findItemForUpdate.mockResolvedValue(null);

      await expect(
        service.updateItem("inv-1", "item-1", { quantity: 2 } as never)
      ).rejects.toThrow(NotFoundException);
    });

    it("recomputes unitPrice proportionally to the service's standard duration", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "1500", serviceId: "service-1",
        invoice: { status: "draft", appointmentId: "appt-1" },
      });
      repo.findAppointmentWithService.mockResolvedValue({
        id: "appt-1", serviceId: "service-1",
        service: { price: "1500", durationMinutes: 30 },
      });

      await service.updateItem("inv-1", "item-1", { durationMinutes: 45 } as never);

      // 45 / 30 standard minutes * 1500 = 2250
      expect(repo.updateItemAtomic).toHaveBeenCalledWith(
        "inv-1", "item-1",
        { quantity: 1, unitPrice: 2250, total: 2250 },
        { appointmentId: "appt-1", durationMinutes: 45 }
      );
    });

    it("rejects a durationMinutes edit on an item with no appointment behind it", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "250", serviceId: null,
        invoice: { status: "draft", appointmentId: null },
      });

      await expect(
        service.updateItem("inv-1", "item-1", { durationMinutes: 45 } as never)
      ).rejects.toThrow(BadRequestException);
      expect(repo.updateItemAtomic).not.toHaveBeenCalled();
    });

    it("lets a manual quantity edit through without touching price authorization", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "1500", serviceId: "service-1",
        invoice: { status: "draft", appointmentId: null },
      });

      await service.updateItem("inv-1", "item-1", { quantity: 3 } as never, ["receptionist"]);

      expect(repo.updateItemAtomic).toHaveBeenCalledWith(
        "inv-1", "item-1",
        { quantity: 3, unitPrice: 1500, total: 4500 },
        undefined
      );
      expect(repo.findServiceById).not.toHaveBeenCalled();
    });

    it("rejects a non-admin manually pricing a catalogued item away from the catalogue price", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "1500", serviceId: "service-1",
        invoice: { status: "draft", appointmentId: null },
      });
      repo.findServiceById.mockResolvedValue({ id: "service-1", price: "1500" });

      await expect(
        service.updateItem("inv-1", "item-1", { unitPrice: 500 } as never, ["receptionist"])
      ).rejects.toThrow(ForbiddenException);
      expect(repo.updateItemAtomic).not.toHaveBeenCalled();
    });

    it("lets an admin manually reprice a catalogued item with a reason when underpricing", async () => {
      repo.findItemForUpdate.mockResolvedValue({
        id: "item-1", quantity: 1, unitPrice: "1500", serviceId: "service-1",
        invoice: { status: "draft", appointmentId: null },
      });
      repo.findServiceById.mockResolvedValue({ id: "service-1", price: "1500" });

      await service.updateItem(
        "inv-1", "item-1",
        { unitPrice: 500, priceOverrideReason: "Desconto autorizado" } as never,
        ["admin"]
      );

      expect(repo.updateItemAtomic).toHaveBeenCalledWith(
        "inv-1", "item-1", { quantity: 1, unitPrice: 500, total: 500 }, undefined
      );
    });
  });

  describe("create — e-Fatura reporting", () => {
    const dto = { patientId: "patient-1", items: [{ serviceId: "service-1", description: "Consulta", quantity: 1, unitPrice: 1500 }] } as never;

    beforeEach(() => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0001");
      repo.findServiceById.mockResolvedValue({ id: "service-1", price: "1500" });
    });

    it("creates the fiscal-document row in the SAME insert as the invoice, then queues it", async () => {
      efatura.reporting.mockResolvedValue({ enabled: true, goLiveAt: null });
      repo.create.mockResolvedValue({ id: "inv-1", efaturaSubmissions: [{ id: "sub-1" }] });

      await service.create(dto, ["admin"]);

      expect(repo.create.mock.calls[0][0].efaturaSubmissions).toEqual({ create: { purpose: "issue" } });
      expect(efatura.enqueue).toHaveBeenCalledWith("sub-1");
    });

    it("creates no fiscal row when e-Fatura is off", async () => {
      repo.create.mockResolvedValue({ id: "inv-1", efaturaSubmissions: [] });

      await service.create(dto, ["admin"]);

      expect(repo.create.mock.calls[0][0].efaturaSubmissions).toBeUndefined();
      expect(efatura.enqueue).not.toHaveBeenCalled();
    });

    it("creates no fiscal row for an invoice issued before the go-live date", async () => {
      efatura.reporting.mockResolvedValue({ enabled: true, goLiveAt: new Date(Date.now() + 86_400_000) });
      repo.create.mockResolvedValue({ id: "inv-1", efaturaSubmissions: [] });

      await service.create(dto, ["admin"]);

      expect(repo.create.mock.calls[0][0].efaturaSubmissions).toBeUndefined();
    });
  });

  describe("create — invoice number collisions", () => {
    const dto = { patientId: "patient-1", items: [{ serviceId: "service-1", description: "Consulta", quantity: 1, unitPrice: 1500 }] } as never;
    const collision = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["invoiceNumber"] } });

    beforeEach(() => repo.findServiceById.mockResolvedValue({ id: "service-1", price: "1500" }));

    it("takes the next number when a concurrent create grabbed the same one", async () => {
      repo.nextInvoiceNumber.mockResolvedValueOnce("INV-2026-0007").mockResolvedValueOnce("INV-2026-0008");
      repo.create.mockRejectedValueOnce(collision()).mockResolvedValueOnce({ id: "inv-1", efaturaSubmissions: [] });

      await service.create(dto, ["admin"]);

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create.mock.calls[1][0].invoiceNumber).toBe("INV-2026-0008");
    });

    it("does not swallow other errors, and gives up after a few collisions", async () => {
      repo.nextInvoiceNumber.mockResolvedValue("INV-2026-0007");
      repo.create.mockRejectedValue(new Error("db down"));
      await expect(service.create(dto, ["admin"])).rejects.toThrow("db down");
      expect(repo.create).toHaveBeenCalledTimes(1);

      repo.create.mockReset();
      repo.create.mockRejectedValue(collision());
      await expect(service.create(dto, ["admin"])).rejects.toMatchObject({ code: "P2002" });
      expect(repo.create).toHaveBeenCalledTimes(5);
    });
  });

  describe("getEFaturaStatus", () => {
    it("returns the invoice's own fiscal document", async () => {
      const sub = { invoiceId: "inv-1", status: "accepted", iud: "CV1..." };
      efatura.primaryFor.mockResolvedValue(sub);
      expect(await service.getEFaturaStatus("inv-1")).toEqual(sub);
    });

    it("throws NotFoundException when no submission exists", async () => {
      efatura.primaryFor.mockResolvedValue(null);
      await expect(service.getEFaturaStatus("inv-x")).rejects.toThrow(NotFoundException);
    });

    it("lists every fiscal document of the invoice", async () => {
      efatura.documents.mockResolvedValue([{ purpose: "issue" }, { purpose: "receipt" }]);
      expect(await service.getEFaturaDocuments("inv-1")).toHaveLength(2);
    });
  });

  describe("retryEFatura", () => {
    it("delegates to the e-Fatura service and reports how many documents were re-queued", async () => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      efatura.retry.mockResolvedValue(2);
      expect(await service.retryEFatura("inv-1")).toEqual({ queued: true, count: 2 });
    });

    it("reports queued: false when nothing needed a retry", async () => {
      repo.findByIdLite.mockResolvedValue(INVOICE);
      efatura.retry.mockResolvedValue(0);
      expect(await service.retryEFatura("inv-1")).toEqual({ queued: false, count: 0 });
    });

    it("throws NotFoundException for an unknown invoice", async () => {
      repo.findByIdLite.mockResolvedValue(null);
      await expect(service.retryEFatura("inv-x")).rejects.toThrow(NotFoundException);
      expect(efatura.retry).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    const cancelled = { ...INVOICE, status: "cancelled" };

    beforeEach(() => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, amountPaid: "0" });
      repo.cancelAtomic.mockImplementation(async (_id: string, _data: unknown, before: (tx: unknown) => Promise<string[]>) => ({
        invoice: cancelled,
        efaturaIds: await before({} as never),
      }));
      efatura.planVoid.mockResolvedValue([]);
    });

    it("throws NotFoundException for an unknown invoice", async () => {
      repo.findByIdLite.mockResolvedValue(null);
      await expect(service.cancel("inv-x", "Duplicado")).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when the invoice is already fully paid", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "paid" });
      await expect(service.cancel("inv-1", "Duplicado")).rejects.toThrow(BadRequestException);
      expect(repo.cancelAtomic).not.toHaveBeenCalled();
    });

    it("is idempotent — returns the invoice as-is when already cancelled, without re-cancelling", async () => {
      repo.findByIdLite.mockResolvedValue(cancelled);
      expect(await service.cancel("inv-1", "Duplicado")).toEqual(cancelled);
      expect(repo.cancelAtomic).not.toHaveBeenCalled();
      expect(efatura.enqueue).not.toHaveBeenCalled();
    });

    it("cancels with the reason and a timestamp, in one transaction with the fiscal planning", async () => {
      await service.cancel("inv-1", "Paciente desistiu");

      expect(repo.cancelAtomic).toHaveBeenCalledWith(
        "inv-1",
        expect.objectContaining({ status: "cancelled", cancelReason: "Paciente desistiu", cancelledAt: expect.any(Date) }),
        expect.any(Function)
      );
      expect(efatura.planVoid).toHaveBeenCalledWith(expect.anything(), "inv-1", "Paciente desistiu", false);
    });

    it("tells the e-Fatura planner whether money was already paid (credit note vs. void event)", async () => {
      repo.findByIdLite.mockResolvedValue({ ...INVOICE, status: "partially_paid", amountPaid: "500" });
      await service.cancel("inv-1", "Duplicado");
      expect(efatura.planVoid).toHaveBeenCalledWith(expect.anything(), "inv-1", "Duplicado", true);
    });

    it("queues the void documents it was told about, after the transaction", async () => {
      efatura.planVoid.mockResolvedValue(["void-1"]);
      await service.cancel("inv-1", "Duplicado");
      expect(efatura.enqueue).toHaveBeenCalledWith("void-1");
    });

    it("lets a planner conflict (document being sent right now) abort the cancellation", async () => {
      efatura.planVoid.mockRejectedValue(new Error("em envio"));
      await expect(service.cancel("inv-1", "Duplicado")).rejects.toThrow("em envio");
      expect(efatura.enqueue).not.toHaveBeenCalled();
    });

    it("records the before/after status and reason in the audit diff", async () => {
      const diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);

      await service.cancel("inv-1", "Paciente desistiu");

      expect(diffSpy).toHaveBeenCalledWith(
        { status: "issued" },
        expect.objectContaining({ status: "cancelled", cancelReason: "Paciente desistiu" })
      );
      diffSpy.mockRestore();
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

    it("passes the patient's NIF through to the receipt (already decrypted by the repository)", async () => {
      repo.findById.mockResolvedValue({
        ...FULL_INVOICE,
        patient: { ...FULL_INVOICE.patient, nif: "289959195" },
      });
      prisma.setting.findUnique.mockResolvedValue({ value: CLINIC });
      await service.getReceiptUrl("inv-1");
      expect(generateReceiptPdfMock).toHaveBeenCalledWith(
        expect.objectContaining({ patient: expect.objectContaining({ nif: "289959195" }) })
      );
    });

    it("passes null NIF when the patient has none, instead of dropping the field", async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: CLINIC });
      await service.getReceiptUrl("inv-1");
      expect(generateReceiptPdfMock).toHaveBeenCalledWith(
        expect.objectContaining({ patient: expect.objectContaining({ nif: null }) })
      );
    });
  });

  describe("createDraftService — Nova Fatura's inline service-creation flow", () => {
    it("creates the service with a 30-minute default duration and links it back to the parametrizacao entry", async () => {
      servicesService.create.mockResolvedValue({ id: "svc-1", name: "Consulta Nova", code: "CONSULTA-NOVA" });
      parametrizacaoService.update.mockResolvedValue({});

      const result = await service.createDraftService({
        parametrizacaoId: 42,
        name: "Consulta Nova",
        code: "CONSULTA-NOVA",
        price: 2500,
      });

      expect(servicesService.create).toHaveBeenCalledWith({
        name: "Consulta Nova", code: "CONSULTA-NOVA", price: 2500, durationMinutes: 30,
      });
      expect(parametrizacaoService.update).toHaveBeenCalledWith(42, { codigo: "svc-1" });
      expect(result).toEqual({ id: "svc-1", name: "Consulta Nova", code: "CONSULTA-NOVA" });
    });

    it("does not link the parametrizacao entry when service creation fails", async () => {
      servicesService.create.mockRejectedValue(new Error("duplicate code"));

      await expect(service.createDraftService({
        parametrizacaoId: 42, name: "X", code: "X", price: 100,
      })).rejects.toThrow("duplicate code");
      expect(parametrizacaoService.update).not.toHaveBeenCalled();
    });
  });
});
