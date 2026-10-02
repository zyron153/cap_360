import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { CreateStaffDto, UpdateStaffDto, ChangePasswordDto, CreateLeaveRequestDto, LeaveRequestDecisionDto, UpsertStaffShiftDto, TemporaryCredentials } from "@cap/types";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly password: PasswordService,
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
    // Matters most for the forced first-login change: the "new" password must not be the
    // temporary one the admin just read out / pasted into a message.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException("A nova palavra-passe tem de ser diferente da atual.");
    }

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.repo.updatePasswordHash(id, passwordHash);
  }

  // ─── Admin-issued temporary credentials ────────────────────────────────────
  // No email is sent: the plaintext password is returned once to the calling admin (never stored
  // or logged — only its argon2id hash is persisted) and the account is flagged
  // mustChangePassword, so the user has to replace it on first login.

  async create(dto: CreateStaffDto): Promise<TemporaryCredentials> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException(`Já existe um utilizador com o email ${dto.email}`);

    const temporaryPassword = this.password.generateTemporary();
    const passwordHash = await this.password.hash(temporaryPassword);
    const staff = await this.repo.create({
      fullName: dto.fullName.trim(),
      email: dto.email,
      role: dto.role,
      passwordHash,
      mustChangePassword: true,
      jobTitle: dto.jobTitle,
      phone: dto.phone,
      specialtyCode: dto.specialtyCode,
      companyId: dto.companyId,
      availability: dto.availability,
    });

    return { staffId: staff.id, fullName: staff.fullName, email: staff.email, temporaryPassword };
  }

  /** Admin "Redefinir senha": replaces the password with a fresh temporary one and forces a change
   * on next login. Any session the user already has is cut off too — SessionAuthGuard re-reads
   * mustChangePassword on every request, so it can only reach the change-password route. */
  async resetPassword(id: string): Promise<TemporaryCredentials> {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);

    const temporaryPassword = this.password.generateTemporary();
    const passwordHash = await this.password.hash(temporaryPassword);
    await this.repo.updatePasswordHash(id, passwordHash, true);

    return { staffId: staff.id, fullName: staff.fullName, email: staff.email, temporaryPassword };
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
