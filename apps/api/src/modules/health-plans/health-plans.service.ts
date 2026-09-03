import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import {
  CreateHealthPlanProductDto,
  UpdateHealthPlanProductDto,
  CreateHealthPlanDto,
} from "@cap/types";

@Injectable()
export class HealthPlansService {
  constructor(
    private readonly repo: HealthPlansRepository,
    private readonly staffRepo: StaffRepository,
  ) {}

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

  /** A corporate_hr caller is always scoped to their own Staff.companyId, regardless of what
   * companyId (if any) they pass in — a caller-supplied companyId used to be trusted outright,
   * letting any corporate_hr account read any company's plans. admin/receptionist are unrestricted. */
  async findAllPlans(companyId: string | undefined, user: JwtUser) {
    if (user.roles.includes("corporate_hr")) {
      const ownCompanyId = await this.resolveOwnCompanyId(user.sub);
      if (!ownCompanyId) return []; // no company assigned yet — nothing to show, not everything
      return this.repo.findAllPlans(ownCompanyId);
    }
    return this.repo.findAllPlans(companyId);
  }

  async findPlanById(id: string, user: JwtUser) {
    const plan = await this.repo.findPlanById(id);
    if (!plan) throw new NotFoundException(`Health plan ${id} not found`);

    if (user.roles.includes("corporate_hr")) {
      const ownCompanyId = await this.resolveOwnCompanyId(user.sub);
      // Same 404 either way (missing vs. someone else's) — a corporate_hr caller shouldn't be
      // able to tell the two apart by response shape.
      if (!ownCompanyId || plan.companyId !== ownCompanyId) {
        throw new NotFoundException(`Health plan ${id} not found`);
      }
    }

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

  private async resolveOwnCompanyId(staffId: string): Promise<string | undefined> {
    const staff = await this.staffRepo.findById(staffId);
    return staff?.companyId ?? undefined;
  }

  /** Best-effort — called from AppointmentsService when a patient with an active plan completes
   * an appointment. A failure here must never block the appointment status update itself. */
  incrementUsage(healthPlanId: string) {
    return this.repo.incrementUsage(healthPlanId);
  }

  findExpiringBetween(from: Date, to: Date) {
    return this.repo.findExpiringBetween(from, to);
  }
}
