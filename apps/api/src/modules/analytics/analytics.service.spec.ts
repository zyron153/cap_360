import { Test } from "@nestjs/testing";
import { AnalyticsService } from "./analytics.service";
import { PrismaService } from "../../prisma/prisma.service";

const prisma = {
  appointment: { findMany: jest.fn() },
  patient: { findMany: jest.fn() },
};

function appt(overrides: Partial<{ scheduledAt: Date; status: string; service: { name: string } | null }>) {
  return {
    scheduledAt: new Date("2026-03-15T10:00:00.000Z"),
    status: "completed",
    service: { name: "Consulta Geral" },
    ...overrides,
  };
}

describe("AnalyticsService", () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [AnalyticsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AnalyticsService);
    jest.clearAllMocks();
    prisma.patient.findMany.mockResolvedValue([]);
  });

  describe("getSummary", () => {
    it("buckets appointments by month, service, and hour-of-day from a single period query", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([]); // active-patient query
        return Promise.resolve([
          appt({ scheduledAt: new Date("2026-03-15T09:00:00.000Z"), service: { name: "Consulta Geral" } }),
          appt({ scheduledAt: new Date("2026-03-20T09:00:00.000Z"), service: { name: "Consulta Geral" } }),
          appt({ scheduledAt: new Date("2026-04-02T14:00:00.000Z"), service: { name: "Fisioterapia" } }),
        ]);
      });

      const result = await service.getSummary("2026-01-01", "2026-12-31");

      expect(result.appointmentsByMonth).toEqual([
        { month: "2026-03", count: 2 },
        { month: "2026-04", count: 1 },
      ]);
      expect(result.totalAppointments).toBe(3);
      expect(result.topServices).toEqual([
        { service: "Consulta Geral", count: 2 },
        { service: "Fisioterapia", count: 1 },
      ]);
      expect(result.peakHours).toEqual([
        { hour: 9, count: 2 },
        { hour: 14, count: 1 },
      ]);
    });

    it("computes attendance rate as completed / (completed + no_show), excluding pending/cancelled", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([]);
        return Promise.resolve([
          appt({ status: "completed" }),
          appt({ status: "completed" }),
          appt({ status: "no_show" }),
          appt({ status: "cancelled" }),
          appt({ status: "pending" }),
        ]);
      });

      const result = await service.getSummary("2026-01-01", "2026-12-31");

      expect(result.attendanceRate).toEqual({ completed: 2, noShow: 1, rate: 66.7 });
    });

    it("returns a null rate when there are no completed/no_show appointments in range", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([]);
        return Promise.resolve([appt({ status: "pending" })]);
      });

      const result = await service.getSummary("2026-01-01", "2026-12-31");

      expect(result.attendanceRate).toEqual({ completed: 0, noShow: 0, rate: null });
    });

    it("falls back to 'Sem serviço' for an appointment whose service is missing", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([]);
        return Promise.resolve([appt({ service: null })]);
      });

      const result = await service.getSummary("2026-01-01", "2026-12-31");

      expect(result.topServices).toEqual([{ service: "Sem serviço", count: 1 }]);
    });

    it("counts active patients as distinct patientIds from the trailing-12-months query, independent of the from/to range", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([{ patientId: "p1" }, { patientId: "p2" }]);
        return Promise.resolve([]);
      });
      prisma.patient.findMany.mockResolvedValue([
        { healthPlan: null },
        { healthPlan: null },
      ]);

      const result = await service.getSummary();

      expect(result.activePatients).toBe(2);
    });

    it("buckets active patients into their health-plan product name, or 'Particular' with no active coverage", async () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([{ patientId: "p1" }, { patientId: "p2" }, { patientId: "p3" }, { patientId: "p4" }]);
        return Promise.resolve([]);
      });
      prisma.patient.findMany.mockResolvedValue([
        { healthPlan: { active: true, endDate: future, product: { name: "Familiar", active: true } } },
        { healthPlan: { active: true, endDate: null, product: { name: "Familiar", active: true } } },
        { healthPlan: { active: true, endDate: past, product: { name: "Familiar", active: true } } }, // expired
        { healthPlan: null },
      ]);

      const result = await service.getSummary();

      expect(result.planDistribution).toEqual([
        { label: "Familiar", count: 2, pct: 50 },
        { label: "Particular", count: 2, pct: 50 },
      ]);
    });

    it("skips the plan-distribution patient query entirely when there are no active patients", async () => {
      prisma.appointment.findMany.mockImplementation(({ distinct }: { distinct?: string[] }) => {
        if (distinct) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const result = await service.getSummary();

      expect(result.planDistribution).toEqual([]);
      expect(prisma.patient.findMany).not.toHaveBeenCalled();
    });
  });
});
