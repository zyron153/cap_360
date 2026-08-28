import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { FinanceiroRepository } from "./financeiro.repository";
import { R2Service } from "../../common/services/r2.service";
import { StaffService } from "../staff/staff.service";
import {
  CreateExpenseDto, UpdateExpenseDto, ExpenseDecisionDto,
  CreateIncomeDto, UpdateIncomeDto,
  FinanceiroListQuery, FinanceiroSummary,
} from "@cap/types";

interface UploadedReceipt {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

function dateRange(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}),
  };
}

@Injectable()
export class FinanceiroService {
  constructor(
    private readonly repo: FinanceiroRepository,
    private readonly r2: R2Service,
    private readonly staff: StaffService,
  ) {}

  // ── Despesas ─────────────────────────────────────────────
  async listExpenses(query: FinanceiroListQuery) {
    const { from, to, status, page, limit } = query;
    const where = {
      ...(status ? { status } : {}),
      ...(from || to ? { date: dateRange(from, to) } : {}),
    };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.repo.findExpenses(where, skip, limit),
      this.repo.countExpenses(where),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createExpense(dto: CreateExpenseDto, keycloakId: string) {
    const requester = await this.staff.findMe(keycloakId);
    return this.repo.createExpense({
      description: dto.description,
      category: dto.category,
      amount: dto.amount,
      date: new Date(dto.date),
      supplier: dto.supplier ?? null,
      method: dto.method,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
      ...(requester.id ? { requestedBy: { connect: { id: requester.id } } } : {}),
    });
  }

  async updateExpense(id: string, dto: UpdateExpenseDto) {
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new NotFoundException(`Expense ${id} not found`);
    if (existing.status !== "pending") throw new BadRequestException("Só é possível editar despesas pendentes");
    return this.repo.updateExpense(id, {
      ...dto,
      ...(dto.date ? { date: new Date(dto.date) } : {}),
    });
  }

  async decideExpense(id: string, dto: ExpenseDecisionDto, keycloakId: string) {
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new NotFoundException(`Expense ${id} not found`);
    if (existing.status !== "pending") throw new BadRequestException("Esta despesa já foi decidida");
    const approver = await this.staff.findMe(keycloakId);
    return this.repo.updateExpense(id, {
      status: dto.status,
      approvedAt: new Date(),
      ...(approver.id ? { approvedBy: { connect: { id: approver.id } } } : {}),
    });
  }

  async deleteExpense(id: string) {
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new NotFoundException(`Expense ${id} not found`);
    return this.repo.deleteExpense(id);
  }

  async uploadReceipt(id: string, file: UploadedReceipt) {
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new NotFoundException(`Expense ${id} not found`);
    const ext = file.originalname.split(".").pop() || "bin";
    const key = `expenses/${id}/receipt-${Date.now()}.${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return this.repo.updateExpense(id, { receiptR2Key: key });
  }

  async getReceiptUrl(id: string) {
    const existing = await this.repo.findExpenseById(id);
    if (!existing) throw new NotFoundException(`Expense ${id} not found`);
    if (!existing.receiptR2Key) throw new NotFoundException("Sem recibo anexado");
    return { url: await this.r2.signedUrl(existing.receiptR2Key) };
  }

  // ── Entradas (manual income) ────────────────────────────
  async listIncome(query: FinanceiroListQuery) {
    const { from, to, page, limit } = query;
    const where = from || to ? { date: dateRange(from, to) } : {};
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.repo.findIncome(where, skip, limit),
      this.repo.countIncome(where),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  createIncome(dto: CreateIncomeDto) {
    return this.repo.createIncome({ ...dto, date: new Date(dto.date), notes: dto.notes ?? null });
  }

  async updateIncome(id: string, dto: UpdateIncomeDto) {
    const existing = await this.repo.findIncomeById(id);
    if (!existing) throw new NotFoundException(`Income ${id} not found`);
    return this.repo.updateIncome(id, { ...dto, ...(dto.date ? { date: new Date(dto.date) } : {}) });
  }

  async deleteIncome(id: string) {
    const existing = await this.repo.findIncomeById(id);
    if (!existing) throw new NotFoundException(`Income ${id} not found`);
    return this.repo.deleteIncome(id);
  }

  // ── Resumo (dashboard) ──────────────────────────────────
  async getSummary(from?: string, to?: string): Promise<FinanceiroSummary> {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(`${to}T23:59:59Z`) : new Date();

    const [paymentsSum, incomeSum, expensesSum, payments, income, expenses, expensesByCategory] = await Promise.all([
      this.repo.sumPayments(fromDate, toDate),
      this.repo.sumIncome({ date: { gte: fromDate, lte: toDate } }),
      this.repo.sumApprovedExpenses({ date: { gte: fromDate, lte: toDate } }),
      this.repo.paymentsInRange(fromDate, toDate),
      this.repo.incomeInRange(fromDate, toDate),
      this.repo.approvedExpensesInRange(fromDate, toDate),
      this.repo.approvedExpensesByCategory(fromDate, toDate),
    ]);

    const totalEntradas = Number(paymentsSum._sum.amount ?? 0) + Number(incomeSum._sum.amount ?? 0);
    const totalDespesas = Number(expensesSum._sum.amount ?? 0);

    const monthly = new Map<string, { entradas: number; despesas: number }>();
    const bump = (date: Date, key: "entradas" | "despesas", amount: number) => {
      const month = date.toISOString().slice(0, 7);
      const row = monthly.get(month) ?? { entradas: 0, despesas: 0 };
      row[key] += amount;
      monthly.set(month, row);
    };
    payments.forEach((p) => bump(p.paidAt, "entradas", Number(p.amount)));
    income.forEach((i) => bump(i.date, "entradas", Number(i.amount)));
    expenses.forEach((e) => bump(e.date, "despesas", Number(e.amount)));

    const byCategory = expensesByCategory
      .map((c) => ({ category: c.category, total: Number(c._sum.amount ?? 0) }))
      .sort((a, b) => b.total - a.total);

    return {
      totalEntradas,
      totalDespesas,
      balance: totalEntradas - totalDespesas,
      monthly: Array.from(monthly.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ month, ...v })),
      byCategory,
    };
  }
}
