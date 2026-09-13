import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { HealthPlansService } from "./health-plans.service";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";

const repo = {
  findAllPlans: jest.fn(),
  findPlanById: jest.fn(),
  incrementUsage: jest.fn(),
  findExpiringBetween: jest.fn(),
  findProductById: jest.fn(),
  nextPlanNumber: jest.fn(),
  createPlan: jest.fn(),
  updatePlan: jest.fn(),
  findActiveHealthPlanForPatient: jest.fn(),
  findPatientNamesByIds: jest.fn(),
};
const staffRepo = { findById: jest.fn() };

const ADMIN = { sub: "admin-1", email: "a@cap.cv", roles: ["admin"] };
const HR = { sub: "hr-1", email: "hr@cap.cv", roles: ["corporate_hr"] };

describe("HealthPlansService — company scoping for corporate_hr", () => {
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

  describe("findAllPlans", () => {
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
  });

  describe("findPlanById", () => {
    it("lets admin/receptionist fetch any plan", async () => {
      repo.findPlanById.mockResolvedValue({ id: "plan-1", companyId: "company-b" });
      await expect(service.findPlanById("plan-1", ADMIN)).resolves.toEqual({
        id: "plan-1",
        companyId: "company-b",
      });
    });

    it("lets a corporate_hr caller fetch a plan belonging to their own company", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: "company-a" });
      repo.findPlanById.mockResolvedValue({ id: "plan-1", companyId: "company-a" });

      await expect(service.findPlanById("plan-1", HR)).resolves.toEqual({
        id: "plan-1",
        companyId: "company-a",
      });
    });

    it("throws NotFoundException — not a bare 403 — when a corporate_hr caller requests another company's plan", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: "company-a" });
      repo.findPlanById.mockResolvedValue({ id: "plan-1", companyId: "company-b" });

      await expect(service.findPlanById("plan-1", HR)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException for a corporate_hr caller with no company assigned, even if the plan exists", async () => {
      staffRepo.findById.mockResolvedValue({ id: "hr-1", companyId: null });
      repo.findPlanById.mockResolvedValue({ id: "plan-1", companyId: "company-a" });

      await expect(service.findPlanById("plan-1", HR)).rejects.toThrow(NotFoundException);
    });

    it("still throws NotFoundException for a genuinely missing plan id", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.findPlanById("ghost", ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  describe("incrementUsage / findExpiringBetween", () => {
    it("delegates usage increments to the repository", async () => {
      repo.incrementUsage.mockResolvedValue({ id: "plan-1", usageCount: 4 });
      await service.incrementUsage("plan-1");
      expect(repo.incrementUsage).toHaveBeenCalledWith("plan-1");
    });

    it("delegates the expiring-plans window query to the repository", async () => {
      repo.findExpiringBetween.mockResolvedValue([]);
      const from = new Date("2026-09-01");
      const to = new Date("2026-09-30");
      await service.findExpiringBetween(from, to);
      expect(repo.findExpiringBetween).toHaveBeenCalledWith(from, to);
    });
  });

  describe("createPlan — server-side plan number generation", () => {
    it("uses a caller-supplied planNumber as-is, without generating one", async () => {
      repo.createPlan.mockResolvedValue({ id: "plan-1", planNumber: "CUSTOM-001" });
      await service.createPlan({
        productId: "prod-1", holderPatientId: "pat-1", planNumber: "CUSTOM-001", startDate: "2026-01-01",
      } as never);
      expect(repo.findProductById).not.toHaveBeenCalled();
      expect(repo.nextPlanNumber).not.toHaveBeenCalled();
      expect(repo.createPlan).toHaveBeenCalledWith(expect.objectContaining({ planNumber: "CUSTOM-001" }));
    });

    it("generates a race-safe plan number server-side when none is provided, keyed by the product's own code and the start year", async () => {
      repo.findProductById.mockResolvedValue({ id: "prod-1", code: "IMPAR-IND-001" });
      repo.nextPlanNumber.mockResolvedValue("IMPAR-IND-001-2026-004");
      repo.createPlan.mockResolvedValue({ id: "plan-1" });

      await service.createPlan({ productId: "prod-1", holderPatientId: "pat-1", startDate: "2026-01-01" } as never);

      expect(repo.nextPlanNumber).toHaveBeenCalledWith("IMPAR-IND-001", 2026);
      expect(repo.createPlan).toHaveBeenCalledWith(expect.objectContaining({ planNumber: "IMPAR-IND-001-2026-004" }));
    });

    it("throws NotFoundException when generating a number for a nonexistent product, without creating a plan", async () => {
      repo.findProductById.mockResolvedValue(null);
      await expect(
        service.createPlan({ productId: "ghost", holderPatientId: "pat-1", startDate: "2026-01-01" } as never)
      ).rejects.toThrow(NotFoundException);
      expect(repo.createPlan).not.toHaveBeenCalled();
    });
  });

  describe("getActiveCoverage", () => {
    const activePlan = (overrides: Record<string, unknown> = {}) => ({
      healthPlan: {
        id: "plan-1",
        active: true,
        endDate: null,
        product: {
          name: "Plano Familiar",
          active: true,
          coverageRules: { type: "familiar", coverage: 80 } as Record<string, unknown> | null,
        },
        ...overrides,
      },
    });

    it("returns null when the patient has no health plan at all", async () => {
      repo.findActiveHealthPlanForPatient.mockResolvedValue({ healthPlan: null });
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when the plan itself is inactive", async () => {
      repo.findActiveHealthPlanForPatient.mockResolvedValue(activePlan({ active: false }));
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when the plan's product is inactive", async () => {
      const plan = activePlan();
      plan.healthPlan.product = { ...plan.healthPlan.product, active: false };
      repo.findActiveHealthPlanForPatient.mockResolvedValue(plan);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when the plan has expired", async () => {
      repo.findActiveHealthPlanForPatient.mockResolvedValue(
        activePlan({ endDate: new Date("2020-01-01") })
      );
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when coverageRules has no coverage percentage set", async () => {
      const plan = activePlan();
      plan.healthPlan.product = { ...plan.healthPlan.product, coverageRules: { type: "familiar" } };
      repo.findActiveHealthPlanForPatient.mockResolvedValue(plan);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns null when coverage is explicitly 0", async () => {
      const plan = activePlan();
      plan.healthPlan.product = { ...plan.healthPlan.product, coverageRules: { coverage: 0 } };
      repo.findActiveHealthPlanForPatient.mockResolvedValue(plan);
      await expect(service.getActiveCoverage("patient-1")).resolves.toBeNull();
    });

    it("returns the coverage percentage, plan id, and product name for a valid active plan", async () => {
      repo.findActiveHealthPlanForPatient.mockResolvedValue(activePlan());
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual({
        healthPlanId: "plan-1",
        coveragePercent: 80,
        productName: "Plano Familiar",
      });
    });

    it("does not expire a plan with a future endDate", async () => {
      repo.findActiveHealthPlanForPatient.mockResolvedValue(
        activePlan({ endDate: new Date("2099-01-01") })
      );
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual(
        expect.objectContaining({ coveragePercent: 80 })
      );
    });

    it("caps coverage at 100% even if the stored value is higher", async () => {
      const plan = activePlan();
      plan.healthPlan.product = { ...plan.healthPlan.product, coverageRules: { coverage: 150 } };
      repo.findActiveHealthPlanForPatient.mockResolvedValue(plan);
      await expect(service.getActiveCoverage("patient-1")).resolves.toEqual(
        expect.objectContaining({ coveragePercent: 100 })
      );
    });
  });

  describe("holder-name enrichment (findAllPlans / findPlanById)", () => {
    it("attaches holderPatientName for plans that have a holder, in one batched lookup", async () => {
      repo.findAllPlans.mockResolvedValue([
        { id: "plan-1", holderPatientId: "pat-1", companyId: null },
        { id: "plan-2", holderPatientId: "pat-2", companyId: null },
        { id: "plan-3", holderPatientId: "pat-1", companyId: null }, // shares pat-1 — still one lookup
      ]);
      repo.findPatientNamesByIds.mockResolvedValue([
        { id: "pat-1", fullName: "Ana Silva" },
        { id: "pat-2", fullName: "Bruno Costa" },
      ]);

      const result = await service.findAllPlans(undefined, ADMIN);

      expect(repo.findPatientNamesByIds).toHaveBeenCalledTimes(1);
      expect(repo.findPatientNamesByIds).toHaveBeenCalledWith(["pat-1", "pat-2"]);
      expect(result).toEqual([
        { id: "plan-1", holderPatientId: "pat-1", companyId: null, holderPatientName: "Ana Silva" },
        { id: "plan-2", holderPatientId: "pat-2", companyId: null, holderPatientName: "Bruno Costa" },
        { id: "plan-3", holderPatientId: "pat-1", companyId: null, holderPatientName: "Ana Silva" },
      ]);
    });

    it("does not call the patient lookup at all for company-only plans with no holder", async () => {
      repo.findAllPlans.mockResolvedValue([{ id: "plan-1", holderPatientId: null, companyId: "co-1" }]);

      const result = await service.findAllPlans(undefined, ADMIN);

      expect(repo.findPatientNamesByIds).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: "plan-1", holderPatientId: null, companyId: "co-1" }]);
    });

    it("attaches holderPatientName on a single plan via findPlanById", async () => {
      repo.findPlanById.mockResolvedValue({ id: "plan-1", holderPatientId: "pat-1", companyId: null });
      repo.findPatientNamesByIds.mockResolvedValue([{ id: "pat-1", fullName: "Ana Silva" }]);

      await expect(service.findPlanById("plan-1", ADMIN)).resolves.toEqual({
        id: "plan-1",
        holderPatientId: "pat-1",
        companyId: null,
        holderPatientName: "Ana Silva",
      });
    });
  });

  describe("renew", () => {
    const planFixture = (overrides: Record<string, unknown> = {}) => ({
      id: "plan-1",
      endDate: null as Date | null,
      active: true,
      product: { name: "Plano Familiar", active: true, durationMonths: 1 },
      ...overrides,
    });

    it("throws NotFoundException for a nonexistent plan", async () => {
      repo.findPlanById.mockResolvedValue(null);
      await expect(service.renew("ghost")).rejects.toThrow(NotFoundException);
      expect(repo.updatePlan).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when the plan's product has been deactivated", async () => {
      repo.findPlanById.mockResolvedValue(planFixture({ product: { name: "Plano X", active: false, durationMonths: 1 } }));
      await expect(service.renew("plan-1")).rejects.toThrow(BadRequestException);
      expect(repo.updatePlan).not.toHaveBeenCalled();
    });

    it("extends from today (UTC) and reactivates a plan that already lapsed", async () => {
      repo.findPlanById.mockResolvedValue(
        planFixture({ endDate: new Date("2020-01-01"), active: false, product: { name: "P", active: true, durationMonths: 1 } })
      );
      repo.updatePlan.mockResolvedValue({ id: "plan-1" });

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
        planFixture({ endDate: new Date(Date.UTC(2027, 5, 15)), product: { name: "P", active: true, durationMonths: 12 } })
      );
      repo.updatePlan.mockResolvedValue({ id: "plan-1" });

      await service.renew("plan-1");

      const [, data] = repo.updatePlan.mock.calls[0];
      expect(data.endDate).toEqual(new Date(Date.UTC(2028, 5, 15)));
    });

    it("writes a before/after audit diff via RequestContext", async () => {
      const { RequestContext } = await import("../../common/context/request-context");
      const spy = jest.spyOn(RequestContext, "setAuditDiff");
      repo.findPlanById.mockResolvedValue(planFixture({ endDate: new Date(Date.UTC(2027, 0, 1)) }));
      repo.updatePlan.mockResolvedValue({ id: "plan-1" });

      await service.renew("plan-1");

      expect(spy).toHaveBeenCalledWith(
        { endDate: new Date(Date.UTC(2027, 0, 1)), active: true },
        expect.objectContaining({ active: true })
      );
      spy.mockRestore();
    });
  });
});
