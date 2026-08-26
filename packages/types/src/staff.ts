import { z } from "zod";

const AvailabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const CreateStaffSchema = z.object({
  fullName: z.string().min(2).max(150),
  email: z.string().email(),
  role: z.enum(["admin", "doctor", "nurse", "receptionist", "lab_tech"]),
  jobTitle: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  specialtyCode: z.string().max(50).optional(),
  availability: z.array(AvailabilitySchema).optional(),
});
export type CreateStaffDto = z.infer<typeof CreateStaffSchema>;

export const UpdateStaffSchema = CreateStaffSchema.partial();
export type UpdateStaffDto = z.infer<typeof UpdateStaffSchema>;

// ─── Invitations ───────────────────────────────────────────────────────────

export const InviteStaffSchema = CreateStaffSchema;
export type InviteStaffDto = z.infer<typeof InviteStaffSchema>;

// Mirrors the Keycloak realm's passwordPolicy: length(10) and upperCase(1) and digits(1)
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
