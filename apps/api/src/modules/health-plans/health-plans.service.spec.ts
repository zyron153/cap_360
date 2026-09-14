import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { HealthPlansService } from "./health-plans.service";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";

const repo = {
  findAllPlans: jest.fn(),
  findPlanById: jest.fn(),
  findProductById: jest.fn(),
  nextPlanNumber: jest.fn(),
  createPlanWithMembers: jest.fn(),
  updatePlan: jest.fn(),
  findActiveMembership: jest.fn(),
  findActiveMembershipsForPatients: jest.fn(),
  findPatientById: jest.fn(),
  addMember: jest.fn(),
  softRemoveMember: jest.fn(),
  countActiveMembers: jest.fn(),
  incrementUsage: jest.fn(),
  decrementSession: jest.fn(),
};
const staffRepo = { findById: jest.fn() };

const ADMIN = { sub: "admin-1", email: "a@cap.cv", roles: ["admin"] };
const HR = { sub: "hr-1", email: "hr@cap.cv", roles: ["corporate_hr"] };

// mapPlan() flattens plan.members[].patient.fullName into patientName — every repo plan fixture
// needs a `members` array (possibly empty) with this nested shape, or mapPlan throws.
function planFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    companyId: null,
    endDate: null as Date | null,
    active: true,
    sessionsRemaining: null as number | null,
    product: { name: "Plano Familiar", active: true, durationMonths: 1, sessionsPerCycle: null as number | null },
    members: [] as { patientId: string; addedAt: Date; patient: { fullName: string | null } }[],
    ...overrides,
  };
}

