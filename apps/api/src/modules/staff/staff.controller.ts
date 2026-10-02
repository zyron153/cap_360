import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe, Query, Req, Header, HttpCode, HttpStatus } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import { AllowDuringPasswordChange } from "../../common/decorators/allow-password-change.decorator";
import { CreateStaffSchema, CreateStaffDto, UpdateStaffSchema, UpdateStaffDto, ChangePasswordSchema, ChangePasswordDto, CreateLeaveRequestSchema, CreateLeaveRequestDto, LeaveRequestDecisionSchema, LeaveRequestDecisionDto, UpsertStaffShiftSchema, UpsertStaffShiftDto } from "@cap/types";

@Controller("staff")
@Roles("admin", "receptionist", "doctor", "nurse")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  // Reachable while a temporary password is pending (see AllowDuringPasswordChange) — the web
  // app reads mustChangePassword from here to decide whether to show /change-password.
  @Get("me")
  @AllowDuringPasswordChange()
  findMe(@Req() req: { user: { sub: string; email?: string } }) {
    return this.service.findById(req.user.sub);
  }

  // Overrides the controller's role list — every real StaffRole (including lab_tech,
  // corporate_hr) may change their own password, not just the 4 roles listed above.
  @Patch("me/password")
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr")
  @AllowDuringPasswordChange()
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

  // ─── Leave Requests ────────────────────────────────────────────────────────
  // Every real StaffRole may submit/view their own leave requests — overrides the controller's
  // role list the same way me/password does above.

  @Post("me/leave-requests")
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr")
  requestLeave(
    @Req() req: { user: { sub: string } },
    @Body(new ZodValidationPipe(CreateLeaveRequestSchema)) dto: CreateLeaveRequestDto,
  ) {
    return this.service.createLeaveRequest(req.user.sub, dto);
  }

  @Get("me/leave-requests")
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech", "corporate_hr")
  listOwnLeaveRequests(@Req() req: { user: { sub: string } }) {
    return this.service.listOwnLeaveRequests(req.user.sub);
  }

  @Get("leave-requests")
  @Roles("admin")
  listPendingLeaveRequests() {
    return this.service.listPendingLeaveRequests();
  }

  @Patch("leave-requests/:id")
  @Roles("admin")
  decideLeaveRequest(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(LeaveRequestDecisionSchema)) dto: LeaveRequestDecisionDto,
  ) {
    return this.service.decideLeaveRequest(id, dto);
  }

  // ─── Availability calendar ──────────────────────────────────────────────────
  // Self-or-admin, enforced in the service — a doctor may block/view only their own; admin any.

  @Post(":id/availability-blocks")
  createBlock(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: { user: { sub: string; roles: string[] } },
    @Body(new ZodValidationPipe(CreateLeaveRequestSchema)) dto: CreateLeaveRequestDto,
  ) {
    return this.service.createBlock(id, req.user.sub, req.user.roles, dto);
  }

  @Get(":id/leave-requests")
  listLeaveRequestsForStaff(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: { user: { sub: string; roles: string[] } },
  ) {
    return this.service.listLeaveRequestsForStaff(id, req.user.sub, req.user.roles);
  }

  @Delete("leave-requests/:id")
  removeBlock(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: { user: { sub: string; roles: string[] } },
  ) {
    return this.service.removeBlock(id, req.user.sub, req.user.roles);
  }

  // ─── Shift overrides ─────────────────────────────────────────────────────
  // Admin-only, unlike the leave/block endpoints above — assigning shifts is a scheduling
  // action performed on staff, not something staff do for their own calendar.

  @Get(":id/shifts")
  listShifts(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.service.listShiftsForStaff(id, from, to);
  }

  @Post(":id/shifts")
  @Roles("admin")
  upsertShift(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpsertStaffShiftSchema)) dto: UpsertStaffShiftDto,
  ) {
    return this.service.upsertShift(id, dto);
  }

  @Delete("shifts/:id")
  @Roles("admin")
  deleteShift(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteShift(id);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  // Creates the user with a generated temporary password, returned once in this response
  // (hence no-store) — no email is sent. The user must change it on first login.
  @Post()
  @Roles("admin")
  @Header("Cache-Control", "no-store")
  create(@Body(new ZodValidationPipe(CreateStaffSchema)) dto: CreateStaffDto) {
    return this.service.create(dto);
  }

  @Post(":id/reset-password")
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  resetPassword(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.resetPassword(id);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffSchema)) dto: UpdateStaffDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: { user: { sub: string } },
  ) {
    return this.service.softDelete(id, req.user.sub);
  }
}
