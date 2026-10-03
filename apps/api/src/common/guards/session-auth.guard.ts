import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SessionService, SESSION_COOKIE_NAME } from "../../modules/auth/session.service";
import { StaffRepository } from "../../modules/staff/staff.repository";

@Injectable()
export class SessionAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly staffRepo: StaffRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Fail-safe by default: bypass requires an explicit opt-in, not just an unset var.
    const devBypass = process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS === "true";

    const request = context.switchToHttp().getRequest();
    const sessionId = request.cookies?.[SESSION_COOKIE_NAME];
    const session = sessionId ? await this.sessions.get(sessionId) : null;

    // Catches a staff member deactivated (soft-deleted) mid-session — findById already filters
    // deletedAt: null, so a deactivated account's still-live session gets rejected on its very
    // next request instead of staying valid for up to SESSION_TTL_SECONDS more.
    const staff = session ? await this.staffRepo.findById(session.staffId) : null;

    if (!session || !staff) {
      // The dev bypass is only the fallback for "nobody is logged in" (or a stale cookie). A real,
      // live session always wins — otherwise anyone who logs in during dev (e.g. a user the admin
      // just created) would still be treated as the seeded admin, and "change my password" would be
      // checked against the admin's password instead of theirs.
      if (devBypass) {
        request.user = {
          sub: "65093d59-792a-4792-bfc3-300c37725ac9", // must match seed.ts's ADMIN_ID
          email: "capjacobvicente@gmail.com",
          roles: ["admin"],
        };
        return true;
      }
      if (!sessionId) throw new UnauthorizedException("Missing session");
      if (!session) throw new UnauthorizedException("Invalid or expired session");
      throw new UnauthorizedException("Account deactivated");
    }

    request.user = { sub: session.staffId, email: session.email, roles: session.roles };
    return true;
  }
}
