import { Injectable, NotFoundException, ConflictException, GoneException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { UpdateStaffDto, InviteStaffDto, ActivateInvitationDto } from "@cms/types";
import { StaffRepository } from "./staff.repository";
import { KeycloakAdminService } from "../../common/services/keycloak-admin.service";
import { NotificationsService } from "../notifications/notifications.service";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly keycloak: KeycloakAdminService,
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

  async findMe(keycloakId: string) {
    const staff = await this.repo.findByKeycloakId(keycloakId);
    // Fallback for dev hardcoded sub that has no real staff record
    return staff ?? { id: null, fullName: "Dev Admin", email: "admin@dev", role: "admin", jobTitle: null, specialtyCode: null, phone: null, availability: [] };
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return this.repo.update(id, dto);
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

    return invitation;
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

    const [firstName, ...rest] = dto.fullName.trim().split(/\s+/);
    const keycloakId = await this.keycloak.createUser({
      email: invite.email,
      firstName: firstName ?? invite.fullName,
      lastName: rest.join(" ") || firstName || invite.fullName,
      password: dto.password,
      role: invite.role,
    });

    const staff = await this.repo.create(keycloakId, {
      fullName: dto.fullName.trim(),
      email: invite.email,
      role: invite.role,
      jobTitle: invite.jobTitle,
      phone: invite.phone,
      specialtyCode: invite.specialtyCode,
      availability: (invite.availability as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? undefined,
    });

    await this.repo.markInvitationAccepted(invite.id);
    return staff;
  }
}
