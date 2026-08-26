import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { HealthPlansRepository } from "./health-plans.repository";
import {
  CreateHealthPlanProductDto,
  UpdateHealthPlanProductDto,
  CreateHealthPlanDto,
} from "@cap/types";

@Injectable()
export class HealthPlansService {
  constructor(private readonly repo: HealthPlansRepository) {}

  // ─── Products ──────────────────────────────────────────────────────────────

  findAllProducts(activeOnly = true) {
    return this.repo.findAllProducts(activeOnly);
  }

  async findProductById(id: string) {
    const product = await this.repo.findProductById(id);
    if (!product) throw new NotFoundException(`Health plan product ${id} not found`);
    return product;
  }

  createProduct(dto: CreateHealthPlanProductDto) {
    return this.repo.createProduct({
      ...dto,
      monthlyFee: dto.monthlyFee,
      coverageRules: dto.coverageRules as Prisma.InputJsonValue | undefined,
    });
  }

  async updateProduct(id: string, dto: UpdateHealthPlanProductDto) {
    await this.findProductById(id);
    return this.repo.updateProduct(id, {
      ...dto,
      coverageRules: dto.coverageRules as Prisma.InputJsonValue | undefined,
    });
  }

  async deactivateProduct(id: string) {
    await this.findProductById(id);
    return this.repo.updateProduct(id, { active: false });
  }

  // ─── Plans ─────────────────────────────────────────────────────────────────

  findAllPlans(companyId?: string) {
    return this.repo.findAllPlans(companyId);
  }

  async findPlanById(id: string) {
    const plan = await this.repo.findPlanById(id);
    if (!plan) throw new NotFoundException(`Health plan ${id} not found`);
    return plan;
  }

  createPlan(dto: CreateHealthPlanDto) {
    return this.repo.createPlan({
      product: { connect: { id: dto.productId } },
      ...(dto.holderPatientId ? { holderPatientId: dto.holderPatientId } : {}),
      ...(dto.companyId ? { company: { connect: { id: dto.companyId } } } : {}),
      planNumber: dto.planNumber,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });
  }
}
