import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AnalyticsSummary } from "@cap/types";

const ACTIVE_PATIENT_WINDOW_MONTHS = 12;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(from?: string, to?: string): Promise<AnalyticsSummary> {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(`${to}T23:59:59Z`) : new Date();

    const now = new Date();
    const activeSince = new Date(now);
    activeSince.setMonth(activeSince.getMonth() - ACTIVE_PATIENT_WINDOW_MONTHS);

    const [periodAppointments, activeAppointments] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { scheduledAt: { gte: fromDate, lte: toDate }, deletedAt: null },
        select: { scheduledAt: true, status: true, service: { select: { name: true } } },
      }),
      this.prisma.appointment.findMany({
        where: { scheduledAt: { gte: activeSince }, deletedAt: null, patient: { deletedAt: null } },
        distinct: ["patientId"],
        select: { patientId: true },
      }),
    ]);

    // Monthly buckets, service counts, and hour-of-day counts all fall out of one pass over the
    // same period query — mirrors FinanceiroService.getSummary's own bump-map pattern rather than
    // four separate grouped queries.
    const byMonth = new Map<string, number>();
    const byService = new Map<string, number>();
    const byHour = new Map<number, number>();
    let completed = 0;
    let noShow = 0;

    for (const appt of periodAppointments) {
      const month = appt.scheduledAt.toISOString().slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);

      const serviceName = appt.service?.name ?? "Sem serviço";
      byService.set(serviceName, (byService.get(serviceName) ?? 0) + 1);

      const hour = appt.scheduledAt.getUTCHours();
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1);

      if (appt.status === "completed") completed++;
      else if (appt.status === "no_show") noShow++;
    }

    const appointmentsByMonth = Array.from(byMonth.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const topServices = Array.from(byService.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const peakHours = Array.from(byHour.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    const attendanceDenom = completed + noShow;
    const attendanceRate = {
      completed,
      noShow,
      rate: attendanceDenom > 0 ? Math.round((completed / attendanceDenom) * 1000) / 10 : null,
    };

    const activePatientIds = activeAppointments.map((a) => a.patientId);
    const planDistribution = await this.buildPlanDistribution(activePatientIds, now);

    return {
      appointmentsByMonth,
      totalAppointments: periodAppointments.length,
      attendanceRate,
      topServices,
      peakHours,
      activePatients: activePatientIds.length,
      planDistribution,
    };
  }

  private async buildPlanDistribution(patientIds: string[], now: Date): Promise<AnalyticsSummary["planDistribution"]> {
    if (patientIds.length === 0) return [];

    const patients = await this.prisma.patient.findMany({
      where: { id: { in: patientIds } },
      select: {
        healthPlan: {
          select: {
            active: true,
            endDate: true,
            product: { select: { name: true, active: true } },
          },
        },
      },
    });

    const counts = new Map<string, number>();
    for (const patient of patients) {
      const plan = patient.healthPlan;
      const hasCoverage =
        !!plan && plan.active && plan.product.active && (!plan.endDate || plan.endDate >= now);
      const label = hasCoverage ? plan!.product.name : "Particular";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const total = patients.length;
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
  }
}
