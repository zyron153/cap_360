import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStaffDto, UpdateStaffDto } from "@cms/types";

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

  findByKeycloakId(keycloakId: string) {
    return this.prisma.staff.findFirst({
      where: { keycloakId, deletedAt: null },
      select: STAFF_SELECT,
    });
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

  create(dto: CreateStaffDto) {
    const avail = dto.availability ?? [];
    return this.prisma.staff.create({
      data: {
        // ponytail: placeholder keycloakId until Keycloak provisioning is wired (Phase 2)
        keycloakId: randomUUID(),
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
}
