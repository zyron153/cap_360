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
    product: {
      select: { id: true, name: true, code: true, monthlyFee: true, active: true, durationMonths: true },
    },
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

  updatePlan(id: string, data: Prisma.HealthPlanUpdateInput) {
    return this.prisma.healthPlan.update({ where: { id }, data, select: this.planSelect });
  }

  /** holderPatientId (see note on findExpiringBetween below) has no Prisma @relation, so a plan's
   * holder name can't come back via `include` — batched separately here instead of N+1-querying
   * per plan. Only ever called with the non-empty, deduplicated id list a caller already filtered. */
  findPatientNamesByIds(ids: string[]) {
    return this.prisma.patient.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
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

  findActiveHealthPlanForPatient(patientId: string) {
    return this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        healthPlan: {
          select: {
            id: true,
            active: true,
            endDate: true,
            product: { select: { name: true, active: true, coverageRules: true } },
          },
        },
      },
    });
  }

  /** holderPatientId has no Prisma @relation (it's a soft reference, unlike companyId) — callers
   * that need the holder's contact info must look the patient up separately by that id. */
  findExpiringBetween(from: Date, to: Date) {
    return this.prisma.healthPlan.findMany({
      where: { active: true, endDate: { gte: from, lte: to } },
      select: {
        id: true,
        planNumber: true,
        endDate: true,
        holderPatientId: true,
        product: { select: { name: true } },
        company: { select: { name: true, email: true } },
      },
    });
  }
}
