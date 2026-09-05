import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

const ADMIN_SELECT = {
  id: true, name: true, code: true, description: true,
  durationMinutes: true, price: true, active: true, specialtyCode: true,
  createdAt: true, updatedAt: true,
};

@Injectable()
export class ServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.service.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        durationMinutes: true,
        price: true,
        specialtyCode: true,
      },
      orderBy: { name: "asc" },
    });
  }

  findById(id: string) {
    return this.prisma.service.findFirst({
      where: { id, active: true },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        durationMinutes: true,
        price: true,
        specialtyCode: true,
      },
    });
  }

  findAllAdmin() {
    return this.prisma.service.findMany({ select: ADMIN_SELECT, orderBy: { name: "asc" } });
  }

  findByIdAdmin(id: string) {
    return this.prisma.service.findUnique({ where: { id } });
  }

  findByCode(code: string) {
    return this.prisma.service.findUnique({ where: { code } });
  }

  create(data: Prisma.ServiceCreateInput) {
    return this.prisma.service.create({ data, select: ADMIN_SELECT });
  }

  update(id: string, data: Prisma.ServiceUpdateInput) {
    return this.prisma.service.update({ where: { id }, data, select: ADMIN_SELECT });
  }
}
