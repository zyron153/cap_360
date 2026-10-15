import { z } from "zod";
import { EFATURA_NIF_RE } from "./efatura";

/** The clinic's identity (Configurações → Clínica). `name` and `nif` double as the emitter of every
 * fiscal document sent to DNRE, so they are validated like the platform will validate them. */
export const ClinicSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "O nome da clínica é obrigatório").max(150),
    // Empty is allowed (not configured yet); anything else must be a valid Cabo Verde NIF.
    nif: z.string().trim().refine((v) => v === "" || EFATURA_NIF_RE.test(v), "O NIF deve ter 9 dígitos e começar por 1–9"),
    website: z.string().trim().max(200).default(""),
    phone: z.string().trim().max(30).default(""),
    email: z.string().trim().max(150).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email inválido").default(""),
    address: z.string().trim().max(300).default(""),
    country: z.string().trim().max(60).default("Cabo Verde"),
    hours: z
      .array(z.object({ day: z.string().max(30), open: z.string().max(5), close: z.string().max(5), active: z.boolean() }))
      .max(7)
      .optional(),
  })
  .passthrough();
export type ClinicSettingsDto = z.infer<typeof ClinicSettingsSchema>;
