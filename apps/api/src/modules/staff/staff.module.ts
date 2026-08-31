import { Module } from "@nestjs/common";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffRepository, PasswordService],
  exports: [StaffService],
})
export class StaffModule {}
