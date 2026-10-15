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

// Password policy: minimum 10 chars, at least one uppercase letter and one digit. Shared by every
// place a password is chosen — reset by email, self-service change, and an admin setting a user's
// password (creating a user or "Alterar senha"). apps/web/lib/password-policy.ts mirrors it.
export const PasswordSchema = z.string().min(10).max(72).regex(/[A-Z]/, "password must contain an uppercase letter").regex(/\d/, "password must contain a digit");

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: PasswordSchema,
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export interface AuthenticatedStaff {
  id: string;
  fullName: string;
  email: string;
  role: string;
}
