import { z } from "zod";
import { PaymentMethod } from "./billing";

export const ExpenseStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

const expenseFields = {
  description: z.string().min(2).max(200),
  category:    z.string().min(1).max(100),
  amount:      z.number().positive(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplier:    z.string().max(150).nullable().optional(),
  method:      z.enum(["cash", "bank_transfer", "health_plan", "vinti4"]),
  reference:   z.string().max(100).nullable().optional(),
  notes:       z.string().max(500).nullable().optional(),
};

export const CreateExpenseSchema = z.object(expenseFields);
export type CreateExpenseDto = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = z.object(expenseFields).partial();
export type UpdateExpenseDto = z.infer<typeof UpdateExpenseSchema>;

export const ExpenseDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});
export type ExpenseDecisionDto = z.infer<typeof ExpenseDecisionSchema>;

export interface ExpenseEntry {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: string;
  supplier: string | null;
  method: PaymentMethod;
  reference: string | null;
  receiptR2Key: string | null;
  status: ExpenseStatus;
  notes: string | null;
  requestedById: string | null;
  requestedBy?: { id: string; fullName: string } | null;
  approvedById: string | null;
  approvedBy?: { id: string; fullName: string } | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const incomeFields = {
  description: z.string().min(2).max(200),
  category:    z.string().min(1).max(100),
  amount:      z.number().positive(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:       z.string().max(500).nullable().optional(),
};

export const CreateIncomeSchema = z.object(incomeFields);
export type CreateIncomeDto = z.infer<typeof CreateIncomeSchema>;

export const UpdateIncomeSchema = z.object(incomeFields).partial();
export type UpdateIncomeDto = z.infer<typeof UpdateIncomeSchema>;

export interface IncomeEntry {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const FinanceiroListQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type FinanceiroListQuery = z.infer<typeof FinanceiroListQuerySchema>;

export interface FinanceiroSummary {
  totalEntradas: number;
  totalDespesas: number;
  balance: number;
  monthly: { month: string; entradas: number; despesas: number }[];
  byCategory: { category: string; total: number }[];
}
