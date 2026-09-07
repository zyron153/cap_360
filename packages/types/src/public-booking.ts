import { z } from "zod";
import { caboVerdePhoneSchema, dateOfBirthSchema } from "./common";

export const PublicBookingSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: caboVerdePhoneSchema,
  dateOfBirth: dateOfBirthSchema,
  email: z.string().email().optional(),
  gender: z.enum(["male", "female", "other"]).default("other"),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }),
  notes: z.string().max(500).optional(),
  consentGiven: z.literal(true, {
    errorMap: () => ({ message: "O consentimento é obrigatório" }),
  }),
});

export type PublicBookingDto = z.infer<typeof PublicBookingSchema>;
