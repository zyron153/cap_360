import { SetMetadata } from "@nestjs/common";

export const ALLOW_PASSWORD_CHANGE_KEY = "allowDuringPasswordChange";

/** Marks a route as reachable while the caller still has an admin-issued temporary password
 * (Staff.mustChangePassword). Every other authenticated route is refused with 403
 * PASSWORD_CHANGE_REQUIRED by SessionAuthGuard — only what the first-login screen itself needs
 * (reading its own profile, changing the password) should carry this. */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
