import * as Sentry from "@sentry/node";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "net";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe";

/** Binds a throwaway probe socket to find the first free port at or after `start` — a stray
 * leftover dev-server process still holding the preferred port no longer means killing it by
 * hand first, `nest start --watch` just moves up (4000, 4001, 4002, …) and logs where it landed. */
function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") probe.close(() => resolve(findAvailablePort(start + 1)));
      else reject(err);
    });
    probe.once("listening", () => probe.close(() => resolve(start)));
    probe.listen(start);
  });
}

// No-op until SENTRY_DSN is set (same "optional integration" posture as R2Service) — init must
// run before anything else so it can also catch errors during bootstrap itself.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "warn", "error"],
  });

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix("v1");

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? [
      "http://localhost:3000",
    ],
    credentials: true,
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());

  const preferredPort = Number(process.env.API_PORT) || 3001;
  const port = await findAvailablePort(preferredPort);
  await app.listen(port);
  if (port !== preferredPort) {
    console.warn(`Port ${preferredPort} was busy — API running on http://localhost:${port}/v1 instead`);
  } else {
    console.warn(`API running on http://localhost:${port}/v1`);
  }
}

bootstrap().catch((err) => {
  Sentry.captureException(err);
  console.error("Fatal error during bootstrap", err);
  process.exit(1);
});
