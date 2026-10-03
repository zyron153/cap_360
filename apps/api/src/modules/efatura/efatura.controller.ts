import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  UpdateEFaturaConfigSchema,
  UploadEFaturaCertificateSchema,
  type UpdateEFaturaConfigDto,
  type UploadEFaturaCertificateDto,
} from "@cap/types";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, type JwtUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EFaturaConfigService } from "./efatura-config.service";
import { EFaturaAuthService } from "./efatura-auth.service";
import { EFaturaError } from "./efatura.errors";

/** Admin-only configuration of the e-Fatura (DNRE) integration. Secrets are write-only: no
 * endpoint ever returns the client secret, the refresh token or the certificate. */
@Controller("efatura")
@Roles("admin")
export class EFaturaController {
  constructor(
    private readonly config: EFaturaConfigService,
    private readonly auth: EFaturaAuthService
  ) {}

  @Get("config")
  getConfig() {
    return this.config.getView();
  }

  @Patch("config")
  updateConfig(@Body(new ZodValidationPipe(UpdateEFaturaConfigSchema)) dto: UpdateEFaturaConfigDto) {
    return this.config.update(dto);
  }

  @Post("certificate")
  uploadCertificate(@Body(new ZodValidationPipe(UploadEFaturaCertificateSchema)) dto: UploadEFaturaCertificateDto) {
    return this.config.setCertificate(dto.file, dto.password);
  }

  @Delete("certificate")
  removeCertificate() {
    return this.config.removeCertificate();
  }

  /** Step 1 of connecting: the URL the admin's browser is sent to for the taxpayer's consent. */
  @Post("oauth/authorize")
  @HttpCode(HttpStatus.OK)
  async authorize(@CurrentUser() user: JwtUser) {
    try {
      return { url: await this.auth.authorizeUrl(user.sub) };
    } catch (e) {
      if (e instanceof EFaturaError) return { error: e.message };
      throw e;
    }
  }

  /** Step 2: DNRE redirects the browser back here (this exact URL is the OAuth Redirect URI
   * registered in the PE, behind the web app's /api proxy). Sends the admin on to Settings. */
  @Get("oauth/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @CurrentUser() user: JwtUser,
    @Res() res: Response
  ) {
    const view = await this.config.getView();
    const origin = view.oauthRedirectUri ? new URL(view.oauthRedirectUri).origin : "";
    const back = (status: "connected" | "error", msg?: string) =>
      res.redirect(`${origin}/settings?efatura=${status}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`);
    if (error || !code || !state) return back("error", error ?? "Autorização recusada");
    try {
      await this.auth.handleCallback(code, state, user.sub);
      return back("connected");
    } catch (e) {
      return back("error", e instanceof EFaturaError ? e.message : "Não foi possível concluir a autorização");
    }
  }

  @Post("oauth/disconnect")
  @HttpCode(HttpStatus.OK)
  async disconnect() {
    await this.auth.disconnect();
    return this.config.getView();
  }
}
