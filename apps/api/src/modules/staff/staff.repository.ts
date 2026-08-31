import { Injectable } from "@nestjs/common";
import { StaffRole } from "@cap/database";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStaffDto, UpdateStaffDto, InviteStaffDto } from "@cap/types";

const INVITATION_SELECT = {
  id: true, email: true, fullName: true, role: true,
  jobTitle: true, phone: true, specialtyCode: true,
  expiresAt: true, createdAt: true,
} as const;

const STAFF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  jobTitle: true,
  specialtyCode: true,
  phone: true,
  availability: {
    where: { active: true },
    select: { dayOfWeek: true, startTime: true, endTime: true },
  },
} as const;

@Injectable()
export class StaffRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.staff.findMany({
      where: { deletedAt: null },
      select: STAFF_SELECT,
      orderBy: { fullName: "asc" },
    });
  }

  findById(id: string) {
    return this.prisma.staff.findFirst({
      where: { id, deletedAt: null },
      select: STAFF_SELECT,
    });
  }

  findByEmail(email: string) {
    return this.prisma.staff.findFirst({ where: { email, deletedAt: null } });
  }

  /** Only the login path needs the hash — every other read goes through STAFF_SELECT, which omits it. */
  findByEmailWithPassword(email: string) {
    return this.prisma.staff.findFirst({
      where: { email, deletedAt: null },
      select: { ...STAFF_SELECT, passwordHash: true },
    });
  }

  /** Only the change-password path needs the hash — see findByEmailWithPassword above. */
  findByIdWithPassword(id: string) {
    return this.prisma.staff.findFirst({
      where: { id, deletedAt: null },
      select: { ...STAFF_SELECT, passwordHash: true },
    });
  }

  updatePasswordHash(id: string, passwordHash: string) {
    return this.prisma.staff.update({ where: { id }, data: { passwordHash } });
  }

  update(id: string, dto: UpdateStaffDto) {
    const avail = dto.availability;
    return this.prisma.staff.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.jobTitle !== undefined && { jobTitle: dto.jobTitle ?? null }),
        ...(dto.phone !== undefined && { phone: dto.phone ?? null }),
        ...(dto.specialtyCode !== undefined && { specialtyCode: dto.specialtyCode ?? null }),
        ...(avail !== undefined && {
          availability: {
            deleteMany: {},
            createMany: {
              data: avail.map((a) => ({
                dayOfWeek: a.dayOfWeek,
                startTime: a.startTime,
                endTime: a.endTime,
              })),
            },
          },
        }),
      },
      select: STAFF_SELECT,
    });
  }

  /** Creates the real Staff row — called only from invitation activation, once the invitee has set a password. */
  create(dto: { fullName: string; email: string; role: StaffRole; passwordHash: string; jobTitle?: string | null; phone?: string | null; specialtyCode?: string | null; availability?: CreateStaffDto["availability"] }) {
    const avail = dto.availability ?? [];
    return this.prisma.staff.create({
      data: {
        passwordHash: dto.passwordHash,
        fullName: dto.fullName,
        email: dto.email,
        role: dto.role,
        jobTitle: dto.jobTitle ?? null,
        phone: dto.phone ?? null,
        specialtyCode: dto.specialtyCode ?? null,
        ...(avail.length
          ? {
              availability: {
                createMany: {
                  data: avail.map((a) => ({
                    dayOfWeek: a.dayOfWeek,
                    startTime: a.startTime,
                    endTime: a.endTime,
                  })),
                },
              },
            }
          : {}),
      },
      select: STAFF_SELECT,
    });
  }

  // ─── Invitations ───────────────────────────────────────────────────────────

  createInvitation(dto: InviteStaffDto, token: string, expiresAt: Date, invitedBy?: string) {
    return this.prisma.staffInvitation.create({
      data: {
        token,
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role,
        jobTitle: dto.jobTitle ?? null,
        phone: dto.phone ?? null,
        specialtyCode: dto.specialtyCode ?? null,
        availability: dto.availability ?? undefined,
        invitedBy: invitedBy ?? null,
        expiresAt,
      },
      select: INVITATION_SELECT,
    });
  }

  findPendingInvitations() {
    return this.prisma.staffInvitation.findMany({
      where: { acceptedAt: null },
      select: INVITATION_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  findInvitationByEmail(email: string) {
    return this.prisma.staffInvitation.findFirst({ where: { email, acceptedAt: null } });
  }

  findInvitationByToken(token: string) {
    return this.prisma.staffInvitation.findUnique({ where: { token } });
  }

  findInvitationById(id: string) {
    return this.prisma.staffInvitation.findUnique({ where: { id } });
  }

  markInvitationAccepted(id: string) {
    return this.prisma.staffInvitation.update({ where: { id }, data: { acceptedAt: new Date() } });
  }

  deleteInvitation(id: string) {
    return this.prisma.staffInvitation.delete({ where: { id } });
  }
}
