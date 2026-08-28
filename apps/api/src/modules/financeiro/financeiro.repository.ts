import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

const EXPENSE_INCLUDE = {
  requestedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
};

@Injectable()
export class FinanceiroRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Despesas ─────────────────────────────────────────────
  findExpenses(where: Prisma.ExpenseWhereInput, skip: number, take: number) {
    return this.prisma.expense.findMany({ where, include: EXPENSE_INCLUDE, orderBy: { date: "desc" }, skip, take });
  }
  countExpenses(where: Prisma.ExpenseWhereInput) {
    return this.prisma.expense.count({ where });
  }
  findExpenseById(id: string) {
    return this.prisma.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });
  }
  createExpense(data: Prisma.ExpenseCreateInput) {
    return this.prisma.expense.create({ data, include: EXPENSE_INCLUDE });
  }
  updateExpense(id: string, data: Prisma.ExpenseUpdateInput) {
    return this.prisma.expense.update({ where: { id }, data, include: EXPENSE_INCLUDE });
  }
  deleteExpense(id: string) {
    return this.prisma.expense.delete({ where: { id } });
  }
  sumApprovedExpenses(where: Prisma.ExpenseWhereInput) {
    return this.prisma.expense.aggregate({ where: { ...where, status: "approved" }, _sum: { amount: true } });
  }
  approvedExpensesByCategory(from: Date, to: Date) {
    return this.prisma.expense.groupBy({
      by: ["category"],
      where: { status: "approved", date: { gte: from, lte: to } },
      _sum: { amount: true },
    });
  }
  approvedExpensesInRange(from: Date, to: Date) {
    return this.prisma.expense.findMany({
      where: { status: "approved", date: { gte: from, lte: to } },
      select: { amount: true, date: true },
    });
  }

  // ── Entradas (manual income) ────────────────────────────
  findIncome(where: Prisma.IncomeWhereInput, skip: number, take: number) {
    return this.prisma.income.findMany({ where, orderBy: { date: "desc" }, skip, take });
  }
  countIncome(where: Prisma.IncomeWhereInput) {
    return this.prisma.income.count({ where });
  }
  findIncomeById(id: string) {
    return this.prisma.income.findUnique({ where: { id } });
  }
  createIncome(data: Prisma.IncomeCreateInput) {
    return this.prisma.income.create({ data });
  }
  updateIncome(id: string, data: Prisma.IncomeUpdateInput) {
    return this.prisma.income.update({ where: { id }, data });
  }
  deleteIncome(id: string) {
    return this.prisma.income.delete({ where: { id } });
  }
  sumIncome(where: Prisma.IncomeWhereInput) {
    return this.prisma.income.aggregate({ where, _sum: { amount: true } });
  }
  incomeInRange(from: Date, to: Date) {
    return this.prisma.income.findMany({ where: { date: { gte: from, lte: to } }, select: { amount: true, date: true } });
  }

  // ── Payments (invoice-linked income — existing table) ───
  sumPayments(from: Date, to: Date) {
    return this.prisma.payment.aggregate({ where: { paidAt: { gte: from, lte: to } }, _sum: { amount: true } });
  }
  paymentsInRange(from: Date, to: Date) {
    return this.prisma.payment.findMany({ where: { paidAt: { gte: from, lte: to } }, select: { amount: true, paidAt: true } });
  }
}
