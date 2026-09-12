import { z } from "zod";

export const InvoiceStatus = {
  DRAFT: "draft",
  ISSUED: "issued",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentMethod = {
  CASH: "cash",
  BANK_TRANSFER: "bank_transfer",
  HEALTH_PLAN: "health_plan",
  VINTI4: "vinti4",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const CreateInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  healthPlanId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        description: z.string().max(200),
        quantity: z.number().int().positive().default(1),
        unitPrice: z.number().positive(),
      })
    )
    .min(1),
  notes: z.string().max(500).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Required (checked in BillingService, not here — Zod can't see the catalogue price to compare
  // against) only when an admin bills a catalogued service below its catalogue price.
  priceOverrideReason: z.string().min(3).max(300).optional(),
});
export type CreateInvoiceDto = z.infer<typeof CreateInvoiceSchema>;

export const RecordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["cash", "bank_transfer", "health_plan", "vinti4"]),
  reference: z.string().max(100).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  // Client-generated once per form-open (not per submit-click) — a retried request with the
  // same key returns the original payment instead of recording a duplicate.
  idempotencyKey: z.string().max(100).optional(),
});
export type RecordPaymentDto = z.infer<typeof RecordPaymentSchema>;

export const CancelInvoiceSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CancelInvoiceDto = z.infer<typeof CancelInvoiceSchema>;

export const UpdateInvoiceItemSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    unitPrice: z.number().positive().optional(),
    // When set, unitPrice is recomputed server-side as (durationMinutes / service's standard
    // duration) * catalogue price — only valid on the line item generated from this invoice's
    // appointment, since that's the only item with a duration to scale against.
    durationMinutes: z.number().int().positive().max(600).optional(),
    // Same rule as CreateInvoiceSchema: required only when a manual unitPrice undercuts the
    // catalogue price on a catalogued item.
    priceOverrideReason: z.string().min(3).max(300).optional(),
  })
  .refine(
    (d) => d.quantity !== undefined || d.unitPrice !== undefined || d.durationMinutes !== undefined,
    { message: "At least one of quantity, unitPrice or durationMinutes must be provided" }
  );
export type UpdateInvoiceItemDto = z.infer<typeof UpdateInvoiceItemSchema>;

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  // Null on off-catalogue/custom lines — a health-plan discount line has no underlying Service.
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceAppointmentContext {
  id: string;
  serviceId: string;
  durationMinutes: number;
  service?: { durationMinutes: number } | null;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  recordedById?: string | null;
  recordedBy?: { id: string; fullName: string } | null;
  paidAt: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  appointmentId?: string | null;
  healthPlanId?: string | null;
  status: InvoiceStatus;
  subtotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  notes?: string | null;
  dueDate?: string | null;
  issuedAt?: string | null;
  cancelReason?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItem[];
  payments?: Payment[];
  appointment?: InvoiceAppointmentContext | null;
}

export const EFaturaStatus = {
  PENDING: "pending",
  SUBMITTING: "submitting",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  ERROR: "error",
} as const;
export type EFaturaStatus = (typeof EFaturaStatus)[keyof typeof EFaturaStatus];

export interface EFaturaSubmission {
  id: string;
  invoiceId: string;
  status: EFaturaStatus;
  atcud: string | null;
  efaturaRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  submittedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EFaturaConfig {
  enabled: boolean;
  sandbox: boolean;
  endpoint: string;
  nifContribuinte: string;
  apiKey: string;
  nomeEmpresa: string;
}

export const InvoiceListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z
    .enum(["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"])
    .optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;
