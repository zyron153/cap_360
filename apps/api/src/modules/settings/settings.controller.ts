import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, type JwtUser } from "../../common/decorators/current-user.decorator";
import { SettingsService } from "./settings.service";

@Controller("settings")
@Roles("admin", "receptionist", "doctor", "nurse")
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  // Secrets are masked and e-Fatura excluded, and the web needs `access_control` to resolve every role's
  // permissions, so every real StaffRole may read it (not just the 4 listed above).
  @Get()
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr")
  getAll() {
    return this.service.getAll();
  }

  @Patch("clinic")
  @Roles("admin", "receptionist")
  updateClinic(@Body() body: Record<string, unknown>, @CurrentUser() user: JwtUser) {
    return this.service.updateClinic(body, user.roles);
  }

  @Patch("notifications")
  @Roles("admin", "receptionist")
  updateNotifications(@Body() body: Record<string, unknown>) {
    return this.service.upsert("notifications", body);
  }

  @Patch("access-control")
  @Roles("admin")
  updateAccessControl(@Body() body: Record<string, unknown>) {
    return this.service.upsert("access_control", body);
  }

  @Patch("integration/:key")
  @Roles("admin")
  updateIntegration(
    @Param("key") key: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.upsert(`integration_${key}`, body);
  }
}
