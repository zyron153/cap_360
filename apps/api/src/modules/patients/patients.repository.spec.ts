import { Test } from "@nestjs/testing";
import { PatientsRepository } from "./patients.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);

const prisma = {
  patient: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe("PatientsRepository — NIF field encryption", () => {
  let repo: PatientsRepository;
  let encryption: EncryptionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PatientsRepository,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(PatientsRepository);
    encryption = mod.get(EncryptionService);
    jest.clearAllMocks();
  });

  it("encrypts the NIF and stores a blind-index hash on create, never the plaintext", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15", nif: "289959195" } as never);

    const call = prisma.patient.create.mock.calls[0][0].data;
    expect(call.nif).not.toBe("289959195");
    expect(call.nif.split(":")).toHaveLength(3); // ivHex:authTagHex:dataHex
    expect(call.nifHash).toBe(encryption.blindIndex("289959195"));
  });

  it("returns the decrypted NIF (not ciphertext) from create's result", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    const result = await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15", nif: "289959195" } as never);
    expect(result.nif).toBe("289959195");
  });

  it("never returns nifHash to callers — it's an internal lookup detail, brute-forceable given NIF's small keyspace", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    const result = await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15", nif: "289959195" } as never);
    expect(result).not.toHaveProperty("nifHash");
  });

  it("leaves nif/nifHash null when no NIF is given", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15" } as never);
    const call = prisma.patient.create.mock.calls[0][0].data;
    expect(call.nif).toBeFalsy();
    expect(call.nifHash).toBeFalsy();
  });

  it("looks up by the blind-index hash, not the raw NIF, and decrypts the result", async () => {
    const ciphertext = encryption.encrypt("289959195");
    prisma.patient.findFirst.mockResolvedValue({ id: "p1", nif: ciphertext });

    const found = await repo.findByNif("289959195");

    expect(prisma.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ nifHash: encryption.blindIndex("289959195") }) })
    );
    expect(found?.nif).toBe("289959195");
  });

  it("re-encrypts and re-hashes when NIF is changed via update", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.update("p1", { nif: "111222333" } as never);
    const call = prisma.patient.update.mock.calls[0][0].data;
    expect(call.nifHash).toBe(encryption.blindIndex("111222333"));
    expect(call.nif.split(":")).toHaveLength(3);
  });

  it("decrypts nif on findById when present", async () => {
    const ciphertext = encryption.encrypt("289959195");
    prisma.patient.findFirst.mockResolvedValue({ id: "p1", nif: ciphertext, deletedAt: null });
    const found = await repo.findById("p1");
    expect(found?.nif).toBe("289959195");
  });

  it("does not throw on a patient with no nif at all", async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: "p1", nif: null, deletedAt: null });
    const found = await repo.findById("p1");
    expect(found?.nif).toBeNull();
  });
});

describe("PatientsRepository — dateOfBirth field encryption", () => {
  let repo: PatientsRepository;
  let encryption: EncryptionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PatientsRepository,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(PatientsRepository);
    encryption = mod.get(EncryptionService);
    jest.clearAllMocks();
  });

  it("encrypts the dateOfBirth on create, never storing the plaintext", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15" } as never);

    const call = prisma.patient.create.mock.calls[0][0].data;
    expect(call.dateOfBirth).not.toBe("1990-01-15");
    expect(call.dateOfBirth.split(":")).toHaveLength(3); // ivHex:authTagHex:dataHex
  });

  it("returns the decrypted dateOfBirth (not ciphertext) from create's result", async () => {
    prisma.patient.create.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    const result = await repo.create({ fullName: "Ana Costa", dateOfBirth: "1990-01-15" } as never);
    expect(result.dateOfBirth).toBe("1990-01-15");
  });

  it("re-encrypts dateOfBirth when changed via update", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.update("p1", { dateOfBirth: "1985-06-20" } as never);
    const call = prisma.patient.update.mock.calls[0][0].data;
    expect(call.dateOfBirth).not.toBe("1985-06-20");
    expect(call.dateOfBirth.split(":")).toHaveLength(3);
  });

  it("leaves dateOfBirth out of the patch on update when not submitted", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    await repo.update("p1", { fullName: "Novo Nome" } as never);
    const call = prisma.patient.update.mock.calls[0][0].data;
    expect(call).not.toHaveProperty("dateOfBirth");
  });

  it("decrypts dateOfBirth on findById", async () => {
    const ciphertext = encryption.encrypt("1990-01-15");
    prisma.patient.findFirst.mockResolvedValue({ id: "p1", dateOfBirth: ciphertext, deletedAt: null });
    const found = await repo.findById("p1");
    expect(found?.dateOfBirth).toBe("1990-01-15");
  });

  it("decrypts dateOfBirth for every row returned by findMany", async () => {
    const ciphertext = encryption.encrypt("1990-01-15");
    prisma.patient.findMany.mockResolvedValue([{ id: "p1", dateOfBirth: ciphertext }]);
    const [found] = await repo.findMany({});
    expect(found.dateOfBirth).toBe("1990-01-15");
  });
});

describe("PatientsRepository — right to erasure (softDelete)", () => {
  let repo: PatientsRepository;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PatientsRepository,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(PatientsRepository);
    jest.clearAllMocks();
  });

  it("clears every direct-PII field alongside setting deletedAt", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));

    await repo.softDelete("p1");

    const call = prisma.patient.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1" });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(call.data).toMatchObject({
      fullName: null,
      dateOfBirth: null,
      nif: null,
      nifHash: null,
      phone: null,
      email: null,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("keeps gender and healthPlanId untouched — not direct PII, useful for anonymous reporting", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));

    await repo.softDelete("p1");

    const call = prisma.patient.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("gender");
    expect(call.data).not.toHaveProperty("healthPlanId");
  });

  it("never returns nifHash, consistent with every other repository method", async () => {
    prisma.patient.update.mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }));
    const result = await repo.softDelete("p1");
    expect(result).not.toHaveProperty("nifHash");
  });
});
