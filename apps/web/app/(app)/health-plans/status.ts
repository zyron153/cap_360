/** Shared plan-instance status badge, derived client-side from `active` + `endDate` — there is no
 * persisted status enum (see HealthPlan's Prisma model), only the boolean plus a nullable date, so
 * every surface that shows a plan's status (list, detail) must compute it the same way. */
export type PlanStatusKey = "active" | "expiring" | "expired" | "inactive";

export const PLAN_STATUS_META: Record<PlanStatusKey, { label: string; cls: string }> = {
  active:   { label: "Ativo",     cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  expiring: { label: "A Expirar", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  expired:  { label: "Expirado",  cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80" },
  inactive: { label: "Inativo",   cls: "bg-dim-100 text-dim-500" },
};

const EXPIRING_SOON_DAYS = 30;

export function planStatus(plan: { active: boolean; endDate?: string | Date | null }): PlanStatusKey {
  if (!plan.active) return "inactive";
  if (!plan.endDate) return "active";
  const days = (new Date(plan.endDate).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return "active";
}
