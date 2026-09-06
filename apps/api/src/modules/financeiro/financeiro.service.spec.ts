import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { FinanceiroService } from "./financeiro.service";
import { FinanceiroRepository } from "./financeiro.repository";
import { R2Service } from "../../common/services/r2.service";
import { StaffService } from "../staff/staff.service";
import { RequestContext } from "../../common/context/request-context";

const repo = {
  findExpenses: jest.fn(),
  countExpenses: jest.fn(),
  findExpenseById: jest.fn(),
  createExpense: jest.fn(),
  updateExpense: jest.fn(),
  deleteExpense: jest.fn(),
  sumApprovedExpenses: jest.fn(),
  approvedExpensesByCategory: jest.fn(),
  approvedExpensesInRange: jest.fn(),
  findIncome: jest.fn(),
  countIncome: jest.fn(),
  findIncomeById: jest.fn(),
  createIncome: jest.fn(),
  updateIncome: jest.fn(),
  deleteIncome: jest.fn(),
  sumIncome: jest.fn(),
  incomeInRange: jest.fn(),
  sumPayments: jest.fn(),
  paymentsInRange: jest.fn(),
  outstandingInvoices: jest.fn(),
  sumPaymentsByPlan: jest.fn(),
  sumPaymentsPrivate: jest.fn(),
  invoiceItemsInRange: jest.fn(),
  noShowAppointments: jest.fn(),
};
const r2 = { upload: jest.fn(), signedUrl: jest.fn() };
const staff = { findById: jest.fn() };

const EXPENSE = { id: "exp-1", status: "pending", amount: "1500" };

