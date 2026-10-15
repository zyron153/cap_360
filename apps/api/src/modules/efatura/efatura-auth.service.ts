import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../common/redis/redis.module";
import { EFaturaConfigService } from "./efatura-config.service";
import { EFaturaError } from "./efatura.errors";

// OpenID Connect against DNRE's Keycloak (https://iam.efatura.cv/auth/realms/taxpayers/.well-known/openid-configuration):
// Authorization Code + PKCE (S256), confidential client, refresh token via offline_access.
const IAM = (process.env.EFATURA_IAM_URL ?? "https://iam.efatura.cv/auth/realms/taxpayers/protocol/openid-connect").replace(/\/$/, "");
// Emit documents, read one back by IUD (reconciliation), emit events (cancel).
export const OAUTH_SCOPES = "openid offline_access cv_ef_dfe_create cv_ef_dfe_read_iud cv_ef_event_create";
const HTTP_TIMEOUT_MS = 15_000;
const STATE_TTL_S = 600;
const ACCESS_KEY = "efatura:access-token";
const LOCK_KEY = "efatura:refresh-lock";

const b64url = (b: Buffer) => b.toString("base64url");

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

@Injectable()
export class EFaturaAuthService {
  private readonly logger = new Logger(EFaturaAuthService.name);

  constructor(
    private readonly config: EFaturaConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /** The URL the admin is sent to so the taxpayer can consent. The one-time `state` and the PKCE
   * verifier live in Redis for 10 minutes, bound to the admin who started the flow. */
  async authorizeUrl(userId: string): Promise<string> {
    const client = await this.config.getOAuthClient();
    if (!client) throw new EFaturaError("NOT_CONFIGURED", "Preencha o Client ID, o Client Secret e o Redirect URI primeiro", false);
    const state = randomBytes(16).toString("hex");
    const verifier = b64url(randomBytes(64));
    await this.redis.set(`efatura:oauth:${state}`, JSON.stringify({ verifier, userId }), "EX", STATE_TTL_S);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    });
    return `${IAM}/auth?${q.toString()}`;
  }

  /** Exchanges the consent code for tokens and stores the refresh token. */
  async handleCallback(code: string, state: string, userId: string): Promise<void> {
    const key = `efatura:oauth:${state}`;
    const raw = await this.redis.get(key);
    await this.redis.del(key); // one-time
    if (!raw) throw new EFaturaError("OAUTH_STATE", "O pedido de autorização expirou ou é inválido — tente novamente", false);
    const pending = JSON.parse(raw) as { verifier: string; userId: string };
    if (pending.userId !== userId) throw new EFaturaError("OAUTH_STATE", "O pedido de autorização pertence a outro utilizador", false);
    const client = await this.config.getOAuthClient();
    if (!client) throw new EFaturaError("NOT_CONFIGURED", "Configuração OAuth em falta", false);

    const tokens = await this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      code_verifier: pending.verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    if (!tokens.refresh_token) {
      throw new EFaturaError("OAUTH_NO_REFRESH", "A plataforma não devolveu um refresh token (falta o scope offline_access no cliente)", false);
    }
    await this.config.markConnected(tokens.refresh_token);
    await this.cache(tokens);
  }

  async disconnect(): Promise<void> {
    await this.config.saveRefreshToken(null);
    await this.redis.del(ACCESS_KEY);
  }

  /** A valid access token: cached until shortly before it expires, refreshed under a lock (a
   * rotating refresh token must never be redeemed twice in parallel). */
  async getAccessToken(): Promise<string> {
    const cached = await this.readCache();
    if (cached) return cached;

    const got = await this.redis.set(LOCK_KEY, "1", "PX", 20_000, "NX");
    if (!got) {
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const again = await this.readCache();
        if (again) return again;
      }
      throw new EFaturaError("AUTH_BUSY", "Renovação do token em curso — tente novamente", true);
    }
    try {
      const refresh = await this.config.getRefreshToken();
      const client = await this.config.getOAuthClient();
      if (!refresh || !client) throw new EFaturaError("AUTH_REQUIRED", "A ligação à Plataforma Eletrónica não está autorizada", false);
      let tokens: TokenResponse;
      try {
        tokens = await this.token({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: client.clientId,
          client_secret: client.clientSecret,
        });
      } catch (e) {
        if (e instanceof EFaturaError && e.code === "OAUTH_INVALID_GRANT") {
          await this.config.saveRefreshToken(null); // revoked/expired: the admin must authorize again
          throw new EFaturaError("AUTH_REQUIRED", "A autorização foi revogada ou expirou — volte a autorizar a ligação", false);
        }
        throw e;
      }
      if (tokens.refresh_token && tokens.refresh_token !== refresh) await this.config.markConnected(tokens.refresh_token);
      await this.cache(tokens);
      return tokens.access_token;
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }

  /** Forget the cached access token (e.g. after the platform answered 401). */
  async invalidate(): Promise<void> {
    await this.redis.del(ACCESS_KEY);
  }

  private async readCache(): Promise<string | null> {
    const raw = await this.redis.get(ACCESS_KEY);
    return raw ? (JSON.parse(raw) as { token: string }).token : null;
  }

  private async cache(t: TokenResponse): Promise<void> {
    const ttl = Math.max(30, t.expires_in - 60);
    await this.redis.set(ACCESS_KEY, JSON.stringify({ token: t.access_token }), "EX", ttl);
  }

  private async token(params: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetch(`${IAM}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (e) {
      throw new EFaturaError("OAUTH_NETWORK", `Sem resposta do servidor de autenticação: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const code = body.error === "invalid_grant" ? "OAUTH_INVALID_GRANT" : "OAUTH_REJECTED";
      // 5xx is the server's problem and worth retrying; a 4xx means our credentials/request are wrong.
      this.logger.warn(`Token endpoint answered ${res.status} ${body.error ?? ""}`);
      throw new EFaturaError(code, `Autenticação recusada (${res.status}${body.error ? ` ${body.error}` : ""})`, res.status >= 500);
    }
    return body as TokenResponse;
  }
}
