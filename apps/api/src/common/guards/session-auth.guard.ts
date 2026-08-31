import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SessionService, SESSION_COOKIE_NAME } from "../../modules/auth/session.service";

@Injectable()
export class SessionAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Fail-safe by default: bypass requires an explicit opt-in, not just an unset var.
    if (process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS === "true") {
      const request = context.switchToHttp().getRequest();
      request.user = {
        sub: "65093d59-792a-4792-bfc3-300c37725ac9", // must match seed.ts's ADMIN_ID
        email: "capjacobvicente@gmail.com",
        roles: ["admin"],
      };
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const sessionId = request.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId) throw new UnauthorizedException("Missing session");

    const session = await this.sessions.get(sessionId);
    if (!session) throw new UnauthorizedException("Invalid or expired session");

    request.user = { sub: session.staffId, email: session.email, roles: session.roles };
    return true;
  }
}
