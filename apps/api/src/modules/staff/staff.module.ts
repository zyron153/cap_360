import { Module } from "@nestjs/common";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { KeycloakAdminService } from "../../common/services/keycloak-admin.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffRepository, KeycloakAdminService],
  exports: [StaffService],
})
export class StaffModule {}
