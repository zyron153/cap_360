// ponytail: presence + a couple of sanity checks only; deep validation (zod schema for every var)
// if the env surface grows.
const REQUIRED_IN_PROD = [
  "DATABASE_URL",
  "FIELD_ENCRYPTION_KEY",
  "REDIS_HOST",
  "ALLOWED_ORIGINS",
  "WEB_URL",
];

/** Throws at boot (production only) listing every missing/unsafe env var, instead of failing
 * later on the first request that happens to need one. */
export function assertProdEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = REQUIRED_IN_PROD.filter((k) => !env[k]).map((k) => `${k} is not set`);
  if (env.AUTH_BYPASS === "true") problems.push("AUTH_BYPASS=true must not be set in production");
  if (env.ALLOWED_ORIGINS?.includes("localhost")) problems.push("ALLOWED_ORIGINS contains localhost");
  if (problems.length) {
    throw new Error(`Invalid production environment:\n - ${problems.join("\n - ")}`);
  }
}
