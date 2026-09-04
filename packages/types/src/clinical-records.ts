import { z } from "zod";

export const RiskLevelSchema = z.enum(["none", "low", "moderate", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

const ClinicalNoteFieldsSchema = z.object({
  appointmentId: z.string().uuid().optional(),
  sessionType: z.string().min(2).max(50),
  durationMinutes: z.number().int().positive().max(600).optional(),
  presentingConcerns: z.string().min(1).max(3000),
  observations: z.string().min(1).max(3000),
  assessment: z.string().min(1).max(3000),
  plan: z.string().min(1).max(3000),
  riskLevel: RiskLevelSchema.default("none"),
  riskNotes: z.string().max(1000).optional(),
});

export const CreateClinicalNoteSchema = ClinicalNoteFieldsSchema.refine(
  (data) => data.riskLevel === "none" || !!data.riskNotes?.trim(),
  { message: "riskNotes is required once riskLevel is above 'none'", path: ["riskNotes"] }
);
export type CreateClinicalNoteDto = z.infer<typeof CreateClinicalNoteSchema>;

// No cross-field riskLevel/riskNotes check here (a partial update may touch neither) — the
// service re-derives the effective riskLevel against any existing riskNotes before saving.
export const UpdateClinicalNoteSchema = ClinicalNoteFieldsSchema.partial();
export type UpdateClinicalNoteDto = z.infer<typeof UpdateClinicalNoteSchema>;

export interface ClinicalNoteEntry {
  id: string;
  patientId: string;
  appointmentId: string | null;
  authorStaffId: string;
  author?: { fullName: string };
  sessionType: string;
  durationMinutes: number | null;
  presentingConcerns: string;
  observations: string;
  assessment: string;
  plan: string;
  riskLevel: RiskLevel;
  riskNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Prescriptions ─────────────────────────────────────────────────────────────

export const PrescriptionItemSchema = z.object({
  drugName: z.string().min(1).max(150),
  dosage: z.string().min(1).max(100),
  frequency: z.string().min(1).max(100),
  durationDays: z.number().int().positive().max(3650).optional(),
  instructions: z.string().max(300).optional(),
});

export const CreatePrescriptionSchema = z.object({
  clinicalNoteId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  items: z.array(PrescriptionItemSchema).min(1),
});
export type CreatePrescriptionDto = z.infer<typeof CreatePrescriptionSchema>;

export interface PrescriptionEntry {
  id: string;
  patientId: string;
  clinicalNoteId: string | null;
  prescribedByStaffId: string;
  prescribedBy?: { fullName: string };
  issuedAt: string;
  notes: string | null;
  items: Array<{
    id: string;
    drugName: string;
    dosage: string;
    frequency: string;
    durationDays: number | null;
    instructions: string | null;
  }>;
}

// ─── Referrals ─────────────────────────────────────────────────────────────────

export const CreateReferralSchema = z
  .object({
    clinicalNoteId: z.string().uuid().optional(),
    type: z.enum(["internal", "external"]),
    targetStaffId: z.string().uuid().optional(),
    externalProviderName: z.string().min(2).max(150).optional(),
    externalSpecialty: z.string().max(100).optional(),
    reason: z.string().min(3).max(1000),
  })
  .refine((d) => d.type !== "internal" || !!d.targetStaffId, {
    message: "targetStaffId is required for an internal referral",
    path: ["targetStaffId"],
  })
  .refine((d) => d.type !== "external" || !!d.externalProviderName?.trim(), {
    message: "externalProviderName is required for an external referral",
    path: ["externalProviderName"],
  });
export type CreateReferralDto = z.infer<typeof CreateReferralSchema>;

export const ReferralStatusSchema = z.enum(["pending", "scheduled", "completed", "declined"]);
export const UpdateReferralStatusSchema = z.object({ status: ReferralStatusSchema });
export type UpdateReferralStatusDto = z.infer<typeof UpdateReferralStatusSchema>;

export interface ReferralEntry {
  id: string;
  patientId: string;
  clinicalNoteId: string | null;
  referredByStaffId: string;
  referredBy?: { fullName: string };
  type: "internal" | "external";
  targetStaffId: string | null;
  targetStaff?: { fullName: string } | null;
  externalProviderName: string | null;
  externalSpecialty: string | null;
  reason: string;
  status: z.infer<typeof ReferralStatusSchema>;
  createdAt: string;
  updatedAt: string;
}
