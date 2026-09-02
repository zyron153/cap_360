import { Module } from "@nestjs/common";
import { HealthPlansController } from "./health-plans.controller";
import { HealthPlansService } from "./health-plans.service";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";

@Module({
  controllers: [HealthPlansController],
  providers: [HealthPlansService, HealthPlansRepository, StaffRepository],
  exports: [HealthPlansService],
})
export class HealthPlansModule {}
