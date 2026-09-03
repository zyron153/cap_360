import { z } from "zod";

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

// ─── Invitations ───────────────────────────────────────────────────────────

export const InviteStaffSchema = CreateStaffSchema;
export type InviteStaffDto = z.infer<typeof InviteStaffSchema>;

// Password policy: minimum 10 chars, at least one uppercase letter and one digit (see auth.ts's
// ResetPasswordSchema/ChangePasswordSchema, which reuse the same policy).
export const ActivateInvitationSchema = z.object({
  fullName: z.string().min(2).max(150),
  password: z.string().min(10).max(72).regex(/[A-Z]/, "password must contain an uppercase letter").regex(/\d/, "password must contain a digit"),
});
export type ActivateInvitationDto = z.infer<typeof ActivateInvitationSchema>;

export interface StaffInvitationEntry {
  id: string;
  email: string;
  fullName: string;
  role: string;
  jobTitle: string | null;
  phone: string | null;
  specialtyCode: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PublicInvitationInfo {
  fullName: string;
  email: string;
  role: string;
  expired: boolean;
}

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
