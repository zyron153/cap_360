import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { HealthPlansModule } from "../health-plans/health-plans.module";

@Module({
  imports: [PrismaModule, HealthPlansModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
