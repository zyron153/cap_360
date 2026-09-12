import { Controller, Get, Query } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AnalyticsQuerySchema, AnalyticsQuery } from "@cap/types";

@Controller("analytics")
@Roles("admin", "doctor", "nurse")
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get("summary")
  getSummary(@Query(new ZodValidationPipe(AnalyticsQuerySchema)) query: AnalyticsQuery) {
    return this.service.getSummary(query.from, query.to);
  }
}
