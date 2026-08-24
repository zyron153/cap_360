import { z } from "zod";

const serviceFields = {
  name:            z.string().min(2).max(150),
  code:            z.string().min(2).max(30).regex(/^[A-Z0-9-]+$/, "code must be UPPERCASE-WITH-DASHES"),
  description:     z.string().max(500).nullable().optional(),
  durationMinutes: z.number().int().positive(),
  price:           z.number().nonnegative(),
};

export const CreateServiceSchema = z.object({
  ...serviceFields,
  durationMinutes: serviceFields.durationMinutes.default(30),
});
export type CreateServiceDto = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = z.object({
  ...serviceFields,
  active: z.boolean(),
}).partial();
export type UpdateServiceDto = z.infer<typeof UpdateServiceSchema>;

export interface ServiceEntry {
  id: string;
  name: string;
  code: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
