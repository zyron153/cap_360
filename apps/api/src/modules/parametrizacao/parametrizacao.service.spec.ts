import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ParametrizacaoService } from "./parametrizacao.service";
import { ParametrizacaoRepository } from "./parametrizacao.repository";

const repo = {
  listGroups: jest.fn(),
  listByNome: jest.fn(),
  listByNomeAdmin: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  findById: jest.fn(),
};

describe("ParametrizacaoService", () => {
  let service: ParametrizacaoService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [ParametrizacaoService, { provide: ParametrizacaoRepository, useValue: repo }],
    }).compile();
    service = mod.get(ParametrizacaoService);
    jest.clearAllMocks();
  });

  describe("reads", () => {
    it("listGroups delegates to the repo", async () => {
      repo.listGroups.mockResolvedValue([{ nome: "EXPENSE_CATEGORY", count: 3 }]);
      await expect(service.listGroups()).resolves.toEqual([{ nome: "EXPENSE_CATEGORY", count: 3 }]);
    });

    it("listByNome uses the active-only repo query", async () => {
      repo.listByNome.mockResolvedValue([]);
      await service.listByNome("EXPENSE_CATEGORY");
      expect(repo.listByNome).toHaveBeenCalledWith("EXPENSE_CATEGORY");
      expect(repo.listByNomeAdmin).not.toHaveBeenCalled();
    });

    it("listAdmin uses the include-inactive repo query", async () => {
      repo.listByNomeAdmin.mockResolvedValue([]);
      await service.listAdmin("EXPENSE_CATEGORY");
      expect(repo.listByNomeAdmin).toHaveBeenCalledWith("EXPENSE_CATEGORY");
      expect(repo.listByNome).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("delegates straight to the repo", async () => {
      const dto = { nome: "EXPENSE_CATEGORY", valor: "Renda" };
      repo.create.mockResolvedValue({ id: 1, ...dto });
      await expect(service.create(dto as never)).resolves.toEqual({ id: 1, ...dto });
      expect(repo.create).toHaveBeenCalledWith(dto);
    });
  });

  describe("update", () => {
    it("throws NotFoundException when the row is missing (or already soft-deleted)", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update(99, { valor: "x" } as never)).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("updates when the row exists", async () => {
      repo.findById.mockResolvedValue({ id: 1 });
      repo.update.mockResolvedValue({ id: 1, valor: "novo" });
      await service.update(1, { valor: "novo" } as never);
      expect(repo.update).toHaveBeenCalledWith(1, { valor: "novo" });
    });
  });

  describe("softDelete", () => {
    it("throws NotFoundException when the row is missing", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.softDelete(99)).rejects.toThrow(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("soft-deletes when the row exists", async () => {
      repo.findById.mockResolvedValue({ id: 1 });
      repo.softDelete.mockResolvedValue({ id: 1, deletedAt: new Date() });
      await service.softDelete(1);
      expect(repo.softDelete).toHaveBeenCalledWith(1);
    });
  });
});
