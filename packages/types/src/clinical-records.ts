import { z } from "zod";

export const RiskLevelSchema = z.enum(["none", "low", "moderate", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

const ClinicalNoteFieldsSchema = z.object({
  appointmentId: z.string().uuid().optional(),
  sessionType: z.string().min(2).max(50),
  durationMinutes: z.number().int().positive().max(600).optional(),
  // May be empty here: a draft saves half-written. Finalizing is checked by finalNoteIssues().
  presentingConcerns: z.string().max(3000),
  observations: z.string().max(3000),
  assessment: z.string().max(3000),
  plan: z.string().max(3000),
  riskLevel: RiskLevelSchema.default("none"),
  riskNotes: z.string().max(1000).optional(),
});

/** What a note needs before it can be finalized (drafts skip this). Shared by the create schema,
 * the service's update merge and the editor's Guardar button, so all three agree. */
export function finalNoteIssues(n: {
  presentingConcerns?: string;
  observations?: string;
  assessment?: string;
  plan?: string;
  riskLevel?: RiskLevel;
  riskNotes?: string | null;
}): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = (["presentingConcerns", "observations", "assessment", "plan"] as const)
    .filter((k) => !n[k]?.trim())
    .map((k) => ({ path: k, message: `${k} is required to finalize a note` }));
  if (n.riskLevel && n.riskLevel !== "none" && !n.riskNotes?.trim()) {
    issues.push({ path: "riskNotes", message: "riskNotes is required once riskLevel is above 'none'" });
  }
  return issues;
}

export const CreateClinicalNoteSchema = ClinicalNoteFieldsSchema.extend({
  /** true = autosaved work-in-progress, editable until finalized (draft: false). */
  draft: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.draft) return;
  for (const i of finalNoteIssues(data)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: i.message, path: [i.path] });
});
export type CreateClinicalNoteDto = z.infer<typeof CreateClinicalNoteSchema>;

/** `code` of the 409 body when a write loses to a newer save of the same note; `note` is the current one. */
export const NOTE_CHANGED_CODE = "NOTE_CHANGED";
/** `code` of the 409 from DELETE /clinical-notes/:id on a finalized note — a clinical record, never deletable. */
export const NOTE_FINALIZED_CODE = "NOTE_FINALIZED";
/** `code` of the 409 from DELETE /clinical-notes/:id when a prescription or referral still refers to the draft. */
export const NOTE_HAS_LINKED_RECORDS_CODE = "NOTE_HAS_LINKED_RECORDS";

// No cross-field check here (a partial update may touch none of the required fields) — the
// service merges the update onto the stored note and runs finalNoteIssues() on the result.
export const UpdateClinicalNoteSchema = ClinicalNoteFieldsSchema.partial().extend({
  /** false = finalize a draft. true on an already-final note is rejected by the service. */
  draft: z.boolean().optional(),
  /** The note's `updatedAt` as the caller last saw it. When present, the write only lands if nobody
   * has saved since (otherwise 409 + the current note) — two tabs can't silently overwrite each
   * other. Absent = unconditional (scripts, tests). */
  expectedUpdatedAt: z.string().datetime().optional(),
});
export type UpdateClinicalNoteDto = z.infer<typeof UpdateClinicalNoteSchema>;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD")
  // "2026-13-45" matches the shape but isn't a day: it reached Prisma as an Invalid Date and came back a 500.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    // Invalid Date throws on toISOString(); "2026-02-30" parses (as 2 March) but doesn't round-trip.
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Not a real calendar day");

/** Pages are 1-based. The cap keeps `(page - 1) * limit` inside what the database can skip (an absurd page used to 500). */
const pageNumber = z.coerce.number().int().positive().max(100_000).default(1);

/** Filters for GET /clinical-notes (the doctor's history). Clinical text is encrypted at rest so
 * it can't be searched; `q` matches the patient's name. */
export const ClinicalNoteListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  riskLevel: RiskLevelSchema.optional(),
  status: z.enum(["draft", "final"]).optional(),
  appointmentId: z.string().uuid().optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  // Same page/limit convention as the invoice list; the response stays a plain array (a short page
  // means "no more"), so the editor's and the queue's lookups don't change.
  page: pageNumber,
  limit: z.coerce.number().int().positive().max(100).default(100),
});
// z.input: page/limit are optional for in-process callers; the controller's pipe always fills them.
export type ClinicalNoteListQuery = z.input<typeof ClinicalNoteListQuerySchema>;

/** Paging for the per-patient lists (`GET /patients/:id/clinical-notes | prescriptions | referrals`). Still plain
 * arrays, newest first, a short page means "no more" — the same convention as GET /clinical-notes. */
export const ClinicalListQuerySchema = z.object({
  page: pageNumber,
  limit: z.coerce.number().int().positive().max(100).default(100),
});
export type ClinicalListQuery = z.input<typeof ClinicalListQuerySchema>;

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
  /** null = still a draft. */
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Cross-author read report (admin) ──────────────────────────────────────────────────────────────────────
// Notes are author-only except one narrow, read-only exception (M7 §3.1): while a patient is in treatment today,
// a doctor may read other authors' finalized notes. Every such read is marked in audit_log; this is the admin's
// view of those marks (GET /clinical-notes/access-log) so the exception can be reviewed instead of trusted.

export const ClinicalAccessLogQuerySchema = z.object({
  page: pageNumber,
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ClinicalAccessLogQuery = z.input<typeof ClinicalAccessLogQuerySchema>;

export interface ClinicalAccessLogEntry {
  id: string;
  /** When the read happened (ISO). */
  at: string;
  /** Who read another clinician's notes. `fullName` is null if that staff row no longer exists. */
  reader: { id: string | null; email: string | null; fullName: string | null };
  /** The patient whose notes were read (null when it can't be resolved); `fullName` is null for an erased patient. */
  patient: { id: string; fullName: string | null } | null;
  /** Why it was allowed — today always "patient in treatment today". */
  basis: string;
  /** List reads (`GET /patients/:id/clinical-notes`): how many notes of other authors came back. */
  otherAuthorsNotes: number | null;
  /** By-id reads (`GET /clinical-notes/:id`): who wrote the note that was read, and which note. */
  note: { id: string; authorStaffId: string } | null;
}

// ─── Prescriptions ─────────────────────────────────────────────────────────────

export const PrescriptionItemSchema = z.object({
  // trim() first: "   " used to pass min(1) and save a prescription line with a blank drug.
  drugName: z.string().trim().min(1).max(150),
  dosage: z.string().trim().min(1).max(100),
  frequency: z.string().trim().min(1).max(100),
  durationDays: z.number().int().positive().max(3650).optional(),
  instructions: z.string().max(300).optional(),
});

export const CreatePrescriptionSchema = z.object({
  clinicalNoteId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  items: z.array(PrescriptionItemSchema).min(1).max(50),
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
    externalProviderName: z.string().trim().min(2).max(150).optional(),
    externalSpecialty: z.string().max(100).optional(),
    reason: z.string().trim().min(3).max(1000),
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
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;

/** Where a referral may go next, for the referrer and the target clinician. `completed` is final; `declined` can be
 * re-opened as `pending`; `scheduled` can be undone (back to `pending`). Admin may correct any status, and repeating
 * the current status is a harmless no-op. Enforced by ClinicalRecordsService.updateReferralStatus; the UI can use it
 * to offer only valid buttons. */
export const REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  pending: ["scheduled", "completed", "declined"],
  scheduled: ["pending", "completed", "declined"],
  completed: [],
  declined: ["pending"],
};

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
