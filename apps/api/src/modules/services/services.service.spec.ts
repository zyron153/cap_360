import { Test } from "@nestjs/testing";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { ServicesService } from "./services.service";
import { ServicesRepository } from "./services.repository";

const repo = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findAllAdmin: jest.fn(),
  findByIdAdmin: jest.fn(),
  findByCode: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

describe("ServicesService", () => {
  let service: ServicesService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [ServicesService, { provide: ServicesRepository, useValue: repo }],
    }).compile();
    service = mod.get(ServicesService);
    jest.clearAllMocks();
  });

  describe("findById", () => {
    it("returns the service when it exists", async () => {
      repo.findById.mockResolvedValue({ id: "s1", name: "Consulta" });
      await expect(service.findById("s1")).resolves.toEqual({ id: "s1", name: "Consulta" });
    });

    it("throws NotFoundException when it doesn't", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById("nope")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("rejects a duplicate code with ConflictException", async () => {
      repo.findByCode.mockResolvedValue({ id: "existing", code: "CONS" });
      await expect(service.create({ code: "CONS" } as never)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("creates when the code is free", async () => {
      repo.findByCode.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "s2", code: "NEW" });
      await expect(service.create({ code: "NEW" } as never)).resolves.toEqual({ id: "s2", code: "NEW" });
      expect(repo.create).toHaveBeenCalledWith({ code: "NEW" });
    });
  });

  describe("update", () => {
    it("throws NotFoundException for an unknown id", async () => {
      repo.findByIdAdmin.mockResolvedValue(null);
      await expect(service.update("nope", {} as never)).rejects.toThrow(NotFoundException);
    });

    it("rejects renaming to a code another service already uses", async () => {
      repo.findByIdAdmin.mockResolvedValue({ id: "s1", code: "OLD" });
      repo.findByCode.mockResolvedValue({ id: "s2", code: "TAKEN" });
      await expect(service.update("s1", { code: "TAKEN" } as never)).rejects.toThrow(ConflictException);
    });

    it("allows an update that keeps the same code (no dup check)", async () => {
      repo.findByIdAdmin.mockResolvedValue({ id: "s1", code: "SAME" });
      repo.update.mockResolvedValue({ id: "s1", code: "SAME", price: 5000 });
      await service.update("s1", { code: "SAME", price: 5000 } as never);
      expect(repo.findByCode).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith("s1", { code: "SAME", price: 5000 });
    });
  });

  describe("softDelete", () => {
    it("throws NotFoundException for an unknown id", async () => {
      repo.findByIdAdmin.mockResolvedValue(null);
      await expect(service.softDelete("nope")).rejects.toThrow(NotFoundException);
    });

    it("sets active: false", async () => {
      repo.findByIdAdmin.mockResolvedValue({ id: "s1" });
      repo.update.mockResolvedValue({ id: "s1", active: false });
      await service.softDelete("s1");
      expect(repo.update).toHaveBeenCalledWith("s1", { active: false });
    });
  });
});
