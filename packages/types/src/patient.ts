import { z } from "zod";

export const CreatePatientSchema = z.object({
  fullName: z.string().min(2).max(150),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  gender: z.enum(["male", "female", "other"]),
  nif: z.string().min(6).max(20).optional(),
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/, "E.164 format required"),
  email: z.string().email().optional(),
  address: z.string().max(300).optional(),
  emergencyContactName: z.string().max(150).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  consentGiven: z.boolean(),
  healthPlanId: z.string().uuid().optional(),
});
export type CreatePatientDto = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = CreatePatientSchema.partial().omit({
  consentGiven: true,
});
export type UpdatePatientDto = z.infer<typeof UpdatePatientSchema>;

export interface Patient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other";
  nif?: string | null;
  phone: string;
  email?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  consentGiven: boolean;
  healthPlanId?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PatientSearchSchema = z.object({
  q: z.string().optional(),
  planFilter: z.enum(["all", "plan", "none"]).default("all"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type PatientSearchQuery = z.infer<typeof PatientSearchSchema>;

export const CreatePatientNoteSchema = z.object({
  content: z.string().min(1).max(2000),
});
export type CreatePatientNoteDto = z.infer<typeof CreatePatientNoteSchema>;

export interface PatientNote {
  id: string;
  patientId: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

export const DocumentTypeSchema = z.enum([
  "national_id", "consent_form", "exam_result", "prescription", "referral", "other",
]);
export const UploadPatientDocumentSchema = z.object({
  type: DocumentTypeSchema,
});
export type UploadPatientDocumentDto = z.infer<typeof UploadPatientDocumentSchema>;

export interface PatientDocumentEntry {
  id: string;
  patientId: string;
  type: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  type: "appointment" | "communication" | "invoice" | "note";
  title: string;
  description?: string;
  date: string;
  metadata?: Record<string, unknown>;
}
