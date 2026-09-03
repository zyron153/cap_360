import * as Sentry from "@sentry/nextjs";

// No-op until SENTRY_DSN is set (same "optional integration" posture as the API's R2Service).
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
}

export const onRequestError = Sentry.captureRequestError;
