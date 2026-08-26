import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

@Injectable()
export class HealthPlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Products ──────────────────────────────────────────────────────────────

  findAllProducts(activeOnly = true) {
    return this.prisma.healthPlanProduct.findMany({
      where: activeOnly ? { active: true } : {},
      include: { company: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }

  findProductById(id: string) {
    return this.prisma.healthPlanProduct.findUnique({ where: { id } });
  }

  createProduct(data: Prisma.HealthPlanProductCreateInput) {
    return this.prisma.healthPlanProduct.create({ data });
  }

  updateProduct(id: string, data: Prisma.HealthPlanProductUpdateInput) {
    return this.prisma.healthPlanProduct.update({ where: { id }, data });
  }

  // ─── Plans ─────────────────────────────────────────────────────────────────

  private readonly planSelect = {
    id: true,
    planNumber: true,
    startDate: true,
    endDate: true,
    active: true,
    usageCount: true,
    createdAt: true,
    holderPatientId: true,
    companyId: true,
    product: { select: { id: true, name: true, code: true, monthlyFee: true, active: true } },
    company: { select: { id: true, name: true } },
  } as const;

  findAllPlans(companyId?: string) {
    return this.prisma.healthPlan.findMany({
      where: companyId ? { companyId } : {},
      select: this.planSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  findPlanById(id: string) {
    return this.prisma.healthPlan.findUnique({
      where: { id },
      select: this.planSelect,
    });
  }

  createPlan(data: Prisma.HealthPlanCreateInput) {
    return this.prisma.healthPlan.create({ data, include: { product: true, company: true } });
  }
}
