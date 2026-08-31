import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe, Req, HttpCode, HttpStatus } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import { UpdateStaffSchema, UpdateStaffDto, InviteStaffSchema, InviteStaffDto, ChangePasswordSchema, ChangePasswordDto } from "@cap/types";

@Controller("staff")
@Roles("admin", "receptionist", "doctor", "nurse")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get("me")
  findMe(@Req() req: { user: { sub: string; email?: string } }) {
    return this.service.findById(req.user.sub);
  }

  // Overrides the controller's role list — every real StaffRole (including lab_tech,
  // corporate_hr) may change their own password, not just the 4 roles listed above.
  @Patch("me/password")
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: { user: { sub: string } },
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
  ) {
    await this.service.changePassword(req.user.sub, dto);
    return { message: "Palavra-passe atualizada com sucesso." };
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get("invitations")
  @Roles("admin")
  listInvitations() {
    return this.service.listInvitations();
  }

  @Delete("invitations/:id")
  @Roles("admin")
  cancelInvitation(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.cancelInvitation(id);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post("invite")
  @Roles("admin")
  invite(
    @Body(new ZodValidationPipe(InviteStaffSchema)) dto: InviteStaffDto,
    @Req() req: { user: { email?: string } },
  ) {
    return this.service.invite(dto, req.user.email);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffSchema)) dto: UpdateStaffDto,
  ) {
    return this.service.update(id, dto);
  }
}
