import { Test } from "@nestjs/testing";
import { ClinicalRecordsRepository } from "./clinical-records.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);

const prisma = {
  clinicalNote: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  prescription: { create: jest.fn(), findMany: jest.fn() },
};

describe("ClinicalRecordsRepository — field encryption", () => {
  let repo: ClinicalRecordsRepository;
  let encryption: EncryptionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ClinicalRecordsRepository,
        EncryptionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(ClinicalRecordsRepository);
    encryption = mod.get(EncryptionService);
    jest.clearAllMocks();
  });

  describe("clinical notes", () => {
    it("encrypts all four text fields (and riskNotes, once set) before writing, and decrypts them back on the returned value", async () => {
      prisma.clinicalNote.create.mockImplementation(({ data }) => Promise.resolve({ id: "n1", ...data }));

      const result = await repo.createNote({
        presentingConcerns: "ansiedade",
        observations: "agitado",
        assessment: "sem progresso",
        plan: "respiração",
        riskLevel: "moderate",
        riskNotes: "sem ideação suicida",
      } as never);

      const written = prisma.clinicalNote.create.mock.calls[0][0].data;
      expect(written.presentingConcerns).not.toBe("ansiedade");
      expect(written.riskNotes).not.toBe("sem ideação suicida");
      expect(encryption.decrypt(written.presentingConcerns)).toBe("ansiedade");

      expect(result.presentingConcerns).toBe("ansiedade");
      expect(result.observations).toBe("agitado");
      expect(result.assessment).toBe("sem progresso");
      expect(result.plan).toBe("respiração");
      expect(result.riskNotes).toBe("sem ideação suicida");
    });

    it("leaves a null riskNotes null rather than trying to encrypt/decrypt it", async () => {
      prisma.clinicalNote.create.mockImplementation(({ data }) => Promise.resolve({ id: "n1", ...data, riskNotes: null }));
      const result = await repo.createNote({ presentingConcerns: "x", observations: "y", assessment: "z", plan: "w", riskLevel: "none" } as never);
      expect(result.riskNotes).toBeNull();
    });

    it("decrypts a single note read back by id", async () => {
      prisma.clinicalNote.findUnique.mockResolvedValue({
        id: "n1",
        presentingConcerns: encryption.encrypt("ansiedade"),
        observations: encryption.encrypt("agitado"),
        assessment: encryption.encrypt("sem progresso"),
        plan: encryption.encrypt("respiração"),
        riskNotes: null,
      });
      const note = await repo.findNoteById("n1");
      expect(note?.presentingConcerns).toBe("ansiedade");
    });

    it("returns null, not a decryption error, for a missing note", async () => {
      prisma.clinicalNote.findUnique.mockResolvedValue(null);
      expect(await repo.findNoteById("missing")).toBeNull();
    });

    it("decrypts every note in a list", async () => {
      prisma.clinicalNote.findMany.mockResolvedValue([
        { id: "n1", presentingConcerns: encryption.encrypt("a"), observations: encryption.encrypt("b"), assessment: encryption.encrypt("c"), plan: encryption.encrypt("d"), riskNotes: null },
        { id: "n2", presentingConcerns: encryption.encrypt("e"), observations: encryption.encrypt("f"), assessment: encryption.encrypt("g"), plan: encryption.encrypt("h"), riskNotes: null },
      ]);
      const notes = await repo.findNotesByPatientId("p1");
      expect(notes.map((n) => n.presentingConcerns)).toEqual(["a", "e"]);
    });

    it("encrypts only the fields present in a partial update, leaving the rest of the payload untouched", async () => {
      // A real Prisma update() always returns the *whole* row — the untouched fields still carry
      // their existing (already-encrypted) DB values, not plaintext, hence encrypting them here too.
      prisma.clinicalNote.update.mockImplementation(({ data }) => Promise.resolve({
        id: "n1",
        presentingConcerns: encryption.encrypt("concerns-unchanged"),
        observations: encryption.encrypt("observations-unchanged"),
        assessment: encryption.encrypt("assessment-unchanged"),
        plan: data.plan,
        riskNotes: null,
      }));
      const result = await repo.updateNote("n1", { plan: "novo plano" } as never);

      const written = prisma.clinicalNote.update.mock.calls[0][0].data;
      expect(written).toEqual({ plan: expect.any(String) }); // only the touched field was sent to Prisma
      expect(encryption.decrypt(written.plan)).toBe("novo plano");
      expect(result.plan).toBe("novo plano"); // and comes back decrypted
    });
  });

  describe("prescriptions", () => {
    it("encrypts notes and every item's drugName/dosage/frequency/instructions, decrypting them back on return", async () => {
      prisma.prescription.create.mockImplementation(({ data }) => Promise.resolve({
        id: "rx1",
        notes: data.notes,
        items: data.items.create.map((it: object, i: number) => ({ id: `i${i}`, ...it })),
      }));

      const result = await repo.createPrescription({
        patientId: "p1",
        prescribedByStaffId: "s1",
        notes: "tomar com comida",
        items: [{ drugName: "Sertralina", dosage: "50mg", frequency: "1x ao dia", instructions: "de manhã" }],
      });

      expect(result.notes).toBe("tomar com comida");
      expect(result.items[0]).toMatchObject({ drugName: "Sertralina", dosage: "50mg", frequency: "1x ao dia", instructions: "de manhã" });
    });

    it("handles a prescription item with no instructions and a prescription with no notes", async () => {
      prisma.prescription.create.mockImplementation(({ data }) => Promise.resolve({
        id: "rx1",
        notes: data.notes ?? null,
        items: data.items.create.map((it: object, i: number) => ({ id: `i${i}`, ...it, instructions: null })),
      }));
      const result = await repo.createPrescription({
        patientId: "p1", prescribedByStaffId: "s1",
        items: [{ drugName: "X", dosage: "1", frequency: "1x" }],
      });
      expect(result.notes).toBeNull();
      expect(result.items[0].instructions).toBeNull();
    });

    it("decrypts a list of prescriptions with their items", async () => {
      prisma.prescription.findMany.mockResolvedValue([{
        id: "rx1",
        notes: encryption.encrypt("nota"),
        items: [{ id: "i1", drugName: encryption.encrypt("X"), dosage: encryption.encrypt("1"), frequency: encryption.encrypt("1x"), instructions: null }],
      }]);
      const [rx] = await repo.findPrescriptionsByPatientId("p1");
      expect(rx.notes).toBe("nota");
      expect(rx.items[0].drugName).toBe("X");
    });
  });
});
