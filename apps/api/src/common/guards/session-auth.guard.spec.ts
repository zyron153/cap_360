import { UnauthorizedException } from "@nestjs/common";
import { SessionAuthGuard } from "./session-auth.guard";

const reflector = { getAllAndOverride: jest.fn() };
const sessions = { get: jest.fn() };

function makeContext(cookies: Record<string, string> = {}) {
  const request = { cookies, user: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __request: request,
  } as unknown as import("@nestjs/common").ExecutionContext & { __request: typeof request };
}

describe("SessionAuthGuard", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    reflector.getAllAndOverride.mockReturnValue(false);
    sessions.get.mockReset();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function guard() {
    return new SessionAuthGuard(reflector as never, sessions as never);
  }

  it("lets a @Public() route through with no cookie at all", async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext();
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it("rejects a protected route with no session cookie", async () => {
    delete process.env.AUTH_BYPASS;
    const ctx = makeContext();
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an unknown/expired session id", async () => {
    sessions.get.mockResolvedValue(null);
    const ctx = makeContext({ cap_session: "stale" });
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("attaches the session's staff/roles to the request on a valid cookie", async () => {
    sessions.get.mockResolvedValue({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] });
    const ctx = makeContext({ cap_session: "good" });
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__request.user).toEqual({ sub: "s1", email: "a@cap.cv", roles: ["admin"] });
  });

  describe("dev bypass posture", () => {
    it("does NOT bypass when AUTH_BYPASS is unset, even outside production", async () => {
      delete process.env.AUTH_BYPASS;
      process.env.NODE_ENV = "development";
      await expect(guard().canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
    });

    it('does NOT bypass when AUTH_BYPASS is any value other than the literal string "true"', async () => {
      process.env.AUTH_BYPASS = "1";
      process.env.NODE_ENV = "development";
      await expect(guard().canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
    });

    it("bypasses and injects a dev admin user when AUTH_BYPASS=true and not production", async () => {
      process.env.AUTH_BYPASS = "true";
      process.env.NODE_ENV = "development";
      const ctx = makeContext();
      await expect(guard().canActivate(ctx)).resolves.toBe(true);
      expect(ctx.__request.user).toMatchObject({ roles: ["admin"] });
    });

    it("never bypasses in production, even if AUTH_BYPASS=true", async () => {
      process.env.AUTH_BYPASS = "true";
      process.env.NODE_ENV = "production";
      const ctx = makeContext(); // no cookie → falls through to real verification → fails
      await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });
});
