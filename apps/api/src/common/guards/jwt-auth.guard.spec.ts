import { UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

const reflector = { getAllAndOverride: jest.fn() };
const jwtService = { decode: jest.fn(), verify: jest.fn() };

function makeContext(headers: Record<string, string> = {}) {
  const request = { headers, user: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __request: request,
  } as unknown as import("@nestjs/common").ExecutionContext & { __request: typeof request };
}

describe("JwtAuthGuard — dev bypass posture", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.decode.mockReset();
    jwtService.verify.mockReset();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function guard() {
    return new JwtAuthGuard(reflector as never, jwtService as never);
  }

  it("does NOT bypass when AUTH_BYPASS is unset, even outside production", async () => {
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "development";
    const ctx = makeContext(); // no Authorization header
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("does NOT bypass when AUTH_BYPASS is any value other than the literal string \"true\"", async () => {
    process.env.AUTH_BYPASS = "1";
    process.env.NODE_ENV = "development";
    const ctx = makeContext();
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("bypasses and injects a dev admin user when AUTH_BYPASS=true and not production", async () => {
    process.env.AUTH_BYPASS = "true";
    process.env.NODE_ENV = "development";
    const ctx = makeContext();
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__request.user).toMatchObject({ realm_access: { roles: ["admin"] } });
  });

  it("never bypasses in production, even if AUTH_BYPASS=true", async () => {
    process.env.AUTH_BYPASS = "true";
    process.env.NODE_ENV = "production";
    const ctx = makeContext(); // no Authorization header → falls through to real verification → fails
    await expect(guard().canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
