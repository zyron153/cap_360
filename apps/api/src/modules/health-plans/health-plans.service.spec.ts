import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { HealthPlansService } from "./health-plans.service";
import { HealthPlansRepository } from "./health-plans.repository";
import { StaffRepository } from "../staff/staff.repository";

const repo = {
  findAllPlans: jest.fn(),
  findPlanById: jest.fn(),
  incrementUsage: jest.fn(),
  findExpiringBetween: jest.fn(),
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
});
