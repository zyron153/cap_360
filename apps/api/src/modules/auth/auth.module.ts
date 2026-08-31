import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { PasswordService } from "../../common/services/password.service";
import { StaffRepository } from "../staff/staff.repository";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, StaffRepository],
  exports: [SessionService],
})
export class AuthModule {}
