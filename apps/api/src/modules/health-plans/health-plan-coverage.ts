import { Prisma } from "@cap/database";

/** Two deliberately different questions, kept apart on purpose:
 *  - "is this patient ON a live plan?"  -> activeMembershipWhere() — drives list badges, the
 *    plan-mix chart, the patients planFilter, and the expiry notification job.
 *  - "does this visit get a discount?"  -> HealthPlansService.getActiveCoverage(), which ALSO
 *    requires sessions left and coverageRules.coverage > 0.
 *  A plan that has run out of sessions still has members; it just stops discounting. */
export function activeMembershipWhere(now: Date = new Date()): Prisma.HealthPlanMemberWhereInput {
  return {
    removedAt: null,
    healthPlan: {
      active: true,
      product: { active: true },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
  };
}

export function hasSessionsLeft(sessionsRemaining: number | null): boolean {
  return sessionsRemaining === null || sessionsRemaining > 0;
}
