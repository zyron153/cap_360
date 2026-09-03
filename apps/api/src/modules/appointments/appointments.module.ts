import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";
import { AppointmentsGateway } from "./appointments.gateway";
import { RemindersProcessor } from "./reminders.processor";
import { BillingModule } from "../billing/billing.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { HealthPlansModule } from "../health-plans/health-plans.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "reminders" }),
    BillingModule,
    NotificationsModule,
    HealthPlansModule,
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentsRepository,
    AppointmentsGateway,
    RemindersProcessor,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
