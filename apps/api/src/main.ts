import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe";

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

bootstrap();
