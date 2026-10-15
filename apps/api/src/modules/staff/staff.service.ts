import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { CreateStaffAccountDto, SetStaffPasswordDto, UpdateStaffDto, ChangePasswordDto, CreateLeaveRequestDto, LeaveRequestDecisionDto, UpsertStaffShiftDto } from "@cap/types";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";
import { SessionService } from "../auth/session.service";

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly password: PasswordService,
    private readonly sessions: SessionService,
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
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException("A nova palavra-passe tem de ser diferente da atual.");
    }

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.repo.updatePasswordHash(id, passwordHash);
  }

  // ─── Admin-set passwords ───────────────────────────────────────────────────
  // The admin chooses the password (no email is sent, no forced change). Only its argon2id hash is
  // persisted; the plaintext exists in the request body and nowhere else.

  async create(dto: CreateStaffAccountDto) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException(`Já existe um utilizador com o email ${dto.email}`);

    const passwordHash = await this.password.hash(dto.password);
    return this.repo.create({
      fullName: dto.fullName.trim(),
      email: dto.email,
      role: dto.role,
      passwordHash,
      jobTitle: dto.jobTitle,
      phone: dto.phone,
      specialtyCode: dto.specialtyCode,
      companyId: dto.companyId,
      availability: dto.availability,
    });
  }

  /** Admin "Alterar senha": replaces a user's password and ends their open sessions, so whoever
   * still has the old password (or a stolen session) is logged out immediately and has to sign in
   * with the new one. `currentSessionId` is the caller's own session: when an admin changes their
   * own password it is spared, so they aren't logged out of the screen they're using. */
  async setPassword(id: string, dto: SetStaffPasswordDto, requesterId: string, currentSessionId?: string) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);

    const passwordHash = await this.password.hash(dto.password);
    await this.repo.updatePasswordHash(id, passwordHash);

    const ended = await this.sessions.destroyAllForStaff(id, id === requesterId ? currentSessionId : undefined);
    return { sessionsEnded: ended };
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

  // ─── Shift overrides — admin-only, unlike the self-or-admin availability calendar above:
  // assigning shifts is a scheduling/management action, not something staff do for themselves. ─

  listShiftsForStaff(staffId: string, from: string, to: string) {
    return this.repo.findShiftsForStaffInRange(staffId, new Date(from), new Date(to));
  }

  upsertShift(staffId: string, dto: UpsertStaffShiftDto) {
    return this.repo.upsertShift(staffId, dto);
  }

  async deleteShift(id: string) {
    const existing = await this.repo.findShiftById(id);
    if (!existing) throw new NotFoundException(`Shift ${id} not found`);
    return this.repo.deleteShift(id);
  }
}
