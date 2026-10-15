import { Module } from "@nestjs/common";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  // AuthModule exports SessionService — needed to end a user's open sessions when an admin changes
  // their password. AuthModule doesn't import StaffModule (it provides its own StaffRepository), so
  // there's no cycle.
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [StaffService, StaffRepository, PasswordService],
  // StaffRepository is also exported — SessionAuthGuard (a global APP_GUARD in AppModule) needs
  // it directly to reject a since-deactivated staff member on every request, not just at login.
  exports: [StaffService, StaffRepository],
})
export class StaffModule {}
