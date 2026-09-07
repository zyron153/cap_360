import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { ZodSchema } from "zod";

/**
 * Per-route validation pipe: `@Body(new ZodValidationPipe(SomeSchema))`.
 * Deliberately NOT registered globally — a global instance would have no schema and silently
 * pass every request through untouched, which is worse than not being there at all.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Validation Error",
        message: result.error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
    }
    return result.data;
  }
}
