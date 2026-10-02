import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { SessionAuthGuard } from "./session-auth.guard";
import { ALLOW_PASSWORD_CHANGE_KEY } from "../decorators/allow-password-change.decorator";

const reflector = { getAllAndOverride: jest.fn() };
const sessions = { get: jest.fn() };
const staffRepo = { findById: jest.fn() };

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
    staffRepo.findById.mockReset();
    staffRepo.findById.mockResolvedValue({ id: "s1" }); // active by default — deactivation tested explicitly below
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function guard() {
    return new SessionAuthGuard(reflector as never, sessions as never, staffRepo as never);
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

  it("rejects a valid session cookie belonging to a since-deactivated staff member", async () => {
    sessions.get.mockResolvedValue({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] });
    staffRepo.findById.mockResolvedValue(null); // soft-deleted — findById filters deletedAt: null
    const ctx = makeContext({ cap_session: "good" });
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(ctx.__request.user).toBeUndefined();
  });

  describe("temporary password (mustChangePassword)", () => {
    beforeEach(() => {
      sessions.get.mockResolvedValue({ staffId: "s1", email: "a@cap.cv", roles: ["doctor"] });
      staffRepo.findById.mockResolvedValue({ id: "s1", mustChangePassword: true });
    });

    function routeAllowsPasswordChange(allowed: boolean) {
      reflector.getAllAndOverride.mockImplementation((key: string) => (key === ALLOW_PASSWORD_CHANGE_KEY ? allowed : false));
    }

    it("refuses an ordinary route with 403 PASSWORD_CHANGE_REQUIRED", async () => {
      routeAllowsPasswordChange(false);
      const ctx = makeContext({ cap_session: "good" });
      const err = await guard().canActivate(ctx).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
      expect(ctx.__request.user).toBeUndefined();
    });

    it("lets the change-password route through (@AllowDuringPasswordChange)", async () => {
      routeAllowsPasswordChange(true);
      const ctx = makeContext({ cap_session: "good" });
      await expect(guard().canActivate(ctx)).resolves.toBe(true);
      expect(ctx.__request.user).toMatchObject({ sub: "s1" });
    });

    it("does not restrict anything once the flag is cleared", async () => {
      routeAllowsPasswordChange(false);
      staffRepo.findById.mockResolvedValue({ id: "s1", mustChangePassword: false });
      await expect(guard().canActivate(makeContext({ cap_session: "good" }))).resolves.toBe(true);
    });
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
