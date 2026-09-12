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

  async createPlan(dto: CreateHealthPlanDto) {
    let planNumber = dto.planNumber;
    if (!planNumber) {
      const product = await this.repo.findProductById(dto.productId);
      if (!product) throw new NotFoundException(`Health plan product ${dto.productId} not found`);
      // Read the year directly from the "YYYY-MM-DD" string rather than via `new Date(...)
      // .getFullYear()` — a bare date string parses as UTC midnight, and .getFullYear() reads it
      // back in local time, silently shifting to the wrong year on any negative-UTC-offset server
      // (same class of bug appointments.service.ts's parseLocalDate already exists to avoid).
      planNumber = await this.repo.nextPlanNumber(product.code, Number(dto.startDate.slice(0, 4)));
    }

    return this.repo.createPlan({
      product: { connect: { id: dto.productId } },
      ...(dto.holderPatientId ? { holderPatientId: dto.holderPatientId } : {}),
      ...(dto.companyId ? { company: { connect: { id: dto.companyId } } } : {}),
      planNumber,
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

  /** Coverage % (0-100) to apply as a billing discount, or null when the patient has no plan, the
   * plan/product is inactive, the plan has expired, or the product's `coverageRules.coverage` is
   * unset/zero. Deliberately separate from `incrementUsage` above, which currently increments
   * regardless of any of these checks — that's a usage tally, this is a money calculation, and the
   * two shouldn't share the same (looser) gate. */
  async getActiveCoverage(
    patientId: string
  ): Promise<{ healthPlanId: string; coveragePercent: number; productName: string } | null> {
    const result = await this.repo.findActiveHealthPlanForPatient(patientId);
    const plan = result?.healthPlan;
    if (!plan || !plan.active || !plan.product.active) return null;
    if (plan.endDate && plan.endDate < new Date()) return null;

    const coverage = (plan.product.coverageRules as { coverage?: number } | null)?.coverage;
    if (!coverage || coverage <= 0) return null;

    return {
      healthPlanId: plan.id,
      coveragePercent: Math.min(100, coverage),
      productName: plan.product.name,
    };
  }
}
