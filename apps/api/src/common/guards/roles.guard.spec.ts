import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { StaffController } from "../../modules/staff/staff.controller";
import { SettingsController } from "../../modules/settings/settings.controller";

// The web resolves the signed-in user's role from GET /staff/me and /settings; a role the guard refuses
// there made the UI fall back to "admin" while every real endpoint answered 403.
describe("RolesGuard — identity endpoints are open to every real StaffRole", () => {
  const guard = new RolesGuard(new Reflector());
  const can = (role: string, controller: new (...a: never[]) => object, handler: string) =>
    guard.canActivate({
      getHandler: () => (controller.prototype as Record<string, () => void>)[handler],
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }),
    } as never);

  it.each(["admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr"])("%s may read /staff/me and /settings", (role) => {
    expect(can(role, StaffController, "findMe")).toBe(true);
    expect(can(role, SettingsController, "getAll")).toBe(true);
  });
});
