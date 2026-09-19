import { z } from "zod";
import { PaginationQuerySchema } from "./common";

export const WhatsappConversationListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["open", "resolved"]).optional(),
  /** "me" = conversations assigned to the caller; "unassigned"; or a staff id. */
  assignee: z.string().min(1).max(36).optional(),
});
export type WhatsappConversationListQuery = z.infer<typeof WhatsappConversationListQuerySchema>;

export const SendWhatsappMessageSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  idempotencyKey: z.string().uuid().optional(),
});
export type SendWhatsappMessageDto = z.infer<typeof SendWhatsappMessageSchema>;

export const AssignWhatsappConversationSchema = z.object({
  staffId: z.string().uuid().nullable(),
});
export type AssignWhatsappConversationDto = z.infer<typeof AssignWhatsappConversationSchema>;

export const LinkWhatsappPatientSchema = z.object({
  patientId: z.string().uuid(),
});
export type LinkWhatsappPatientDto = z.infer<typeof LinkWhatsappPatientSchema>;
