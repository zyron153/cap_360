import { Test } from "@nestjs/testing";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { Prisma } from "@cap/database";
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

    it("adds the +238 country code when given a bare 7-digit local number", async () => {
      // Previously this silently became "+9912345" — a broken number that would never
      // receive a WhatsApp reminder, since nothing checked for a missing country code.
      await service.create({ ...BASE_DTO, phone: "9912345" });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+2389912345" })
      );
    });

    it("rejects a number that's too short to be a Cabo Verde number", async () => {
      await expect(service.create({ ...BASE_DTO, phone: "12345" })).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("rejects a number with a non-Cabo-Verde country code instead of silently mangling it", async () => {
      await expect(service.create({ ...BASE_DTO, phone: "+351912345678" })).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
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

    it("translates a NIF unique-constraint race at the DB into a friendly ConflictException", async () => {
      // The findByNif pre-check above is a nice-error fast path, not a guarantee — two
      // concurrent creates for the same NIF can both pass it and race to the DB's unique
      // constraint on nifHash. Without this, the loser gets a raw, unhandled Prisma error (500).
      repo.findByPhone.mockResolvedValue(null);
      repo.findByNif.mockResolvedValue(null);
      repo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`nifHash`)", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["nifHash"] },
        })
      );

      await expect(service.create({ ...BASE_DTO, nif: "123456789" })).rejects.toThrow(ConflictException);
    });

    it("translates a phone unique-constraint race at the DB into a friendly ConflictException", async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`phone`)", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["phone"] },
        })
      );

      await expect(service.create(BASE_DTO)).rejects.toThrow(ConflictException);
    });

    it("re-throws an unrelated database error unchanged", async () => {
      repo.findByPhone.mockResolvedValue(null);
      const dbError = new Error("connection reset");
      repo.create.mockRejectedValue(dbError);

      await expect(service.create(BASE_DTO)).rejects.toBe(dbError);
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

  describe("update — unique-constraint race", () => {
    it("translates a NIF unique-constraint race at the DB into a friendly ConflictException", async () => {
      repo.findById.mockResolvedValue({ id: "p1", fullName: "Ana Costa" });
      repo.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`nifHash`)", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["nifHash"] },
        })
      );

      await expect(service.update("p1", { nif: "123456789" })).rejects.toThrow(ConflictException);
    });

    it("translates a phone unique-constraint race at the DB into a friendly ConflictException", async () => {
      repo.findById.mockResolvedValue({ id: "p1", fullName: "Ana Costa" });
      repo.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`phone`)", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["phone"] },
        })
      );

      await expect(service.update("p1", { phone: "9912345" })).rejects.toThrow(ConflictException);
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

  describe("findOrCreateByPhone — consent", () => {
    it("records the caller's real consentGiven value, not a hardcoded true", async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.findByNif.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "p1" });

      await service.findOrCreateByPhone({
        fullName: "Ana Costa",
        phone: "+2389912345",
        dateOfBirth: "1990-06-15",
        gender: "female",
        consentGiven: false,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ consentGiven: false, consentGivenAt: null })
      );
    });

    it("passes true through and timestamps it when the caller asserts real consent was captured", async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.findByNif.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "p1" });

      await service.findOrCreateByPhone({
        fullName: "Ana Costa",
        phone: "+2389912345",
        dateOfBirth: "1990-06-15",
        gender: "female",
        consentGiven: true,
      });

      const call = repo.create.mock.calls[0][0];
      expect(call.consentGiven).toBe(true);
      expect(call.consentGivenAt).toBeInstanceOf(Date);
    });

    it("does not create a second patient for an existing phone, regardless of consent passed", async () => {
      repo.findByPhone.mockResolvedValue({ id: "existing" });

      const result = await service.findOrCreateByPhone({
        fullName: "Ana Costa",
        phone: "+2389912345",
        dateOfBirth: "1990-06-15",
        gender: "female",
        consentGiven: false,
      });

      expect(result).toEqual({ id: "existing" });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
