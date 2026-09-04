import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ClinicalRecordsRepository } from "./clinical-records.repository";

const repo = {
  createNote: jest.fn(),
  findNoteById: jest.fn(),
  findNotesByPatientId: jest.fn(),
  findAllNotes: jest.fn(),
  updateNote: jest.fn(),
  createPrescription: jest.fn(),
  findPrescriptionsByPatientId: jest.fn(),
  createReferral: jest.fn(),
  findReferralById: jest.fn(),
  findReferralsByPatientId: jest.fn(),
  updateReferralStatus: jest.fn(),
};

const ADMIN = { sub: "admin-1", email: "a@cap.cv", roles: ["admin"] };
const DR_SILVA = { sub: "dr-silva", email: "silva@cap.cv", roles: ["doctor"] };

const FIXED_NOW = new Date("2026-06-01T12:00:00Z");
function note(overrides: Partial<{ id: string; authorStaffId: string; createdAt: Date }> = {}) {
  return { id: "note-1", patientId: "p1", authorStaffId: "dr-silva", createdAt: FIXED_NOW, ...overrides };
}

describe("ClinicalRecordsService", () => {
  let service: ClinicalRecordsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [ClinicalRecordsService, { provide: ClinicalRecordsRepository, useValue: repo }],
    }).compile();
    service = mod.get(ClinicalRecordsService);
    jest.clearAllMocks();
  });

  describe("createNote", () => {
    it("stamps the caller as the author, never a client-supplied one", async () => {
      repo.createNote.mockResolvedValue(note());
      await service.createNote("p1", { sessionType: "individual", presentingConcerns: "x", observations: "y", assessment: "z", plan: "w", riskLevel: "none" } as never, DR_SILVA);

      const data = repo.createNote.mock.calls[0][0];
      expect(data.author).toEqual({ connect: { id: "dr-silva" } });
      expect(data.patient).toEqual({ connect: { id: "p1" } });
    });
  });

  describe("listNotesForPatient — authorship scoping", () => {
    it("gives admin every note for the patient, regardless of author", async () => {
      repo.findNotesByPatientId.mockResolvedValue([note({ authorStaffId: "dr-silva" }), note({ id: "n2", authorStaffId: "dr-costa" })]);
      const result = await service.listNotesForPatient("p1", ADMIN);
      expect(result).toHaveLength(2);
    });

    it("gives a clinician only the notes they themselves wrote for that patient", async () => {
      repo.findNotesByPatientId.mockResolvedValue([note({ authorStaffId: "dr-silva" }), note({ id: "n2", authorStaffId: "dr-costa" })]);
      const result = await service.listNotesForPatient("p1", DR_SILVA);
      expect(result).toEqual([note({ authorStaffId: "dr-silva" })]);
    });
  });

  describe("listAllNotes — the 'my recent notes' worklist", () => {
    it("scopes to the caller's own notes across every patient, unless admin", async () => {
      repo.findAllNotes.mockResolvedValue([note({ authorStaffId: "dr-silva" }), note({ id: "n2", authorStaffId: "dr-costa" })]);
      expect(await service.listAllNotes(DR_SILVA)).toEqual([note({ authorStaffId: "dr-silva" })]);
      expect(await service.listAllNotes(ADMIN)).toHaveLength(2);
    });
  });

  describe("getNoteById — authorship scoping", () => {
    it("404s (not 403) for a clinician requesting a colleague's note — doesn't reveal it exists", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-costa" }));
      await expect(service.getNoteById("note-1", DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("lets the author read their own note", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-silva" }));
      await expect(service.getNoteById("note-1", DR_SILVA)).resolves.toMatchObject({ authorStaffId: "dr-silva" });
    });

    it("lets admin read any note", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-costa" }));
      await expect(service.getNoteById("note-1", ADMIN)).resolves.toBeTruthy();
    });

    it("404s for a genuinely missing note", async () => {
      repo.findNoteById.mockResolvedValue(null);
      await expect(service.getNoteById("missing", ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateNote — 24h lock", () => {
    it("lets the author edit their own note within 24h", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-silva", createdAt: new Date(Date.now() - 60_000) }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("blocks the author from editing their own note once 24h have passed", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-silva", createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
      await expect(service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA)).rejects.toThrow(BadRequestException);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });

    it("lets admin edit a note regardless of age", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-silva", createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000) }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "updated" } as never, ADMIN);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("404s a colleague trying to edit someone else's note, lock window aside", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-costa", createdAt: new Date() }));
      await expect(service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });
  });

  describe("prescriptions — same authorship scoping as notes", () => {
    it("stamps the caller as prescriber", async () => {
      repo.createPrescription.mockResolvedValue({ id: "rx1" });
      await service.createPrescription("p1", { items: [{ drugName: "X", dosage: "1", frequency: "1x" }] } as never, DR_SILVA);
      expect(repo.createPrescription.mock.calls[0][0]).toMatchObject({ prescribedByStaffId: "dr-silva" });
    });

    it("filters a non-admin's list to their own prescriptions only", async () => {
      repo.findPrescriptionsByPatientId.mockResolvedValue([
        { id: "rx1", prescribedByStaffId: "dr-silva" },
        { id: "rx2", prescribedByStaffId: "dr-costa" },
      ]);
      const result = await service.listPrescriptionsForPatient("p1", DR_SILVA);
      expect(result).toEqual([{ id: "rx1", prescribedByStaffId: "dr-silva" }]);
    });
  });

  describe("referrals — referrer or target may see/act, not just authorship", () => {
    it("stamps the caller as referredBy", async () => {
      repo.createReferral.mockResolvedValue({ id: "ref1" });
      await service.createReferral("p1", { type: "external", externalProviderName: "Dr. X", reason: "needs psychiatry" } as never, DR_SILVA);
      expect(repo.createReferral.mock.calls[0][0].referredBy).toEqual({ connect: { id: "dr-silva" } });
    });

    it("shows a clinician both what they sent and what was sent to them", async () => {
      repo.findReferralsByPatientId.mockResolvedValue([
        { id: "r1", referredByStaffId: "dr-silva", targetStaffId: null },
        { id: "r2", referredByStaffId: "dr-costa", targetStaffId: "dr-silva" },
        { id: "r3", referredByStaffId: "dr-costa", targetStaffId: null },
      ]);
      const result = await service.listReferralsForPatient("p1", DR_SILVA);
      expect(result.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);
    });

    it("lets the target clinician update status; 404s an uninvolved one", async () => {
      repo.findReferralById.mockResolvedValue({ id: "r2", referredByStaffId: "dr-costa", targetStaffId: "dr-silva" });
      repo.updateReferralStatus.mockResolvedValue({ id: "r2", status: "scheduled" });
      await service.updateReferralStatus("r2", "scheduled", DR_SILVA);
      expect(repo.updateReferralStatus).toHaveBeenCalledWith("r2", "scheduled");

      jest.clearAllMocks();
      repo.findReferralById.mockResolvedValue({ id: "r3", referredByStaffId: "dr-costa", targetStaffId: null });
      await expect(service.updateReferralStatus("r3", "scheduled", DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.updateReferralStatus).not.toHaveBeenCalled();
    });
  });
});
