import { assertProdEnv } from "./assert-prod-env";

const ok = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://x",
  FIELD_ENCRYPTION_KEY: "a".repeat(64),
  REDIS_HOST: "redis",
  ALLOWED_ORIGINS: "https://app.cap.cv",
  WEB_URL: "https://app.cap.cv",
} as NodeJS.ProcessEnv;

describe("assertProdEnv", () => {
  it("ignores non-production", () => {
    expect(() => assertProdEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it("accepts a complete production env", () => {
    expect(() => assertProdEnv(ok)).not.toThrow();
  });
  it("lists every missing var", () => {
    expect(() => assertProdEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL.*\n.*FIELD_ENCRYPTION_KEY/,
    );
  });
  it("rejects AUTH_BYPASS=true and localhost origins", () => {
    expect(() => assertProdEnv({ ...ok, AUTH_BYPASS: "true" })).toThrow(/AUTH_BYPASS/);
    expect(() => assertProdEnv({ ...ok, ALLOWED_ORIGINS: "http://localhost:3000" })).toThrow(/localhost/);
  });
});
