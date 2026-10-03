import { z } from "zod";
import { PasswordSchema } from "./auth";

const AvailabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const CreateStaffSchema = z.object({
  fullName: z.string().min(2).max(150),
  email: z.string().email(),
  // corporate_hr added alongside its companyId field below — previously omitted here entirely,
  // which meant no corporate_hr account could ever be created through the invite flow.
  role: z.enum(["admin", "doctor", "nurse", "receptionist", "lab_tech", "corporate_hr"]),
  jobTitle: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  specialtyCode: z.string().max(50).optional(),
  /// Which Company a corporate_hr account is scoped to (see Staff.companyId). Meaningless for
  /// every other role — not validated as required-when-corporate_hr here, since the invite flow
  /// only warns/omits rather than hard-failing on a mismatched combination.
  companyId: z.string().uuid().optional(),
  availability: z.array(AvailabilitySchema).optional(),
});
export type CreateStaffDto = z.infer<typeof CreateStaffSchema>;

export const UpdateStaffSchema = CreateStaffSchema.partial();
export type UpdateStaffDto = z.infer<typeof UpdateStaffSchema>;

// ─── Admin-set passwords ────────────────────────────────────────────────────
// The admin chooses the password when creating a user (POST /staff) and can change it later
// (PATCH /staff/:id/password, "Alterar senha" in Gestão de Acesso) — no email is sent and the user
// isn't forced to change it. Same policy as every other password (PasswordSchema in auth.ts).

export const CreateStaffAccountSchema = CreateStaffSchema.extend({ password: PasswordSchema });
export type CreateStaffAccountDto = z.infer<typeof CreateStaffAccountSchema>;

export const SetStaffPasswordSchema = z.object({ password: PasswordSchema });
export type SetStaffPasswordDto = z.infer<typeof SetStaffPasswordSchema>;

// ─── Leave Requests ─────────────────────────────────────────────────────────

export const CreateLeaveRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(300).optional(),
}).refine((d) => d.endDate >= d.startDate, { message: "endDate must not be before startDate", path: ["endDate"] });
export type CreateLeaveRequestDto = z.infer<typeof CreateLeaveRequestSchema>;

export const LeaveRequestDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});
export type LeaveRequestDecisionDto = z.infer<typeof LeaveRequestDecisionSchema>;

export interface LeaveRequestEntry {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

// ─── Shift Overrides ────────────────────────────────────────────────────────
// A date-specific override of that staff member's weekly StaffAvailability template (e.g. a
// shorter Saturday, an extra one-off shift) — one row per staff per date (@@unique in the schema).

export const UpsertStaffShiftSchema = z.object({
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().max(200).optional(),
}).refine((d) => d.endTime > d.startTime, { message: "endTime must be after startTime", path: ["endTime"] });
export type UpsertStaffShiftDto = z.infer<typeof UpsertStaffShiftSchema>;

export interface StaffShiftEntry {
  id: string;
  staffId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  notes: string | null;
}
