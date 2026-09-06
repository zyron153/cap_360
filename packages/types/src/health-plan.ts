import { z } from "zod";

// ─── Health Plan Product ──────────────────────────────────────────────────────

export const CreateHealthPlanProductSchema = z.object({
  name:           z.string().min(2).max(150),
  code:           z.string().min(2).max(30).regex(/^[A-Z0-9-]+$/),
  description:    z.string().max(500).optional(),
  monthlyFee:     z.number().positive(),
  maxMembers:     z.number().int().positive().optional(),
  coverageRules:  z.record(z.unknown()).optional(),
});

export const UpdateHealthPlanProductSchema = CreateHealthPlanProductSchema.partial();

export type CreateHealthPlanProductDto = z.infer<typeof CreateHealthPlanProductSchema>;
export type UpdateHealthPlanProductDto = z.infer<typeof UpdateHealthPlanProductSchema>;

// ─── Health Plan ─────────────────────────────────────────────────────────────

export const CreateHealthPlanSchema = z.object({
  productId:       z.string().uuid(),
  holderPatientId: z.string().uuid().optional(),
  companyId:       z.string().uuid().optional(),
  // Omitted = server generates one (race-safe, see HealthPlansRepository.nextPlanNumber) — the
  // client used to compute this itself (count of existing plans + 1), which could collide under
  // concurrent submissions. Still overridable: an admin typing a specific number is respected as-is.
  planNumber:      z.string().min(3).max(50).optional(),
  startDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (d) => d.holderPatientId ?? d.companyId,
  { message: "Either holderPatientId or companyId is required" }
);

export type CreateHealthPlanDto = z.infer<typeof CreateHealthPlanSchema>;

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
