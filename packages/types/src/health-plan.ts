import { z } from "zod";

// ─── Health Plan Product ──────────────────────────────────────────────────────

export const CreateHealthPlanProductSchema = z.object({
  name:           z.string().min(2).max(150),
  code:           z.string().min(2).max(30).regex(/^[A-Z0-9-]+$/),
  description:    z.string().max(500).optional(),
  monthlyFee:     z.number().positive(),
  maxMembers:     z.number().int().positive().optional(),
  coverageRules:  z.record(z.unknown()).optional(),
  // Renewal cycle length in months (1 = monthly, 12 = annual). Omitted = server default of 1.
  durationMonths: z.number().int().positive().max(60).optional(),
  // Sessions/appointments included per cycle, shared across every member of a plan on this
  // product. Omitted = unlimited — no session-based cap or expiry.
  sessionsPerCycle: z.number().int().positive().max(500).optional(),
});

export const UpdateHealthPlanProductSchema = CreateHealthPlanProductSchema.partial();

export type CreateHealthPlanProductDto = z.infer<typeof CreateHealthPlanProductSchema>;
export type UpdateHealthPlanProductDto = z.infer<typeof UpdateHealthPlanProductSchema>;

// ─── Health Plan ─────────────────────────────────────────────────────────────

export const CreateHealthPlanSchema = z.object({
  productId:       z.string().uuid(),
  companyId:       z.string().uuid().optional(),
  // Patients to enroll as members at creation time (optional — a plan can be created empty, same
  // as companies/products, and get members attached afterward via POST .../members).
  memberPatientIds: z.array(z.string().uuid()).max(50).optional(),
  // Omitted = server generates one (race-safe, see HealthPlansRepository.nextPlanNumber) — the
  // client used to compute this itself (count of existing plans + 1), which could collide under
  // concurrent submissions. Still overridable: an admin typing a specific number is respected as-is.
  planNumber:      z.string().min(3).max(50).optional(),
  startDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateHealthPlanDto = z.infer<typeof CreateHealthPlanSchema>;

export const AddHealthPlanMemberSchema = z.object({
  patientId: z.string().uuid(),
});

export type AddHealthPlanMemberDto = z.infer<typeof AddHealthPlanMemberSchema>;

// ─── Response shapes (not Zod — these describe API output, not validated input) ────────────────

export interface HealthPlanMemberSummary {
  patientId: string;
  patientName: string | null;
  addedAt: string;
}

/** The plan a patient is currently, actively covered by — the minimal summary every "does this
 * patient have a plan" consumer needs (patient list badge, profile page, dashboard, analytics). */
export interface ActiveHealthPlanSummary {
  id: string;
  planNumber: string;
  productName: string;
}

export interface HealthPlanProductSummary {
  id: string;
  name: string;
  code: string;
  monthlyFee: number;
  active: boolean;
  durationMonths: number;
  sessionsPerCycle: number | null;
  maxMembers: number | null;
}

export interface HealthPlanInstance {
  id: string;
  planNumber: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  usageCount: number;
  sessionsRemaining: number | null;
  createdAt: string;
  companyId: string | null;
  product: HealthPlanProductSummary;
  company: { id: string; name: string } | null;
  members: HealthPlanMemberSummary[];
}

// ─── Company ─────────────────────────────────────────────────────────────────

export const CreateCompanySchema = z.object({
  name:    z.string().min(2).max(150),
  taxId:   z.string().min(3).max(50),
  email:   z.string().email().optional(),
  phone:   z.string().optional(),
  address: z.string().max(300).optional(),
});

// active is here (not in Create) so PATCH /companies/:id can reactivate a company the
// DELETE endpoint deactivated — without it there is no path back from active:false.
export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  active: z.boolean().optional(),
});

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>;
