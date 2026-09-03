import { Test } from "@nestjs/testing";
import { INestApplication, Logger } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";
import { ZodValidationPipe } from "../../src/common/pipes/zod-validation.pipe";

/** Bootstraps the real, fully-wired app (same pipes/filters/prefix as main.ts) against the real
 * dev Postgres + Redis from apps/api/.env — these tests exercise actual HTTP + DB behavior, not
 * mocks. AUTH_BYPASS defaults on so most tests hit real business logic without a login round-trip
 * (that mechanism itself is already covered by SessionAuthGuard's own unit tests); pass
 * `authBypass: false` for a spec that specifically needs to exercise the real login/session
 * pipeline end-to-end (e.g. activation → login → protected route). Since `--runInBand` runs every
 * spec file in one process, `process.env.AUTH_BYPASS` is shared — this always sets it explicitly
 * (rather than only when true) so no file can leak its setting into the next one. */
export async function createTestApp({ authBypass = true }: { authBypass?: boolean } = {}): Promise<INestApplication> {
  process.env.NODE_ENV = "test";
  process.env.AUTH_BYPASS = authBypass ? "true" : "false";

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false as unknown as Logger });
  app.use(cookieParser());
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
