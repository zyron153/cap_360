import { Injectable, NotFoundException, ConflictException, GoneException, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { UpdateStaffDto, InviteStaffDto, ActivateInvitationDto, ChangePasswordDto, CreateLeaveRequestDto, LeaveRequestDecisionDto } from "@cap/types";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";
import { NotificationsService } from "../notifications/notifications.service";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly password: PasswordService,
    private readonly notifications: NotificationsService,
  ) {}

  findAll() {
    return this.repo.findAll();
  }

  async findById(id: string) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return this.repo.update(id, dto);
  }

  /** Soft-delete (deactivate) — see StaffRepository.softDelete. Self-deactivation is blocked so
   * an admin can't accidentally (or maliciously, alone) lock themselves out. */
  async softDelete(id: string, requesterId: string) {
    if (id === requesterId) throw new ForbiddenException("Não pode desativar a sua própria conta");
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return this.repo.softDelete(id);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const staff = await this.repo.findByIdWithPassword(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);

    const ok = await this.password.verify(staff.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException("Palavra-passe atual incorreta.");

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.repo.updatePasswordHash(id, passwordHash);
  }

  // ─── Invitations ───────────────────────────────────────────────────────────

  async invite(dto: InviteStaffDto, invitedBy?: string) {
    const existingStaff = await this.repo.findByEmail(dto.email);
    if (existingStaff) throw new ConflictException(`Já existe um utilizador com o email ${dto.email}`);

    const existingInvite = await this.repo.findInvitationByEmail(dto.email);
    if (existingInvite) throw new ConflictException(`Já existe um convite pendente para ${dto.email}`);

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await this.repo.createInvitation(dto, token, expiresAt, invitedBy);

    await this.notifications.sendInvite(dto.email, dto.fullName, token);

    // token is otherwise never selectable again (INVITATION_SELECT omits it, by design — it's
    // a bearer credential for the activation endpoint) — returned once here, only to the admin
    // who just created it, as a copy-link fallback for when the invite email doesn't arrive.
    return { ...invitation, token };
  }

  listInvitations() {
    return this.repo.findPendingInvitations();
  }

  async cancelInvitation(id: string) {
    const invite = await this.repo.findInvitationById(id);
    if (!invite) throw new NotFoundException(`Invitation ${id} not found`);
    await this.repo.deleteInvitation(id);
    return { ok: true };
  }

  async getPublicInvitation(token: string) {
    const invite = await this.repo.findInvitationByToken(token);
    if (!invite || invite.acceptedAt) throw new NotFoundException("Convite inválido ou já utilizado");
    return {
      fullName: invite.fullName,
      email: invite.email,
      role: invite.role,
      expired: invite.expiresAt.getTime() < Date.now(),
    };
  }

  async activateInvitation(token: string, dto: ActivateInvitationDto) {
    const invite = await this.repo.findInvitationByToken(token);
    if (!invite || invite.acceptedAt) throw new NotFoundException("Convite inválido ou já utilizado");
    if (invite.expiresAt.getTime() < Date.now()) throw new GoneException("Este convite expirou");

    const passwordHash = await this.password.hash(dto.password);
    const staff = await this.repo.create({
      fullName: dto.fullName.trim(),
      email: invite.email,
      role: invite.role,
      passwordHash,
      jobTitle: invite.jobTitle,
      phone: invite.phone,
      specialtyCode: invite.specialtyCode,
      companyId: invite.companyId,
      availability: (invite.availability as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? undefined,
    });

    await this.repo.markInvitationAccepted(invite.id);
    return staff;
  }

  // ─── Leave Requests ────────────────────────────────────────────────────────

  createLeaveRequest(staffId: string, dto: CreateLeaveRequestDto) {
    return this.repo.createLeaveRequest(staffId, dto);
  }

  listOwnLeaveRequests(staffId: string) {
    return this.repo.findLeaveRequestsByStaffId(staffId);
  }

  listPendingLeaveRequests() {
    return this.repo.findPendingLeaveRequests();
  }

  async decideLeaveRequest(id: string, dto: LeaveRequestDecisionDto) {
    const existing = await this.repo.findLeaveRequestById(id);
    if (!existing) throw new NotFoundException(`Leave request ${id} not found`);
    if (existing.status !== "pending") throw new BadRequestException("Este pedido já foi decidido");
    return this.repo.updateLeaveRequestStatus(id, dto.status);
  }

  // ─── Availability calendar (block a doctor's own or another's schedule) ────
  // Both actions are "self or admin" — same posture as clinical-records authorship scoping and
  // health-plans corporate_hr scoping elsewhere in this app.

  async createBlock(targetStaffId: string, requesterId: string, requesterRoles: string[], dto: CreateLeaveRequestDto) {
    if (!requesterRoles.includes("admin") && requesterId !== targetStaffId) {
      throw new ForbiddenException("Só pode bloquear a sua própria agenda");
    }
    return this.repo.createApprovedBlock(targetStaffId, dto);
  }

  async listLeaveRequestsForStaff(targetStaffId: string, requesterId: string, requesterRoles: string[]) {
    if (!requesterRoles.includes("admin") && requesterId !== targetStaffId) {
      throw new ForbiddenException("Só pode ver a sua própria agenda");
    }
    return this.repo.findLeaveRequestsByStaffId(targetStaffId);
  }

  /** Undo for createBlock — a block created by mistake (wrong dates, changed plans) needs a way
   * back out, same self-or-admin posture as creating one. */
  async removeBlock(id: string, requesterId: string, requesterRoles: string[]) {
    const existing = await this.repo.findLeaveRequestById(id);
    if (!existing) throw new NotFoundException(`Leave request ${id} not found`);
    if (!requesterRoles.includes("admin") && requesterId !== existing.staffId) {
      throw new ForbiddenException("Só pode remover bloqueios da sua própria agenda");
    }
    return this.repo.deleteLeaveRequest(id);
  }
}
