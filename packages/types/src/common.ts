import { z } from "zod";

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
}

// ── Shared field validators ──────────────────────────────────────────────────

/**
 * Cabo Verde phone number: 7 local digits, optionally prefixed with `238` / `+238` and any
 * separators (spaces, dashes). Returns the canonical `+238XXXXXXX` form, or `null` if it doesn't
 * fit. The API's `PatientsService.normalizePhone` is the enforcing authority; this mirrors its
 * rule so a form can validate before submit and both sides stay in sync.
 */
export function normalizeCaboVerdePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.startsWith("238") && digits.length === 10
      ? digits.slice(3)
      : digits.length === 7
        ? digits
        : null;
  return local ? `+238${local}` : null;
}

export const caboVerdePhoneSchema = z
  .string()
  .refine((v) => normalizeCaboVerdePhone(v) !== null, {
    message: "Número de Cabo Verde inválido — 7 dígitos, com ou sem +238",
  });

/** `YYYY-MM-DD`, a real calendar date, not in the future, not before 1900. */
export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato: AAAA-MM-DD")
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return (
        !Number.isNaN(d.getTime()) &&
        d.getUTCFullYear() >= 1900 &&
        d.getTime() <= Date.now()
      );
    },
    { message: "Data de nascimento inválida ou no futuro" },
  );

/** Cabo Verde NIF (tax ID): exactly 9 digits. */
export const nifSchema = z
  .string()
  .regex(/^\d{9}$/, "O NIF deve ter exatamente 9 dígitos");