describe("HealthPlansService", () => {
  let service: HealthPlansService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        HealthPlansService,
        { provide: HealthPlansRepository, useValue: repo },
        { provide: StaffRepository, useValue: staffRepo },
      ],
    }).compile();
    service = mod.get(HealthPlansService);
    jest.clearAllMocks();
  });

  describe("findAllPlans — company scoping for corporate_hr", () => {
    it("lets admin/receptionist filter by any companyId query param, or none at all", async () => {
      repo.findAllPlans.mockResolvedValue([]);
      await service.findAllPlans("company-x", ADMIN);
      expect(repo.findAllPlans).toHaveBeenCalledWith("company-x");
      expect(staffRepo.findById).not.toHaveBeenCalled();

      await service.findAllPlans(undefined, ADMIN);
      expect(repo.findAllPlans).toHaveBeenCalledWith(undefined);
    });

    it("forces a corporate_hr caller to their own company, ignoring any requested companyId", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: "company-a" });
      repo.findAllPlans.mockResolvedValue([]);

      await service.findAllPlans("company-b", HR); // tries to request someone else's company

      expect(repo.findAllPlans).toHaveBeenCalledWith("company-a");
      expect(repo.findAllPlans).not.toHaveBeenCalledWith("company-b");
    });

    it("returns an empty list, without querying plans at all, for a corporate_hr with no company assigned", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: null });

      const result = await service.findAllPlans("company-b", HR);

      expect(result).toEqual([]);
      expect(repo.findAllPlans).not.toHaveBeenCalled();
    });

    it("flattens members[].patient.fullName into a flat patientName per member", async () => {
      repo.findAllPlans.mockResolvedValue([
        planFixture({
          id: "plan-1",
          members: [{ patientId: "pat-1", addedAt: new Date("2026-01-01"), patient: { fullName: "Ana Silva" } }],
        }),
      ]);

      const result = await service.findAllPlans(undefined, ADMIN);

      expect(result).toEqual([
        expect.objectContaining({
          id: "plan-1",
          members: [{ patientId: "pat-1", patientName: "Ana Silva", addedAt: new Date("2026-01-01") }],
        }),
      ]);
    });
  });

  describe("findPlanById", () => {
    it("lets admin/receptionist fetch any plan", async () => {
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1", companyId: "company-b" }));
      await expect(service.findPlanById("plan-1", ADMIN)).resolves.toEqual(
        expect.objectContaining({ id: "plan-1", companyId: "company-b" })
      );
    });

    it("lets a corporate_hr caller fetch a plan belonging to their own company", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: "company-a" });
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1", companyId: "company-a" }));

      await expect(service.findPlanById("plan-1", HR)).resolves.toEqual(
        expect.objectContaining({ id: "plan-1", companyId: "company-a" })
      );
    });

    it("throws NotFoundException — not a bare 403 — when a corporate_hr caller requests another company's plan", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: "company-a" });
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1", companyId: "company-b" }));

      await expect(service.findPlanById("plan-1", HR)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException for a corporate_hr caller with no company assigned, even if the plan exists", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: null });
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1", companyId: "company-a" }));

      await expect(service.findPlanById("plan-1", HR)).rejects.toThrow(NotFoundException);
    });

    it("still throws NotFoundException for a genuinely missing plan id", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.findPlanById("ghost", ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  describe("createPlan", () => {
    const product = { id: "prod-1", name: "Plano Individual", code: "IMPAR-IND-001", maxMembers: null, sessionsPerCycle: 10 };

    it("uses a caller-supplied planNumber as-is, without generating one", async () => {
      repo.findProductById.mockResolvedValue(product);
      repo.createPlanWithMembers.mockResolvedValue(planFixture({ id: "plan-1", planNumber: "CUSTOM-001" } as never));

      await service.createPlan({
        productId: "prod-1", planNumber: "CUSTOM-001", startDate: "2026-01-01",
      } as never);

      expect(repo.nextPlanNumber).not.toHaveBeenCalled();
      expect(repo.createPlanWithMembers).toHaveBeenCalledWith(
        expect.objectContaining({ planNumber: "CUSTOM-001", sessionsRemaining: 10 }),
        []
      );
    });

    it("generates a race-safe plan number server-side when none is provided, keyed by the product's own code and the start year", async () => {
      repo.findProductById.mockResolvedValue(product);
      repo.nextPlanNumber.mockResolvedValue("IMPAR-IND-001-2026-004");
      repo.createPlanWithMembers.mockResolvedValue(planFixture());

      await service.createPlan({ productId: "prod-1", startDate: "2026-01-01" } as never);

      expect(repo.nextPlanNumber).toHaveBeenCalledWith("IMPAR-IND-001", 2026);
      expect(repo.createPlanWithMembers).toHaveBeenCalledWith(
        expect.objectContaining({ planNumber: "IMPAR-IND-001-2026-004" }),
        []
      );
    });

    it("throws NotFoundException for a nonexistent product, without creating a plan", async () => {
      repo.findProductById.mockResolvedValue(null);
      await expect(
        service.createPlan({ productId: "ghost", startDate: "2026-01-01" } as never)
      ).rejects.toThrow(NotFoundException);
      expect(repo.createPlanWithMembers).not.toHaveBeenCalled();
    });

    it("validates and attaches memberPatientIds atomically via createPlanWithMembers", async () => {
      repo.findProductById.mockResolvedValue(product);
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue(null);
      repo.createPlanWithMembers.mockResolvedValue(planFixture());

      await service.createPlan({ productId: "prod-1", startDate: "2026-01-01", memberPatientIds: ["pat-1"] } as never);

      expect(repo.createPlanWithMembers).toHaveBeenCalledWith(expect.anything(), ["pat-1"]);
    });

    it("throws NotFoundException when a memberPatientIds entry doesn't exist", async () => {
      repo.findProductById.mockResolvedValue(product);
      repo.findPatientById.mockResolvedValue(null);

      await expect(
        service.createPlan({ productId: "prod-1", startDate: "2026-01-01", memberPatientIds: ["ghost"] } as never)
      ).rejects.toThrow(NotFoundException);
      expect(repo.createPlanWithMembers).not.toHaveBeenCalled();
    });

    it("throws ConflictException when a memberPatientIds entry is already actively covered elsewhere", async () => {
      repo.findProductById.mockResolvedValue(product);
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue({ healthPlan: { planNumber: "OTHER-001" } });

      await expect(
        service.createPlan({ productId: "prod-1", startDate: "2026-01-01", memberPatientIds: ["pat-1"] } as never)
      ).rejects.toThrow(ConflictException);
      expect(repo.createPlanWithMembers).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when memberPatientIds exceeds the product's maxMembers", async () => {
      repo.findProductById.mockResolvedValue({ ...product, maxMembers: 1 });
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue(null);

      await expect(
        service.createPlan({ productId: "prod-1", startDate: "2026-01-01", memberPatientIds: ["pat-1", "pat-2"] } as never)
      ).rejects.toThrow(BadRequestException);
      expect(repo.createPlanWithMembers).not.toHaveBeenCalled();
    });
  });

  describe("addMember / removeMember", () => {
    it("adds a patient to an existing plan and writes an audit diff", async () => {
      const { RequestContext } = await import("../../common/context/request-context");
      const spy = jest.spyOn(RequestContext, "setAuditDiff");
      const before = planFixture({ id: "plan-1", product: { name: "P", active: true, durationMonths: 1, maxMembers: null } });
      const after = planFixture({
        id: "plan-1",
        product: { name: "P", active: true, durationMonths: 1, maxMembers: null },
        members: [{ patientId: "pat-1", addedAt: new Date(), patient: { fullName: "Ana Silva" } }],
      });
      repo.findPlanById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue(null);

      const result = await service.addMember("plan-1", "pat-1");

      expect(repo.addMember).toHaveBeenCalledWith("plan-1", "pat-1");
      expect(result.members).toEqual([{ patientId: "pat-1", patientName: "Ana Silva", addedAt: expect.any(Date) }]);
      expect(spy).toHaveBeenCalledWith({ members: [] }, { members: ["pat-1"] });
      spy.mockRestore();
    });

    it("throws NotFoundException for a nonexistent plan", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.addMember("ghost", "pat-1")).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException for a nonexistent patient", async () => {
      repo.findPlanById.mockResolvedValue(planFixture());
      repo.findPatientById.mockResolvedValue(null);
      await expect(service.addMember("plan-1", "ghost")).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when the patient is already a member of this same plan", async () => {
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1" }));
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue({ healthPlanId: "plan-1", healthPlan: { planNumber: "PLN-1" } });

      await expect(service.addMember("plan-1", "pat-1")).rejects.toThrow(ConflictException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it("throws ConflictException when the patient is already a member of a different plan", async () => {
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1" }));
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue({ healthPlanId: "plan-2", healthPlan: { planNumber: "PLN-2" } });

      await expect(service.addMember("plan-1", "pat-1")).rejects.toThrow(ConflictException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when adding would exceed the product's maxMembers", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({ id: "plan-1", product: { name: "P", active: true, durationMonths: 1, maxMembers: 1 } })
      );
      repo.findPatientById.mockResolvedValue({ id: "pat-1" });
      repo.findActiveMembership.mockResolvedValue(null);
      repo.countActiveMembers.mockResolvedValue(1);

      await expect(service.addMember("plan-1", "pat-1")).rejects.toThrow(BadRequestException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it("removes a member (soft) and is idempotent for a non-member", async () => {
      const before = planFixture({ id: "plan-1", members: [{ patientId: "pat-1", addedAt: new Date(), patient: { fullName: "Ana" } }] });
      const after = planFixture({ id: "plan-1", members: [] });
      repo.findPlanById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const result = await service.removeMember("plan-1", "pat-1");

      expect(repo.softRemoveMember).toHaveBeenCalledWith("plan-1", "pat-1");
      expect(result.members).toEqual([]);
    });

    it("throws NotFoundException for a nonexistent plan on removal", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.removeMember("ghost", "pat-1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("recordSessionUsage", () => {
    it("no-ops (returns null) when the patient has no active membership", async () => {
      repo.findActiveMembership.mockResolvedValue(null);
      await expect(service.recordSessionUsage("pat-1")).resolves.toBeNull();
      expect(repo.incrementUsage).not.toHaveBeenCalled();
      expect(repo.decrementSession).not.toHaveBeenCalled();
    });

    it("increments usageCount and decrements sessionsRemaining together for an active member", async () => {
      repo.findActiveMembership.mockResolvedValue({ healthPlanId: "plan-1" });
      repo.findPlanById.mockResolvedValue(planFixture({ id: "plan-1", sessionsRemaining: 6 }));

      const result = await service.recordSessionUsage("pat-1");

      expect(repo.incrementUsage).toHaveBeenCalledWith("plan-1");
      expect(repo.decrementSession).toHaveBeenCalledWith("plan-1");
      expect(result).toEqual({ healthPlanId: "plan-1", sessionsRemaining: 6 });
    });
  });

  describe("getActiveCoverage", () => {
    const activePlan = (overrides: Record<string, unknown> = {}) => [{
      healthPlan: {
        id: "plan-1",
        active: true,
        endDate: null,
        sessionsRemaining: null as number | null,
        product: {
          name: "Plano Familiar",
          active: true,
          coverageRules: { type: "familiar", coverage: 80 } as Record<string, unknown> | null,
        },
        ...overrides,
      },
    }];

    it("returns null when the patient has no active plan membership at all", async () => {
      repo.findActiveMembershipsForPatients.mockResolvedValue([]);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when coverageRules has no coverage percentage set", async () => {
      const [m] = activePlan();
      m.healthPlan.product = { ...m.healthPlan.product, coverageRules: { type: "familiar" } };
      repo.findActiveMembershipsForPatients.mockResolvedValue([m]);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when coverage is explicitly 0", async () => {
      const [m] = activePlan();
      m.healthPlan.product = { ...m.healthPlan.product, coverageRules: { coverage: 0 } };
      repo.findActiveMembershipsForPatients.mockResolvedValue([m]);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when the plan has run out of sessions", async () => {
      repo.findActiveMembershipsForPatients.mockResolvedValue(activePlan({ sessionsRemaining: 0 }));
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns coverage when sessionsRemaining is null (unlimited)", async () => {
      repo.findActiveMembershipsForPatients.mockResolvedValue(activePlan({ sessionsRemaining: null }));
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual(
        expect.objectContaining({ coveragePercent: 80 })
      );
    });

    it("returns the coverage percentage, plan id, and product name for a valid active plan with sessions left", async () => {
      repo.findActiveMembershipsForPatients.mockResolvedValue(activePlan({ sessionsRemaining: 3 }));
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual({
        healthPlanId: "plan-1",
        coveragePercent: 80,
        productName: "Plano Familiar",
      });
    });

    it("caps coverage at 100% even if the stored value is higher", async () => {
      const [m] = activePlan();
      m.healthPlan.product = { ...m.healthPlan.product, coverageRules: { coverage: 150 } };
      repo.findActiveMembershipsForPatients.mockResolvedValue([m]);
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual(
        expect.objectContaining({ coveragePercent: 100 })
      );
    });
  });

  describe("renew", () => {
    it("throws NotFoundException for a nonexistent plan", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.renew("ghost")).rejects.toThrow(NotFoundException);
      expect(repo.updatePlan).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when the plan's product has been deactivated", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({ product: { name: "Plano X", active: false, durationMonths: 1, sessionsPerCycle: null } })
      );
      await expect(service.renew("plan-1")).rejects.toThrow(BadRequestException);
      expect(repo.updatePlan).not.toHaveBeenCalled();
    });

    it("extends from today (UTC) and reactivates a plan that already lapsed", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({
          endDate: new Date("2020-01-01"), active: false,
          product: { name: "P", active: true, durationMonths: 1, sessionsPerCycle: null },
        })
      );
      repo.updatePlan.mockResolvedValue(planFixture());

      await service.renew("plan-1");

      const [, data] = repo.updatePlan.mock.calls[0];
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const expected = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + 1, todayUtc.getUTCDate()));
      expect(data.endDate).toEqual(expected);
      expect(data.active).toBe(true);
    });

    it("extends from the plan's own future endDate rather than today, for an early renewal", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({
          endDate: new Date(Date.UTC(2027, 5, 15)),
          product: { name: "P", active: true, durationMonths: 12, sessionsPerCycle: null },
        })
      );
      repo.updatePlan.mockResolvedValue(planFixture());

      await service.renew("plan-1");

      const [, data] = repo.updatePlan.mock.calls[0];
      expect(data.endDate).toEqual(new Date(Date.UTC(2028, 5, 15)));
    });

    it("refills sessionsRemaining to the product's current sessionsPerCycle", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({
          sessionsRemaining: 1,
          product: { name: "P", active: true, durationMonths: 1, sessionsPerCycle: 10 },
        })
      );
      repo.updatePlan.mockResolvedValue(planFixture());

      await service.renew("plan-1");

      const [, data] = repo.updatePlan.mock.calls[0];
      expect(data.sessionsRemaining).toBe(10);
    });

    it("writes a before/after audit diff via RequestContext, including sessionsRemaining", async () => {
      const { RequestContext } = await import("../../common/context/request-context");
      const spy = jest.spyOn(RequestContext, "setAuditDiff");
      repo.findPlanById.mockResolvedValue(
        planFixture({
          endDate: new Date(Date.UTC(2027, 0, 1)), sessionsRemaining: 2,
          product: { name: "P", active: true, durationMonths: 1, sessionsPerCycle: 10 },
        })
      );
      repo.updatePlan.mockResolvedValue(planFixture());

      await service.renew("plan-1");

      expect(spy).toHaveBeenCalledWith(
        { endDate: new Date(Date.UTC(2027, 0, 1)), active: true, sessionsRemaining: 2 },
        expect.objectContaining({ active: true, sessionsRemaining: 10 })
      );
      spy.mockRestore();
    });
  });
});
