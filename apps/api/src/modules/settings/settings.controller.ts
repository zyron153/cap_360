import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, type JwtUser } from "../../common/decorators/current-user.decorator";
import { SettingsService } from "./settings.service";

@Controller("settings")
@Roles("admin", "receptionist", "doctor", "nurse")
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
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
