import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../../common/redis/redis.module";

export interface SessionData {
  staffId: string;
  email: string;
  roles: string[];
}

export const SESSION_COOKIE_NAME = "cap_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h, slides forward on each authenticated request

/** httpOnly: not readable from JS (XSS can't steal it). Secure: HTTPS-only outside dev, where
 * there's no HTTPS on localhost. SameSite=lax: sent on top-level navigation but not on
 * cross-site subresource/XHR requests — CSRF-resistant without needing a separate CSRF token
 * for this app's same-origin (Next.js rewrite-proxied) request pattern. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}
export const MAX_LOGIN_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1h

/** Server-side session store (Redis) + login rate-limit/lockout bookkeeping + password-reset
 * tokens. Opaque session ids — nothing about the staff member is derivable from the cookie
 * itself, unlike a JWT. */
@Injectable()
export class SessionService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(data: SessionData): Promise<string> {
    const id = randomBytes(32).toString("hex");
    await this.redis.set(`session:${id}`, JSON.stringify(data), "EX", SESSION_TTL_SECONDS);
    return id;
  }

  async get(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get(`session:${id}`);
    if (!raw) return null;
    // Sliding expiry: an active user's session never expires mid-use.
    await this.redis.expire(`session:${id}`, SESSION_TTL_SECONDS);
    return JSON.parse(raw) as SessionData;
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(`session:${id}`);
  }

  // ── Login rate-limit / lockout (per-account, on top of the global IP throttle) ──────────

  async recordFailure(email: string): Promise<void> {
    const key = `login:fail:${email.toLowerCase()}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, FAILURE_WINDOW_SECONDS);
    if (count >= MAX_LOGIN_FAILURES) {
      await this.redis.set(`login:lock:${email.toLowerCase()}`, "1", "EX", LOCK_SECONDS);
    }
  }

  async isLocked(email: string): Promise<boolean> {
    const locked = await this.redis.get(`login:lock:${email.toLowerCase()}`);
    return locked !== null;
  }

  async clearFailures(email: string): Promise<void> {
    const lower = email.toLowerCase();
    await this.redis.del(`login:fail:${lower}`, `login:lock:${lower}`);
  }

  // ── Password reset ──────────────────────────────────────────────────────────

  async createResetToken(staffId: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await this.redis.set(`pwreset:${token}`, staffId, "EX", RESET_TOKEN_TTL_SECONDS);
    return token;
  }

  /** Returns the staffId and immediately invalidates the token (single use). Null if invalid/expired. */
  async consumeResetToken(token: string): Promise<string | null> {
    const staffId = await this.redis.get(`pwreset:${token}`);
    if (!staffId) return null;
    await this.redis.del(`pwreset:${token}`);
    return staffId;
  }
}
