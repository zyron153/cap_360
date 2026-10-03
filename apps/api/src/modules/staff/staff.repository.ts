import { Injectable } from "@nestjs/common";
import { StaffRole } from "@cap/database";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStaffDto, UpdateStaffDto, UpsertStaffShiftDto } from "@cap/types";

const STAFF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  jobTitle: true,
  specialtyCode: true,
  phone: true,
  companyId: true,
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

  /** Same soft-delete convention as patients.repository.ts — deletedAt, not a hard delete. Staff
   * reads already filter deletedAt: null everywhere (findAll/findById/findByEmail/...), so this
   * one write is all that was missing to make deactivation actually reachable. */
  softDelete(id: string) {
    return this.prisma.staff.update({ where: { id }, data: { deletedAt: new Date() } });
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
        ...(dto.companyId !== undefined && { companyId: dto.companyId ?? null }),
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

  /** Creates the Staff row — only called by an admin creating a user, with the password the admin
   * chose (already hashed). */
  create(dto: { fullName: string; email: string; role: StaffRole; passwordHash: string; jobTitle?: string | null; phone?: string | null; specialtyCode?: string | null; companyId?: string | null; availability?: CreateStaffDto["availability"] }) {
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
        companyId: dto.companyId ?? null,
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

  // ─── Leave Requests ────────────────────────────────────────────────────────

  createLeaveRequest(staffId: string, dto: { startDate: string; endDate: string; reason?: string }) {
    return this.prisma.leaveRequest.create({
      data: {
        staffId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason ?? null,
      },
    });
  }

  findLeaveRequestsByStaffId(staffId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { staffId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Admin queue — pending only. */
  findPendingLeaveRequests() {
    return this.prisma.leaveRequest.findMany({
      where: { status: "pending" },
      include: { staff: { select: { id: true, fullName: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  findLeaveRequestById(id: string) {
    return this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  updateLeaveRequestStatus(id: string, status: "approved" | "rejected") {
    return this.prisma.leaveRequest.update({ where: { id }, data: { status } });
  }

  /** Same shape as createLeaveRequest, but pre-approved — the "block my calendar" action from the
   * new availability-calendar tab is deliberately a different, immediate action from the existing
   * request-leave flow above, not a variant of it, even though it shares the same table. */
  createApprovedBlock(staffId: string, dto: { startDate: string; endDate: string; reason?: string }) {
    return this.prisma.leaveRequest.create({
      data: {
        staffId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason ?? null,
        status: "approved",
      },
    });
  }

  deleteLeaveRequest(id: string) {
    return this.prisma.leaveRequest.delete({ where: { id } });
  }

  // ─── Shift overrides ───────────────────────────────────────────────────────

  findShiftsForStaffInRange(staffId: string, from: Date, to: Date) {
    return this.prisma.staffShift.findMany({
      where: { staffId, shiftDate: { gte: from, lte: to } },
      orderBy: { shiftDate: "asc" },
    });
  }

  findShiftById(id: string) {
    return this.prisma.staffShift.findUnique({ where: { id } });
  }

  /** One row per staff per date (`@@unique([staffId, shiftDate])`) — assigning a shift on a date
   * that already has one replaces it rather than erroring, matching the "drag to reassign" UI. */
  upsertShift(staffId: string, dto: UpsertStaffShiftDto) {
    const shiftDate = new Date(dto.shiftDate);
    return this.prisma.staffShift.upsert({
      where: { staffId_shiftDate: { staffId, shiftDate } },
      create: { staffId, shiftDate, startTime: dto.startTime, endTime: dto.endTime, notes: dto.notes ?? null },
      update: { startTime: dto.startTime, endTime: dto.endTime, notes: dto.notes ?? null },
    });
  }

  deleteShift(id: string) {
    return this.prisma.staffShift.delete({ where: { id } });
  }
}
