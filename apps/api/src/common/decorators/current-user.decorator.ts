import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** The request principal attached by SessionAuthGuard — `sub` is the Staff id directly (no
 * external identity provider indirection). */
export interface JwtUser {
  sub: string;
  email: string;
  roles: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtUser;
  }
);
