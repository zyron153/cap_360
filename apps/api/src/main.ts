import * as Sentry from "@sentry/node";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe";

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

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.warn(`API running on http://localhost:${port}/v1`);
}

bootstrap().catch((err) => {
  Sentry.captureException(err);
  console.error("Fatal error during bootstrap", err);
  process.exit(1);
});