describe("FinanceiroService", () => {
  let service: FinanceiroService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        FinanceiroService,
        { provide: FinanceiroRepository, useValue: repo },
        { provide: R2Service, useValue: r2 },
        { provide: StaffService, useValue: staff },
      ],
    }).compile();
    service = mod.get(FinanceiroService);
    jest.clearAllMocks();
  });

  describe("createExpense", () => {
    it("links requestedBy when the caller resolves to a real staff record", async () => {
      staff.findById.mockResolvedValue({ id: "staff-1", fullName: "Ana" });
      repo.createExpense.mockResolvedValue({});
      await service.createExpense(
        { description: "Material", category: "Fornecimentos", amount: 500, date: "2026-08-27", method: "cash" },
        "kc-1"
      );
      expect(repo.createExpense).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: { connect: { id: "staff-1" } } })
      );
    });
  });

  describe("updateExpense", () => {
    it("throws NotFoundException for an unknown id", async () => {
      repo.findExpenseById.mockResolvedValue(null);
      await expect(service.updateExpense("exp-x", { amount: 100 })).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when the expense is no longer pending", async () => {
      repo.findExpenseById.mockResolvedValue({ ...EXPENSE, status: "approved" });
      await expect(service.updateExpense("exp-1", { amount: 100 })).rejects.toThrow(BadRequestException);
      expect(repo.updateExpense).not.toHaveBeenCalled();
    });

    it("updates a pending expense", async () => {
      repo.findExpenseById.mockResolvedValue(EXPENSE);
      repo.updateExpense.mockResolvedValue({});
      await service.updateExpense("exp-1", { amount: 750 });
      expect(repo.updateExpense).toHaveBeenCalledWith("exp-1", expect.objectContaining({ amount: 750 }));
    });
  });

  describe("decideExpense — approval status machine", () => {
    it("approves a pending expense and links the approver", async () => {
      repo.findExpenseById.mockResolvedValue(EXPENSE);
      staff.findById.mockResolvedValue({ id: "staff-2", fullName: "Admin" });
      repo.updateExpense.mockResolvedValue({});
      await service.decideExpense("exp-1", { status: "approved" }, "kc-2");
      expect(repo.updateExpense).toHaveBeenCalledWith(
        "exp-1",
        expect.objectContaining({ status: "approved", approvedBy: { connect: { id: "staff-2" } } })
      );
    });

    it("throws BadRequestException when the expense was already decided", async () => {
      repo.findExpenseById.mockResolvedValue({ ...EXPENSE, status: "approved" });
      await expect(service.decideExpense("exp-1", { status: "rejected" }, "kc-2")).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException for an unknown id", async () => {
      repo.findExpenseById.mockResolvedValue(null);
      await expect(service.decideExpense("exp-x", { status: "approved" }, "kc-2")).rejects.toThrow(NotFoundException);
    });
  });

  describe("audit diff — Financeiro is money, every non-create mutation should show what changed", () => {
    let diffSpy: jest.SpyInstance;

    beforeEach(() => {
      diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);
    });
    afterEach(() => diffSpy.mockRestore());

    it("updateExpense records only the submitted fields' before/after", async () => {
      repo.findExpenseById.mockResolvedValue({ ...EXPENSE, amount: "1500", category: "Fornecimentos" });
      repo.updateExpense.mockResolvedValue({ ...EXPENSE, amount: 750, category: "Fornecimentos" });

      await service.updateExpense("exp-1", { amount: 750 });

      expect(diffSpy).toHaveBeenCalledWith({ amount: "1500" }, { amount: 750 });
    });

    it("decideExpense records the status transition", async () => {
      repo.findExpenseById.mockResolvedValue(EXPENSE);
      staff.findById.mockResolvedValue({ id: "staff-2", fullName: "Admin" });
      repo.updateExpense.mockResolvedValue({ ...EXPENSE, status: "approved" });

      await service.decideExpense("exp-1", { status: "approved" }, "kc-2");

      expect(diffSpy).toHaveBeenCalledWith({ status: "pending" }, { status: "approved" });
    });

    it("deleteExpense records the deleted row, with no 'after' state", async () => {
      const full = { ...EXPENSE, description: "Material", amount: "1500" };
      repo.findExpenseById.mockResolvedValue(full);
      repo.deleteExpense.mockResolvedValue({});

      await service.deleteExpense("exp-1");

      expect(diffSpy).toHaveBeenCalledWith(full, null);
    });

    it("updateIncome records only the submitted fields' before/after", async () => {
      repo.findIncomeById.mockResolvedValue({ id: "inc-1", amount: "500", category: "Subsídios" });
      repo.updateIncome.mockResolvedValue({ id: "inc-1", amount: 800, category: "Subsídios" });

      await service.updateIncome("inc-1", { amount: 800 });

      expect(diffSpy).toHaveBeenCalledWith({ amount: "500" }, { amount: 800 });
    });

    it("deleteIncome records the deleted row, with no 'after' state", async () => {
      const full = { id: "inc-1", description: "Subsídio", amount: "500" };
      repo.findIncomeById.mockResolvedValue(full);
      repo.deleteIncome.mockResolvedValue({});

      await service.deleteIncome("inc-1");

      expect(diffSpy).toHaveBeenCalledWith(full, null);
    });
  });

  describe("getSummary", () => {
    beforeEach(() => {
      repo.sumPayments.mockResolvedValue({ _sum: { amount: "6000" } });
      repo.sumIncome.mockResolvedValue({ _sum: { amount: "500" } });
      repo.sumApprovedExpenses.mockResolvedValue({ _sum: { amount: "1500" } });
      repo.paymentsInRange.mockResolvedValue([{ amount: "6000", paidAt: new Date("2026-08-10") }]);
      repo.incomeInRange.mockResolvedValue([{ amount: "500", date: new Date("2026-08-05") }]);
      repo.approvedExpensesInRange.mockResolvedValue([{ amount: "1500", date: new Date("2026-08-15") }]);
      repo.approvedExpensesByCategory.mockResolvedValue([
        { category: "Fornecimentos", _sum: { amount: "1000" } },
        { category: "Renda", _sum: { amount: "500" } },
      ]);
      repo.outstandingInvoices.mockResolvedValue([]);
      repo.sumPaymentsByPlan.mockResolvedValue({ _sum: { amount: null } });
      repo.sumPaymentsPrivate.mockResolvedValue({ _sum: { amount: null } });
      repo.invoiceItemsInRange.mockResolvedValue([]);
      repo.noShowAppointments.mockResolvedValue([]);
    });

    it("combines payments and manual income into totalEntradas", async () => {
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.totalEntradas).toBe(6500);
    });

    it("counts only approved expenses in totalDespesas", async () => {
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.totalDespesas).toBe(1500);
    });

    it("computes balance as entradas minus despesas", async () => {
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.balance).toBe(5000);
    });

    it("buckets entradas and despesas by month", async () => {
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.monthly).toEqual([{ month: "2026-08", entradas: 6500, despesas: 1500 }]);
    });

    it("sorts category breakdown by total descending", async () => {
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.byCategory).toEqual([
        { category: "Fornecimentos", total: 1000 },
        { category: "Renda", total: 500 },
      ]);
    });
  });

  describe("getSummary — niche additions", () => {
    beforeEach(() => {
      repo.sumPayments.mockResolvedValue({ _sum: { amount: null } });
      repo.sumIncome.mockResolvedValue({ _sum: { amount: null } });
      repo.sumApprovedExpenses.mockResolvedValue({ _sum: { amount: null } });
      repo.paymentsInRange.mockResolvedValue([]);
      repo.incomeInRange.mockResolvedValue([]);
      repo.approvedExpensesInRange.mockResolvedValue([]);
      repo.approvedExpensesByCategory.mockResolvedValue([]);
      repo.outstandingInvoices.mockResolvedValue([]);
      repo.sumPaymentsByPlan.mockResolvedValue({ _sum: { amount: null } });
      repo.sumPaymentsPrivate.mockResolvedValue({ _sum: { amount: null } });
      repo.invoiceItemsInRange.mockResolvedValue([]);
      repo.noShowAppointments.mockResolvedValue([]);
    });

    it("sums outstanding invoices as total minus amountPaid, regardless of due date", async () => {
      repo.outstandingInvoices.mockResolvedValue([
        { total: "2000", amountPaid: "500", dueDate: new Date("2099-01-01") },
        { total: "1000", amountPaid: "0", dueDate: new Date("2020-01-01") },
      ]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.receivables.totalOutstanding).toBe(2500);
    });

    it("splits overdue invoices (past due date) out of the outstanding total", async () => {
      repo.outstandingInvoices.mockResolvedValue([
        { total: "2000", amountPaid: "0", dueDate: new Date("2099-01-01") },
        { total: "1000", amountPaid: "0", dueDate: new Date("2020-01-01") },
      ]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.receivables.totalOverdue).toBe(1000);
      expect(result.receivables.overdueCount).toBe(1);
    });

    it("treats an invoice with no due date as not overdue", async () => {
      repo.outstandingInvoices.mockResolvedValue([{ total: "500", amountPaid: "0", dueDate: null }]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.receivables.totalOverdue).toBe(0);
      expect(result.receivables.totalOutstanding).toBe(500);
    });

    it("splits payment revenue by payer type", async () => {
      repo.sumPaymentsByPlan.mockResolvedValue({ _sum: { amount: "4000" } });
      repo.sumPaymentsPrivate.mockResolvedValue({ _sum: { amount: "2000" } });
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.byPayerType).toEqual({ privado: 2000, planoSaude: 4000 });
    });

    it("groups invoice line items into revenue by service, sorted descending", async () => {
      repo.invoiceItemsInRange.mockResolvedValue([
        { total: "1500", description: "Consulta Geral", service: { name: "Consulta Geral" } },
        { total: "500", description: "Consulta Geral", service: { name: "Consulta Geral" } },
        { total: "3000", description: "Ecografia", service: { name: "Ecografia" } },
      ]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.byService).toEqual([
        { service: "Ecografia", total: 3000 },
        { service: "Consulta Geral", total: 2000 },
      ]);
    });

    it("falls back to the line item's free-text description when it has no linked service", async () => {
      repo.invoiceItemsInRange.mockResolvedValue([{ total: "800", description: "Ajuste manual", service: null }]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.byService).toEqual([{ service: "Ajuste manual", total: 800 }]);
    });

    it("sums lost revenue and counts no-show appointments", async () => {
      repo.noShowAppointments.mockResolvedValue([{ service: { price: "1500" } }, { service: { price: "2500" } }]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.noShowImpact).toEqual({ count: 2, lostRevenue: 4000 });
    });

    it("treats a no-show with no linked service as zero lost revenue, still counted", async () => {
      repo.noShowAppointments.mockResolvedValue([{ service: null }]);
      const result = await service.getSummary("2026-08-01", "2026-08-31");
      expect(result.noShowImpact).toEqual({ count: 1, lostRevenue: 0 });
    });
  });
});
