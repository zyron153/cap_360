import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { RequestContext } from "../../common/context/request-context";
import { hasSessionsLeft } from "./health-plan-coverage";
import {
  CreateHealthPlanProductDto,
  UpdateHealthPlanProductDto,
  CreateHealthPlanDto,
  ActiveHealthPlanSummary,
} from "@cap/types";

/** UTC-midnight-safe month addition for an `@db.Date` column — mirrors the rationale behind
 * appointments.service.ts's parseLocalDate and notifications.processor.ts's todayUtc: a bare
 * calendar date must be moved in whole calendar months without drifting across a local-timezone
 * boundary (Cabo Verde is UTC-1). */
function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

type MembersOf<T> = T & {
  members: { patientId: string; addedAt: Date; patient: { fullName: string | null } }[];
};

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
    // Seguradora lives inside the free-form coverageRules blob (same place as `type`/`coverage`),
    // not a dedicated column — but it's still a required attribute of every product, so that's
    // enforced here rather than left as a client-side-only nicety.
    const seguradora = (dto.coverageRules as { seguradora?: unknown } | undefined)?.seguradora;
    if (typeof seguradora !== "string" || !seguradora.trim()) {
      throw new BadRequestException("Seguradora é obrigatória");
    }

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
      return (await this.repo.findAllPlans(ownCompanyId)).map((p) => this.mapPlan(p));
    }
    return (await this.repo.findAllPlans(companyId)).map((p) => this.mapPlan(p));
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

    return this.mapPlan(plan);
  }

  /** Flattens the repo's nested `members[].patient.fullName` into a flat `patientName` per
   * member, keeping the HTTP contract simple. Zero extra queries — the shape is already there. */
  private mapPlan<T extends MembersOf<unknown>>(plan: T) {
    return {
      ...plan,
      members: plan.members.map((m) => ({
        patientId: m.patientId,
        patientName: m.patient.fullName,
        addedAt: m.addedAt,
      })),
    };
  }

  async createPlan(dto: CreateHealthPlanDto) {
    const product = await this.repo.findProductById(dto.productId);
    if (!product) throw new NotFoundException(`Health plan product ${dto.productId} not found`);

    let planNumber = dto.planNumber;
    if (!planNumber) {
      // Read the year directly from the "YYYY-MM-DD" string rather than via `new Date(...)
      // .getFullYear()` — a bare date string parses as UTC midnight, and .getFullYear() reads it
      // back in local time, silently shifting to the wrong year on any negative-UTC-offset server
      // (same class of bug appointments.service.ts's parseLocalDate already exists to avoid).
      planNumber = await this.repo.nextPlanNumber(product.code, Number(dto.startDate.slice(0, 4)));
    }

    const memberPatientIds = dto.memberPatientIds ?? [];
    for (const patientId of memberPatientIds) {
      if (!(await this.repo.findPatientById(patientId))) {
        throw new NotFoundException(`Patient ${patientId} not found`);
      }
      await this.assertCanAddMember(product, patientId, memberPatientIds.length);
    }

    const plan = await this.repo.createPlanWithMembers(
      {
        product: { connect: { id: dto.productId } },
        ...(dto.companyId ? { company: { connect: { id: dto.companyId } } } : {}),
        planNumber,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        sessionsRemaining: product.sessionsPerCycle ?? null,
      },
      memberPatientIds
    );
    return this.mapPlan(plan);
  }

  /** Manually staff-triggered renewal (no scheduled auto-renew job) — extends endDate by the
   * product's own durationMonths, refills sessionsRemaining to the product's current quota, and
   * reactivates a lapsed plan. Renewing from whichever is later, the plan's current endDate or
   * today, so renewing early (before expiry) stacks onto the remaining term instead of shortening
   * it, while renewing a plan that's already lapsed starts the new term from today rather than
   * compounding onto a stale past date. */
  async renew(id: string) {
    const plan = await this.repo.findPlanById(id);
    if (!plan) throw new NotFoundException(`Health plan ${id} not found`);
    if (!plan.product.active) {
      throw new BadRequestException(
        `Cannot renew — product "${plan.product.name}" has been deactivated`
      );
    }

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const base = plan.endDate && plan.endDate > todayUtc ? plan.endDate : todayUtc;
    const newEndDate = addMonthsUtc(base, plan.product.durationMonths);
    const newSessions = plan.product.sessionsPerCycle ?? null;

    // The generic AuditInterceptor already logs "POST health-plans/:id/renew" — this diff adds
    // the semantic before/after, same mechanism as BillingService.cancel's audit diff.
    RequestContext.setAuditDiff(
      { endDate: plan.endDate, active: plan.active, sessionsRemaining: plan.sessionsRemaining },
      { endDate: newEndDate, active: true, sessionsRemaining: newSessions }
    );

    const updated = await this.repo.updatePlan(id, {
      endDate: newEndDate,
      active: true,
      sessionsRemaining: newSessions,
    });
    return this.mapPlan(updated);
  }

  /** For createPlan's member batch only — the plan doesn't exist yet, so there's no existing
   * membership count to query; the whole batch size is compared against maxMembers directly.
   * Throws ConflictException if the patient is already an active member of a (different) plan —
   * a patient may only be actively covered by one plan at a time — or BadRequestException if the
   * batch itself would exceed the product's maxMembers. */
  private async assertCanAddMember(
    product: { name: string; maxMembers: number | null },
    patientId: string,
    batchSize: number
  ): Promise<void> {
    const existing = await this.repo.findActiveMembership(patientId);
    if (existing) {
      throw new ConflictException(
        `Paciente já é membro do plano ${existing.healthPlan.planNumber}. Remova-o desse plano primeiro.`
      );
    }
    if (product.maxMembers != null && batchSize > product.maxMembers) {
      throw new BadRequestException(
        `O produto "${product.name}" permite no máximo ${product.maxMembers} membro(s) por plano.`
      );
    }
  }

  /** Adds a patient to an existing plan. 404 if the plan or patient doesn't exist, 409 if the
   * patient already has an active membership elsewhere (or here), 400 if the product's
   * maxMembers would be exceeded. */
  async addMember(planId: string, patientId: string) {
    const plan = await this.repo.findPlanById(planId);
    if (!plan) throw new NotFoundException(`Health plan ${planId} not found`);

    const patient = await this.repo.findPatientById(patientId);
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);

    await this.assertCanAddMemberToPlan(planId, plan.product, patientId);

    const before = plan.members.map((m) => m.patientId);
    await this.repo.addMember(planId, patientId);
    const updated = await this.repo.findPlanById(planId);
    const after = updated!.members.map((m) => m.patientId);
    RequestContext.setAuditDiff({ members: before }, { members: after });

    return this.mapPlan(updated!);
  }

  /** Same one-plan-at-a-time + maxMembers checks as createPlan's batch path, but scoped to a
   * single already-existing plan (countActiveMembers reads its real current count directly,
   * rather than the createPlan path's need to account for an in-flight batch). */
  private async assertCanAddMemberToPlan(
    planId: string,
    product: { id: string; name: string; maxMembers: number | null },
    patientId: string
  ): Promise<void> {
    const existing = await this.repo.findActiveMembership(patientId);
    if (existing) {
      if (existing.healthPlanId === planId) {
        throw new ConflictException("Paciente já é membro deste plano.");
      }
      throw new ConflictException(
        `Paciente já é membro do plano ${existing.healthPlan.planNumber}. Remova-o desse plano primeiro.`
      );
    }
    if (product.maxMembers != null) {
      const activeCount = await this.repo.countActiveMembers(planId);
      if (activeCount + 1 > product.maxMembers) {
        throw new BadRequestException(
          `O produto "${product.name}" permite no máximo ${product.maxMembers} membro(s) por plano.`
        );
      }
    }
  }

  /** Soft-removes a patient from a plan. Idempotent — removing someone who isn't currently an
   * active member is a no-op, not an error; only an unknown plan 404s. */
  async removeMember(planId: string, patientId: string) {
    const plan = await this.repo.findPlanById(planId);
    if (!plan) throw new NotFoundException(`Health plan ${planId} not found`);

    const before = plan.members.map((m) => m.patientId);
    await this.repo.softRemoveMember(planId, patientId);
    const updated = await this.repo.findPlanById(planId);
    const after = updated!.members.map((m) => m.patientId);
    RequestContext.setAuditDiff({ members: before }, { members: after });

    return this.mapPlan(updated!);
  }

  private async resolveOwnCompanyId(staffId: string): Promise<string | undefined> {
    const staff = await this.staffRepo.findById(staffId);
    return staff?.companyId ?? undefined;
  }

  /** Best-effort — called from AppointmentsService when a patient completes an appointment.
   * Increments the plan's lifetime usageCount (never reset, keeps counting even once sessions run
   * out) AND decrements sessionsRemaining (floored at 0 by the repo's guarded update). No-ops
   * (returns null) when the patient has no active plan membership at all. A failure here must
   * never block the appointment status update itself — the caller keeps its own try/catch. */
  async recordSessionUsage(patientId: string): Promise<{ healthPlanId: string; sessionsRemaining: number | null } | null> {
    const membership = await this.repo.findActiveMembership(patientId);
    if (!membership) return null;

    await Promise.all([
      this.repo.incrementUsage(membership.healthPlanId),
      this.repo.decrementSession(membership.healthPlanId),
    ]);

    const plan = await this.repo.findPlanById(membership.healthPlanId);
    return { healthPlanId: membership.healthPlanId, sessionsRemaining: plan?.sessionsRemaining ?? null };
  }

  /** One batched lookup -> Map keyed by patientId, used anywhere "does this patient currently have
   * an active plan" needs answering without an N+1 query: the patients list, the BFF patient
   * screen, and analytics' plan-mix chart. */
  async findActivePlanSummaries(patientIds: string[]): Promise<Map<string, ActiveHealthPlanSummary>> {
    if (patientIds.length === 0) return new Map();
    const memberships = await this.repo.findActiveMembershipsForPatients(patientIds);
    const map = new Map<string, ActiveHealthPlanSummary>();
    for (const m of memberships) {
      map.set(m.patientId, {
        id: m.healthPlan.id,
        planNumber: m.healthPlan.planNumber,
        productName: m.healthPlan.product.name,
      });
    }
    return map;
  }

  /** Coverage % (0-100) to apply as a billing discount, or null when the patient has no active
   * plan membership, the plan/product is inactive, the plan has expired, the plan has run out of
   * sessions, or the product's `coverageRules.coverage` is unset/zero. Deliberately separate from
   * `recordSessionUsage` above, which increments/decrements regardless of any of these checks —
   * that's a usage tally, this is a money calculation, and the two shouldn't share the same
   * (looser) gate. */
  async getActiveCoverage(
    patientId: string
  ): Promise<{ healthPlanId: string; coveragePercent: number; productName: string } | null> {
    const [membership] = await this.repo.findActiveMembershipsForPatients([patientId]);
    if (!membership) return null;
    if (!hasSessionsLeft(membership.healthPlan.sessionsRemaining)) return null;

    const coverage = (membership.healthPlan.product.coverageRules as { coverage?: number } | null)?.coverage;
    if (!coverage || coverage <= 0) return null;

    return {
      healthPlanId: membership.healthPlan.id,
      coveragePercent: Math.min(100, coverage),
      productName: membership.healthPlan.product.name,
    };
  }
}
