import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;

// Same policy as ActivateInvitationSchema (staff.ts) — kept in sync deliberately.
export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10).max(72).regex(/[A-Z]/, "password must contain an uppercase letter").regex(/\d/, "password must contain a digit"),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: ResetPasswordSchema.shape.password,
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export interface AuthenticatedStaff {
  id: string;
  fullName: string;
  email: string;
  role: string;
}
