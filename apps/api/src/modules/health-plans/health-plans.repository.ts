import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";
import { activeMembershipWhere } from "./health-plan-coverage";

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
    sessionsRemaining: true,
    createdAt: true,
    companyId: true,
    product: {
      select: {
        id: true, name: true, code: true, monthlyFee: true, active: true,
        durationMonths: true, sessionsPerCycle: true, maxMembers: true,
      },
    },
    company: { select: { id: true, name: true } },
    members: {
      where: { removedAt: null },
      orderBy: { addedAt: "asc" },
      select: { patientId: true, addedAt: true, patient: { select: { fullName: true } } },
    },
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

  /** Plan creation and first-member attachment as one transaction — the two used to be a
   * non-atomic pair of separate HTTP requests from the frontend (create the plan, then PATCH the
   * patient to point at it), which could leave a plan with no coverage if the second call failed. */
  async createPlanWithMembers(data: Prisma.HealthPlanCreateInput, patientIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.healthPlan.create({ data });
      if (patientIds.length > 0) {
        await tx.healthPlanMember.createMany({
          data: patientIds.map((patientId) => ({ healthPlanId: plan.id, patientId })),
        });
      }
      return tx.healthPlan.findUniqueOrThrow({ where: { id: plan.id }, select: this.planSelect });
    });
  }

  updatePlan(id: string, data: Prisma.HealthPlanUpdateInput) {
    return this.prisma.healthPlan.update({ where: { id }, data, select: this.planSelect });
  }

  /** Race-safe plan-number generation, mirroring BillingRepository.nextInvoiceNumber's advisory
   * -lock pattern exactly — a client-computed "count of existing plans + 1" (the previous approach)
   * can collide under concurrent submissions and surface as a raw 500 on the unique constraint.
   * A two-argument advisory lock keeps this in its own namespace, separate from invoices' lock.
   * pg_advisory_xact_lock inside $transaction, not plain pg_advisory_lock/unlock as separate calls
   * — see BillingRepository.nextInvoiceNumber for why that pairing is unsafe under connection
   * pooling (the try/finally here didn't actually protect against it: the bug was never about an
   * exception skipping the unlock, it's that lock and unlock aren't guaranteed to hit the same
   * pooled connection at all). */
  async nextPlanNumber(productCode: string, year: number): Promise<string> {
    const NAMESPACE = 8781; // arbitrary fixed first key — just needs to differ from other lock users
    return this.prisma.$transaction(async (tx) => {
      // Explicit ::int casts matter: Prisma's pg driver binds plain numeric placeholders as
      // bigint, and Postgres has no pg_advisory_xact_lock(bigint, bigint) overload — only the
      // single-arg bigint form and this two-arg int form — so the uncast call 42883s in real
      // Postgres despite type-checking fine and passing every (fully-mocked) unit test.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE}::int, ${year}::int)`;
      const result = await tx.$queryRaw<[{ next_seq: bigint }]>`
        SELECT (SELECT COUNT(*) FROM health_plans hp
                JOIN health_plan_products hpp ON hpp.id = hp."productId"
                WHERE hpp.code = ${productCode}
                  AND hp."startDate" >= ${new Date(`${year}-01-01`)}
                  AND hp."startDate" <  ${new Date(`${year + 1}-01-01`)}) + 1 AS next_seq
      `;
      const seq = String(Number(result[0].next_seq)).padStart(3, "0");
      return `${productCode}-${year}-${seq}`;
    });
  }

  incrementUsage(id: string) {
    return this.prisma.healthPlan.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
      select: { id: true, usageCount: true },
    });
  }

  /** Guarded updateMany (not a plain `update` + `{ decrement: 1 }`) so the counter can never go
   * negative under concurrent completions — the `gt: 0` means an already-exhausted plan's call
   * here simply matches zero rows and no-ops. */
  decrementSession(id: string) {
    return this.prisma.healthPlan.updateMany({
      where: { id, sessionsRemaining: { gt: 0 } },
      data: { sessionsRemaining: { decrement: 1 } },
    });
  }

  /** One batched lookup, used by the single-patient billing path, the patients list (a page of
   * 20), and analytics' whole-clinic batch alike — this clinic's patient count is in the hundreds,
   * not millions, so a single `IN` query beats a per-patient loop everywhere it's called from. */
  findActiveMembershipsForPatients(patientIds: string[]) {
    return this.prisma.healthPlanMember.findMany({
      where: { patientId: { in: patientIds }, ...activeMembershipWhere() },
      select: {
        patientId: true,
        healthPlan: {
          select: {
            id: true, planNumber: true, endDate: true, sessionsRemaining: true,
            product: { select: { name: true, coverageRules: true } },
          },
        },
      },
    });
  }

  /** First active membership for a patient, anywhere — used to enforce "one active plan at a
   * time" before adding them to a different plan. Includes the plan's own number for a friendly
   * conflict message. Deliberately not gated through activeMembershipWhere() (which also checks
   * plan/product active + endDate) — a patient already on a *lapsed* plan should still be treated
   * as "on a plan" for this check, since renewing it is the fix, not silently allowing a second one. */
  findActiveMembership(patientId: string) {
    return this.prisma.healthPlanMember.findFirst({
      where: { patientId, removedAt: null },
      select: { healthPlanId: true, patientId: true, healthPlan: { select: { planNumber: true } } },
    });
  }

  /** By the composite unique key, regardless of removedAt — addMember needs to know whether to
   * insert a fresh row or revive a previously-removed one. */
  findMembership(healthPlanId: string, patientId: string) {
    return this.prisma.healthPlanMember.findUnique({
      where: { healthPlanId_patientId: { healthPlanId, patientId } },
    });
  }

  countActiveMembers(healthPlanId: string) {
    return this.prisma.healthPlanMember.count({ where: { healthPlanId, removedAt: null } });
  }

  /** Existence check for addMember — the FK on HealthPlanMember.patientId would reject a bogus id
   * anyway, but a friendly 404 beats a raw Prisma constraint error surfacing to the caller. */
  findPatientById(patientId: string) {
    return this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
  }

  /** Upsert on the composite unique — re-adding a previously-removed patient revives that same
   * row (and resets addedAt, since it's effectively a fresh enrollment) rather than inserting a
   * second one, which the unique constraint would reject anyway. */
  addMember(healthPlanId: string, patientId: string) {
    return this.prisma.healthPlanMember.upsert({
      where: { healthPlanId_patientId: { healthPlanId, patientId } },
      update: { removedAt: null, addedAt: new Date() },
      create: { healthPlanId, patientId },
    });
  }

  /** Soft removal only — an invoice can carry a permanent snapshot discount tied to this
   * membership having existed, so the row itself is never deleted. A no-op (0 rows) is not an
   * error; the service treats "not currently an active member" as already-achieved, not a 404. */
  softRemoveMember(healthPlanId: string, patientId: string) {
    return this.prisma.healthPlanMember.updateMany({
      where: { healthPlanId, patientId, removedAt: null },
      data: { removedAt: new Date() },
    });
  }
}
