import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe, Req } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import { UpdateStaffSchema, UpdateStaffDto, InviteStaffSchema, InviteStaffDto } from "@cap/types";

@Controller("staff")
@Roles("admin", "receptionist", "doctor", "nurse")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get("me")
  findMe(@Req() req: { user: { sub: string; email?: string } }) {
    return this.service.findMe(req.user.sub);
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
