import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { BffService } from "./bff.service";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);

const prisma = {
  patient: { findFirst: jest.fn() },
  appointment: { findMany: jest.fn().mockResolvedValue([]) },
  communicationLog: { findMany: jest.fn().mockResolvedValue([]) },
  invoice: { findMany: jest.fn().mockResolvedValue([]) },
};

describe("BffService — getPatientScreen", () => {
  let service: BffService;
  let encryption: EncryptionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        BffService,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(BffService);
    encryption = mod.get(EncryptionService);
    jest.clearAllMocks();
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.communicationLog.findMany.mockResolvedValue([]);
    prisma.invoice.findMany.mockResolvedValue([]);
  });

  it("decrypts dateOfBirth and nif before returning — this.prisma.patient.findFirst bypasses the repository's own decryption, unlike every other patient read path", async () => {
    prisma.patient.findFirst.mockResolvedValue({
      id: "p1",
      fullName: "Ana Costa",
      dateOfBirth: encryption.encrypt("1990-01-15"),
      nif: encryption.encrypt("289959195"),
      deletedAt: null,
    });

    const { patient } = await service.getPatientScreen("p1");

    expect(patient.dateOfBirth).toBe("1990-01-15");
    expect(patient.nif).toBe("289959195");
  });

  it("leaves a null dateOfBirth/nif (an erased patient) as null rather than trying to decrypt it", async () => {
    prisma.patient.findFirst.mockResolvedValue({
      id: "p1",
      fullName: null,
      dateOfBirth: null,
      nif: null,
      deletedAt: new Date(),
    });

    const { patient } = await service.getPatientScreen("p1");

    expect(patient.dateOfBirth).toBeNull();
    expect(patient.nif).toBeNull();
  });

  it("throws NotFoundException for a missing patient", async () => {
    prisma.patient.findFirst.mockResolvedValue(null);
    await expect(service.getPatientScreen("missing")).rejects.toThrow(NotFoundException);
  });
});
