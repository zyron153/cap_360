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
  // StaffRepository is also exported — SessionAuthGuard (a global APP_GUARD in AppModule) needs
  // it directly to reject a since-deactivated staff member on every request, not just at login.
  exports: [StaffService, StaffRepository],
})
export class StaffModule {}
