import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { JwksClient } from "jwks-rsa";

@Injectable()
export class JwtAuthGuard {
  private jwksClient: JwksClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService
  ) {
    this.jwksClient = new JwksClient({
      jwksUri: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxAge: 600_000,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Fail-safe by default: bypass requires an explicit opt-in, not just an unset var.
    if (process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS === "true") {
      const request = context.switchToHttp().getRequest();
      request.user = {
        sub: "00000000-0000-0000-0000-000000000001",
        email: "capjacobvicente@gmail.com",
        preferred_username: "dev_admin",
        realm_access: { roles: ["admin"] },
      };
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException("Missing token");

    try {
      const decoded = this.jwtService.decode(token, { complete: true }) as {
        header: { kid: string };
        payload: Record<string, unknown>;
      };
      const key = await this.jwksClient.getSigningKey(decoded.header.kid);
      const publicKey = key.getPublicKey();

      const payload = this.jwtService.verify(token, {
        publicKey,
        algorithms: ["RS256"],
      });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }

  private extractToken(request: { headers: { authorization?: string } }) {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
