import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { PatientsService } from "./patients.service";
import { PatientsRepository } from "./patients.repository";
import { RequestContext } from "../../common/context/request-context";

const repo = {
  findMany: jest.fn(),
  count: jest.fn(),
  findById: jest.fn(),
  findByPhone: jest.fn(),
  findByNif: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  createNote: jest.fn(),
  findTimelineEvents: jest.fn(),
};

const BASE_DTO = {
  fullName: "Ana Costa",
  dateOfBirth: "1990-06-15",
  gender: "female" as const,
  phone: "+238 991 23 45",
  consentGiven: true,
};

describe("PatientsService", () => {
  let service: PatientsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PatientsRepository, useValue: repo },
      ],
    }).compile();
    service = mod.get(PatientsService);
    jest.clearAllMocks();
  });

  describe("phone normalisation", () => {
    beforeEach(() => {
      repo.findByPhone.mockResolvedValue(null);
      repo.findByNif.mockResolvedValue(null);
      repo.create.mockResolvedValue({});
    });

    it("strips spaces and keeps digits, prepends +", async () => {
      await service.create({ ...BASE_DTO, phone: "+238 991 23 45" });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+2389912345" })
      );
    });

    it("strips dashes from formatted number", async () => {
      await service.create({ ...BASE_DTO, phone: "238-991-23-45" });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+2389912345" })
      );
    });

    it("handles already-normalised E.164 without double +", async () => {
      await service.create({ ...BASE_DTO, phone: "+2389912345" });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+2389912345" })
      );
    });
  });

  describe("NIF uniqueness check", () => {
    it("throws ConflictException when NIF already exists", async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.findByNif.mockResolvedValue({ id: "existing-id" });

      await expect(
        service.create({ ...BASE_DTO, nif: "123456789" })
      ).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("skips NIF check when NIF is not provided", async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.create.mockResolvedValue({});

      await service.create(BASE_DTO);
      expect(repo.findByNif).not.toHaveBeenCalled();
    });

    it("throws ConflictException when phone already exists", async () => {
      repo.findByPhone.mockResolvedValue({ id: "existing-id" });
      repo.findByNif.mockResolvedValue(null);

      await expect(service.create(BASE_DTO)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("update — audit diff", () => {
    it("records only the changed fields' before/after values, not the whole patient", async () => {
      repo.findById.mockResolvedValue({
        id: "p1", fullName: "Ana Costa", phone: "+2389912345", email: "old@cap.cv", nif: null,
      });
      repo.update.mockResolvedValue({
        id: "p1", fullName: "Ana Silva", phone: "+2389912345", email: "new@cap.cv", nif: null,
      });
      const diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);

      await service.update("p1", { fullName: "Ana Silva", email: "new@cap.cv" });

      expect(diffSpy).toHaveBeenCalledWith(
        { fullName: "Ana Costa", email: "old@cap.cv" },
        { fullName: "Ana Silva", email: "new@cap.cv" }
      );
      diffSpy.mockRestore();
    });

    it("does not set a diff for fields that weren't part of the update", async () => {
      repo.findById.mockResolvedValue({ id: "p1", fullName: "Ana Costa", phone: "+2389912345" });
      repo.update.mockResolvedValue({ id: "p1", fullName: "Ana Silva", phone: "+2389912345" });
      const diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);

      await service.update("p1", { fullName: "Ana Silva" });

      const [before, after] = diffSpy.mock.calls[0];
      expect(before).not.toHaveProperty("phone");
      expect(after).not.toHaveProperty("phone");
      diffSpy.mockRestore();
    });
  });

  describe("softDelete — audit diff", () => {
    it("records the deletedAt transition", async () => {
      repo.findById.mockResolvedValue({ id: "p1", deletedAt: null });
      repo.softDelete.mockResolvedValue({ id: "p1", deletedAt: new Date("2026-08-28T00:00:00Z") });
      const diffSpy = jest.spyOn(RequestContext, "setAuditDiff").mockImplementation(() => undefined);

      await service.softDelete("p1");

      expect(diffSpy).toHaveBeenCalledWith(
        { deletedAt: null },
        { deletedAt: new Date("2026-08-28T00:00:00Z") }
      );
      diffSpy.mockRestore();
    });
  });
});
