import { z } from "zod";

export const AppointmentStatus = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CHECKED_IN: "checked_in",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
} as const;
export type AppointmentStatus =
  (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const CreateAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  notes: z.string().max(500).optional(),
  source: z.enum(["web", "whatsapp", "phone", "walk_in"]).default("web"),
  // Client-generated once per form-open (not per submit-click) — a retried request with the
  // same key returns the original appointment instead of creating a duplicate.
  idempotencyKey: z.string().max(100).optional(),
});
export type CreateAppointmentDto = z.infer<typeof CreateAppointmentSchema>;

export const AvailabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export interface TimeSlot {
  start: string;
  end: string;
  staffId: string;
  staffName: string;
  available: boolean;
}

export const UpdateAppointmentStatusSchema = z.object({
  status: z.enum([
    "confirmed",
    "checked_in",
    "completed",
    "cancelled",
    "no_show",
  ]),
  cancellationReason: z.string().max(300).optional(),
});
export type UpdateAppointmentStatusDto = z.infer<
  typeof UpdateAppointmentStatusSchema
>;

export const RescheduleAppointmentSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
});
export type RescheduleAppointmentDto = z.infer<
  typeof RescheduleAppointmentSchema
>;

export interface Appointment {
  id: string;
  patientId: string;
  staffId: string;
  serviceId: string;
  roomId?: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  source: string;
  notes?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid calendar date" });

export const AppointmentCalendarQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  staffId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
});
export type AppointmentCalendarQuery = z.infer<
  typeof AppointmentCalendarQuerySchema
>;

export const JoinWaitlistSchema = z.object({
  patientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  preferredDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferredDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(300).optional(),
});
export type JoinWaitlistDto = z.infer<typeof JoinWaitlistSchema>;
