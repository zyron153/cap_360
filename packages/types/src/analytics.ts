import { z } from "zod";

export const AnalyticsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export interface AnalyticsSummary {
  /** Appointments scheduled in [from, to], all statuses, bucketed by month ("YYYY-MM"). */
  appointmentsByMonth: { month: string; count: number }[];
  /** Total appointments in [from, to] — same count the monthly buckets above sum to. */
  totalAppointments: number;
  /** completed vs. no_show within [from, to] — pending/confirmed (not yet resolved) and cancelled
   * (patient never intended to come) are excluded from both the numerator and denominator. */
  attendanceRate: { completed: number; noShow: number; rate: number | null };
  /** Top services by appointment count in [from, to], all statuses, capped at 8. */
  topServices: { service: string; count: number }[];
  /** Appointment count by hour-of-day (0–23) in [from, to], all statuses. Only hours with at
   * least one appointment are included — the clinic's own business hours vary by day/staff. */
  peakHours: { hour: number; count: number }[];
  /** A current snapshot (patients with >=1 appointment in the trailing 12 months from now), not
   * scoped to the summary's from/to range — same "activity right now" reasoning as
   * FinanceiroSummary.receivables. */
  activePatients: number;
  /** Same active-patient population as above, grouped by their current health plan product name
   * (an unexpired, active plan on an active product), or "Particular" if none. */
  planDistribution: { label: string; count: number; pct: number }[];
}
