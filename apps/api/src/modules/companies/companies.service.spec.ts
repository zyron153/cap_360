import { Test } from "@nestjs/testing";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { CompaniesService } from "./companies.service";
import { CompaniesRepository } from "./companies.repository";

const repo = {
  findAll: jest.fn(),
  findById: jest.fn(),
  exists: jest.fn(),
  findByTaxId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

describe("CompaniesService", () => {
  let service: CompaniesService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [CompaniesService, { provide: CompaniesRepository, useValue: repo }],
    }).compile();
    service = mod.get(CompaniesService);
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("defaults to active-only", async () => {
      repo.findAll.mockResolvedValue([]);
      await service.findAll();
      expect(repo.findAll).toHaveBeenCalledWith(true);
    });

    it("passes activeOnly=false through", async () => {
      repo.findAll.mockResolvedValue([]);
      await service.findAll(false);
      expect(repo.findAll).toHaveBeenCalledWith(false);
    });
  });

  describe("findById", () => {
    it("throws NotFoundException when missing", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById("nope")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("rejects a duplicate taxId", async () => {
      repo.findByTaxId.mockResolvedValue({ id: "c1" });
      await expect(service.create({ taxId: "CV-1" } as never)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("creates when the taxId is free", async () => {
      repo.findByTaxId.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "c2", taxId: "CV-2" });
      await expect(service.create({ taxId: "CV-2" } as never)).resolves.toEqual({ id: "c2", taxId: "CV-2" });
    });
  });

  describe("update", () => {
    it("throws NotFoundException for an unknown id (via findById guard)", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update("nope", {} as never)).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("deactivate", () => {
    it("throws NotFoundException when the company doesn't exist", async () => {
      repo.exists.mockResolvedValue(null);
      await expect(service.deactivate("nope")).rejects.toThrow(NotFoundException);
    });

    it("sets active: false via a lightweight existence check (not a full findById)", async () => {
      repo.exists.mockResolvedValue({ id: "c1" });
      repo.update.mockResolvedValue({ id: "c1", active: false });
      await service.deactivate("c1");
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith("c1", { active: false });
    });
  });
});
