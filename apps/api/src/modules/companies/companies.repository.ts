import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(activeOnly = true) {
    return this.prisma.company.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { name: "asc" },
    });
  }

  findById(id: string) {
    return this.prisma.company.findUnique({
      where: { id },
      include: { healthPlans: { include: { product: true } } },
    });
  }

  exists(id: string) {
    return this.prisma.company.findUnique({ where: { id }, select: { id: true } });
  }

  findByTaxId(taxId: string) {
    return this.prisma.company.findUnique({ where: { taxId } });
  }

  create(data: Prisma.CompanyCreateInput) {
    return this.prisma.company.create({ data });
  }

  update(id: string, data: Prisma.CompanyUpdateInput) {
    return this.prisma.company.update({ where: { id }, data });
  }
}
