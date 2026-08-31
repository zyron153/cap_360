import { Controller, Post, Body, Res, Req, HttpCode, HttpStatus } from "@nestjs/common";
import { Response, Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  LoginSchema, LoginDto,
  ForgotPasswordSchema, ForgotPasswordDto,
  ResetPasswordSchema, ResetPasswordDto,
} from "@cap/types";
import { AuthService } from "./auth.service";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, sessionCookieOptions } from "./session.service";

// Tighter than the global 300/min default — this is a credential-testing surface, and the
// per-account Redis lockout in SessionService only kicks in per email; this per-IP limit
// covers an attacker spraying many different emails from one address.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Public()
@Controller("auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Throttle(LOGIN_THROTTLE)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { sessionId, staff } = await this.service.login(dto);
    res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(SESSION_TTL_SECONDS));
    return { staff };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) await this.service.logout(sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  }

  @Throttle(LOGIN_THROTTLE)
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordDto) {
    await this.service.forgotPassword(dto.email);
    // Same response whether or not the email exists — see AuthService.forgotPassword.
    return { message: "Se este email estiver registado, enviámos um link de recuperação." };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto) {
    await this.service.resetPassword(dto);
    return { message: "Palavra-passe atualizada com sucesso." };
  }
}
