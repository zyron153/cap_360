import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import { ZodError } from "zod";
import * as Sentry from "@sentry/node";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ZodError) {
      return response.status(400).json({
        statusCode: 400,
        error: "Validation Error",
        message: exception.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      return response.status(status).json(
        typeof exceptionResponse === "object"
          ? exceptionResponse
          : { statusCode: status, message: exceptionResponse }
      );
    }

    console.error("Unhandled exception", exception);
    Sentry.captureException(exception); // no-op when SENTRY_DSN isn't set — only true 5xx bugs, not expected 4xx flow
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
