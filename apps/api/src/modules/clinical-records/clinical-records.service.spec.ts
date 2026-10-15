import { Test } from "@nestjs/testing";
import { NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { RequestContext } from "../../common/context/request-context";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ClinicalRecordsRepository } from "./clinical-records.repository";

const repo = {
  createNote: jest.fn(),
  findNoteById: jest.fn(),
  findNoteHeader: jest.fn(),
  deleteDraftNote: jest.fn(),
  findNotesByPatientId: jest.fn(),
  findAllNotes: jest.fn(),
  findAppointmentPatientId: jest.fn(),
  findNoteByAppointmentAndAuthor: jest.fn(),
  findPatientForWrite: jest.fn(),
  findStaffForReferral: jest.fn(),
  hasTreatmentToday: jest.fn(),
  updateNote: jest.fn(),
  createPrescription: jest.fn(),
  findPrescriptionsByPatientId: jest.fn(),
  createReferral: jest.fn(),
  findReferralById: jest.fn(),
  findReferralsByPatientId: jest.fn(),
  updateReferralStatus: jest.fn(),
  findCrossAuthorReads: jest.fn(),
  findStaffNames: jest.fn(),
  findNotePatientIds: jest.fn(),
  findPatientNames: jest.fn(),
};

const ADMIN = { sub: "admin-1", email: "a@cap.cv", roles: ["admin"] };
const DR_SILVA = { sub: "dr-silva", email: "silva@cap.cv", roles: ["doctor"] };

const FIXED_NOW = new Date("2026-06-01T12:00:00Z");
type NoteOverrides = Partial<{
  id: string; authorStaffId: string; createdAt: Date; finalizedAt: Date | null;
  presentingConcerns: string; observations: string; assessment: string; plan: string;
  riskLevel: string; riskNotes: string | null;
}>;
// A complete, finalized note unless overridden — so a merged update passes finalNoteIssues().
function note(overrides: NoteOverrides = {}) {
  return {
    id: "note-1", patientId: "p1", authorStaffId: "dr-silva", createdAt: FIXED_NOW, finalizedAt: FIXED_NOW,
    presentingConcerns: "c", observations: "o", assessment: "a", plan: "p", riskLevel: "none", riskNotes: null,
    ...overrides,
  };
}
const HOURS = 60 * 60 * 1000;

describe("ClinicalRecordsService", () => {
  let service: ClinicalRecordsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [ClinicalRecordsService, { provide: ClinicalRecordsRepository, useValue: repo }],
    }).compile();
    service = mod.get(ClinicalRecordsService);
    jest.clearAllMocks(); // clears calls, not implementations — so reset the ones a test may flip
    repo.hasTreatmentToday.mockResolvedValue(false);
    repo.findPatientForWrite.mockResolvedValue({ id: "p1" }); // a live patient, unless a test says otherwise
  });

  describe("createNote", () => {
    const FULL = { sessionType: "individual", presentingConcerns: "x", observations: "y", assessment: "z", plan: "w", riskLevel: "none" };

    it("stamps the caller as the author, never a client-supplied one", async () => {
      repo.createNote.mockResolvedValue(note());
      await service.createNote("p1", FULL as never, DR_SILVA);

      const data = repo.createNote.mock.calls[0][0];
      expect(data.author).toEqual({ connect: { id: "dr-silva" } });
      expect(data.patient).toEqual({ connect: { id: "p1" } });
    });

    it("saves a finished note as finalized, and a draft with no finalizedAt", async () => {
      repo.createNote.mockResolvedValue(note());
      await service.createNote("p1", FULL as never, DR_SILVA);
      await service.createNote("p1", { ...FULL, draft: true } as never, DR_SILVA);
      expect(repo.createNote.mock.calls[0][0].finalizedAt).toBeInstanceOf(Date);
      expect(repo.createNote.mock.calls[1][0].finalizedAt).toBeNull();
      expect(repo.createNote.mock.calls[1][0]).not.toHaveProperty("draft"); // never reaches Prisma
    });

    it("rejects linking an appointment that belongs to a different patient (or doesn't exist)", async () => {
      repo.findAppointmentPatientId.mockResolvedValue("someone-else");
      await expect(service.createNote("p1", { ...FULL, appointmentId: "a1" } as never, DR_SILVA)).rejects.toThrow(BadRequestException);
      repo.findAppointmentPatientId.mockResolvedValue(null);
      await expect(service.createNote("p1", { ...FULL, appointmentId: "a1" } as never, DR_SILVA)).rejects.toThrow(BadRequestException);
      expect(repo.createNote).not.toHaveBeenCalled();
    });

    it("connects the appointment when it belongs to the patient", async () => {
      repo.findAppointmentPatientId.mockResolvedValue("p1");
      repo.createNote.mockResolvedValue(note());
      await service.createNote("p1", { ...FULL, appointmentId: "a1" } as never, DR_SILVA);
      expect(repo.createNote.mock.calls[0][0].appointment).toEqual({ connect: { id: "a1" } });
    });

    it("404s a patient that doesn't exist or was erased, instead of letting the foreign key surface as a 500", async () => {
      repo.findPatientForWrite.mockResolvedValue(null);
      await expect(service.createNote("ghost", FULL as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.createNote).not.toHaveBeenCalled();
    });

    describe("risk detail", () => {
      const created = () => repo.createNote.mock.calls[0][0];
      beforeEach(() => repo.createNote.mockResolvedValue(note()));

      it("keeps riskNotes on a final note above 'none'", async () => {
        await service.createNote("p1", { ...FULL, riskLevel: "high", riskNotes: "ideacao" } as never, DR_SILVA);
        expect(created().riskNotes).toBe("ideacao");
      });

      it("drops stray riskNotes from a FINAL note at level 'none' — no risk text behind a 'no risk' badge", async () => {
        await service.createNote("p1", { ...FULL, riskLevel: "none", riskNotes: "left over" } as never, DR_SILVA);
        expect(created()).not.toHaveProperty("riskNotes");
      });

      it("keeps it on a DRAFT at level 'none' (the doctor may flip the level back), and stores whitespace-only as nothing", async () => {
        await service.createNote("p1", { ...FULL, riskLevel: "none", riskNotes: "typed so far", draft: true } as never, DR_SILVA);
        expect(created().riskNotes).toBe("typed so far");
        await service.createNote("p1", { ...FULL, riskLevel: "high", riskNotes: "   ", draft: true } as never, DR_SILVA);
        expect(repo.createNote.mock.calls[1][0]).not.toHaveProperty("riskNotes"); // not an empty string in the column
      });
    });
  });

  describe("createNote — one note per appointment per clinician", () => {
    const WITH_APPT = { sessionType: "individual", presentingConcerns: "x", observations: "y", assessment: "z", plan: "w", riskLevel: "none", appointmentId: "a1" };
    const openDraft = () => note({ finalizedAt: null, presentingConcerns: "tab 1's text", observations: "", assessment: "", plan: "" });
    const conflictBody = async (p: Promise<unknown>) => {
      const err = await p.then(() => { throw new Error("expected a rejection"); }, (e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      return (err as ConflictException).getResponse() as { code: string; note: unknown };
    };

    beforeEach(() => {
      repo.findAppointmentPatientId.mockResolvedValue("p1");
      repo.findNoteByAppointmentAndAuthor.mockResolvedValue(null);
    });

    it("409s with the existing draft instead of overwriting it (a second tab must not clobber the first)", async () => {
      repo.findNoteByAppointmentAndAuthor.mockResolvedValue(openDraft());

      const body = await conflictBody(service.createNote("p1", { ...WITH_APPT, plan: "tab 2's text", draft: true } as never, DR_SILVA));

      expect(body.code).toBe("NOTE_CHANGED");
      expect(body.note).toMatchObject({ id: "note-1", presentingConcerns: "tab 1's text" });
      expect(repo.createNote).not.toHaveBeenCalled();
      expect(repo.updateNote).not.toHaveBeenCalled(); // tab 1's text is untouched
    });

    it("409s with the existing note when it was already finalized", async () => {
      repo.findNoteByAppointmentAndAuthor.mockResolvedValue(note({ finalizedAt: new Date() }));
      const body = await conflictBody(service.createNote("p1", WITH_APPT as never, DR_SILVA));
      expect(body.note).toMatchObject({ id: "note-1" });
      expect(repo.createNote).not.toHaveBeenCalled();
    });

    it("scopes the lookup to the caller — a colleague's note on the same appointment doesn't block theirs", async () => {
      repo.createNote.mockResolvedValue(note());
      await service.createNote("p1", WITH_APPT as never, DR_SILVA);
      expect(repo.findNoteByAppointmentAndAuthor).toHaveBeenCalledWith("a1", "dr-silva");
      expect(repo.createNote).toHaveBeenCalled();
    });

    it("a request that loses the unique-index race gets the same 409 with the winner's note, not a 500", async () => {
      repo.createNote.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
      // the fast path sees nothing; by the time the loser re-reads, the winner's draft exists
      repo.findNoteByAppointmentAndAuthor.mockResolvedValueOnce(null).mockResolvedValueOnce(openDraft());

      const body = await conflictBody(service.createNote("p1", { ...WITH_APPT, draft: true } as never, DR_SILVA));
      expect(body.note).toMatchObject({ id: "note-1" });
    });

    it("rethrows any other create failure unchanged", async () => {
      repo.createNote.mockRejectedValue(new Error("db down"));
      await expect(service.createNote("p1", WITH_APPT as never, DR_SILVA)).rejects.toThrow("db down");
    });

    it("doesn't look anything up for an ad-hoc note with no appointment", async () => {
      repo.createNote.mockResolvedValue(note());
      const { appointmentId: _omit, ...adHoc } = WITH_APPT;
      await service.createNote("p1", adHoc as never, DR_SILVA);
      expect(repo.findNoteByAppointmentAndAuthor).not.toHaveBeenCalled();
    });
  });

  describe("updateNote — lost-update guard (expectedUpdatedAt)", () => {
    const SEEN = "2026-10-05T10:00:00.000Z";

    it("passes the version the caller saw to the repository as a compare-and-set, and never as a column", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date() }));
      repo.updateNote.mockResolvedValue(note());

      await service.updateNote("note-1", { plan: "new", expectedUpdatedAt: SEEN } as never, DR_SILVA);

      const [, data, expected] = repo.updateNote.mock.calls[0];
      expect(data).toEqual({ plan: "new" });
      expect(expected).toEqual(new Date(SEEN));
    });

    it("409s with the current note when someone saved since (the repository reports no row written)", async () => {
      const current = note({ finalizedAt: new Date(), plan: "the other tab's plan" });
      repo.findNoteById.mockResolvedValue(current);
      repo.updateNote.mockResolvedValue(null);

      const err = await service.updateNote("note-1", { plan: "mine", expectedUpdatedAt: SEEN } as never, DR_SILVA).then(() => null, (e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: "NOTE_CHANGED", note: { plan: "the other tab's plan" } });
    });

    it("a draft discarded meanwhile is a 404, not a 409 with no note to show (version given: nothing written, nothing left to read)", async () => {
      repo.findNoteById.mockResolvedValueOnce(note({ finalizedAt: null })).mockResolvedValueOnce(null);
      repo.updateNote.mockResolvedValue(null);
      await expect(service.updateNote("note-1", { plan: "late", draft: true, expectedUpdatedAt: SEEN } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("…and so is an unconditional save whose row vanished (Prisma P2025), instead of a 500; other failures pass through", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: null }));
      repo.updateNote.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("gone", { code: "P2025", clientVersion: "test" }));
      await expect(service.updateNote("note-1", { plan: "late", draft: true } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      repo.updateNote.mockRejectedValueOnce(new Error("db down"));
      await expect(service.updateNote("note-1", { plan: "late", draft: true } as never, DR_SILVA)).rejects.toThrow("db down");
    });

    it("without a version the write is unconditional (scripts, older callers)", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date() }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "new" } as never, DR_SILVA);
      expect(repo.updateNote.mock.calls[0][2]).toBeUndefined();
    });
  });

  describe("reading other clinicians' notes while the patient is in treatment today", () => {
    const mine = note({ id: "mine", authorStaffId: "dr-silva", finalizedAt: new Date() });
    const mineDraft = note({ id: "mine-draft", authorStaffId: "dr-silva", finalizedAt: null });
    const theirs = note({ id: "theirs", authorStaffId: "dr-costa", finalizedAt: new Date() });
    const theirDraft = note({ id: "their-draft", authorStaffId: "dr-costa", finalizedAt: null });
    let audit: jest.SpyInstance;

    beforeEach(() => { audit = jest.spyOn(RequestContext, "setAuditDiff"); });
    afterEach(() => audit.mockRestore());

    it("asks the query for the colleague's FINALIZED notes too (the query never returns drafts of others) when the patient is in treatment today", async () => {
      repo.findNotesByPatientId.mockResolvedValue([mine, mineDraft, theirs]);
      repo.hasTreatmentToday.mockResolvedValue(true);

      const ids = (await service.listNotesForPatient("p1", DR_SILVA)).map((n: { id: string }) => n.id);

      expect(ids).toEqual(["mine", "mine-draft", "theirs"]);
      expect(repo.hasTreatmentToday).toHaveBeenCalledWith("p1", "dr-silva"); // asked on behalf of the reader
      expect(repo.findNotesByPatientId).toHaveBeenCalledWith("p1", { scope: { readerId: "dr-silva", includeOthersFinalized: true } });
    });

    it("scopes the query to the clinician's own notes when the patient isn't in treatment today", async () => {
      repo.findNotesByPatientId.mockResolvedValue([mine]);
      repo.hasTreatmentToday.mockResolvedValue(false);
      expect((await service.listNotesForPatient("p1", DR_SILVA)).map((n: { id: string }) => n.id)).toEqual(["mine"]);
      expect(repo.findNotesByPatientId).toHaveBeenCalledWith("p1", { scope: { readerId: "dr-silva", includeOthersFinalized: false } });
    });

    it("passes the page through with the scope", async () => {
      repo.findNotesByPatientId.mockResolvedValue([]);
      await service.listNotesForPatient("p1", DR_SILVA, { page: 2, limit: 25 });
      expect(repo.findNotesByPatientId).toHaveBeenCalledWith("p1", { page: 2, limit: 25, scope: { readerId: "dr-silva", includeOthersFinalized: false } });
    });

    it("marks the audit entry with how many other-author notes came back — and not at all when none did", async () => {
      repo.findNotesByPatientId.mockResolvedValue([mine, theirs]);
      repo.hasTreatmentToday.mockResolvedValue(true);
      await service.listNotesForPatient("p1", DR_SILVA);
      expect(audit).toHaveBeenCalledWith(undefined, expect.objectContaining({ basis: "patient in treatment today", otherAuthorsNotes: 1 }));

      audit.mockClear();
      repo.findNotesByPatientId.mockResolvedValue([mine]); // in treatment, but the colleague has nothing finalized
      await service.listNotesForPatient("p1", DR_SILVA);
      expect(audit).not.toHaveBeenCalled();
    });

    it("lets a clinician READ a colleague's finalized note by id in treatment, and audits it", async () => {
      repo.findNoteById.mockResolvedValue(theirs);
      repo.hasTreatmentToday.mockResolvedValue(true);
      await expect(service.getNoteById("theirs", DR_SILVA)).resolves.toMatchObject({ id: "theirs" });
      expect(audit).toHaveBeenCalledWith(undefined, expect.objectContaining({ noteAuthor: "dr-costa" }));
    });

    it("still 404s a colleague's DRAFT by id, treatment or not", async () => {
      repo.findNoteById.mockResolvedValue(theirDraft);
      repo.hasTreatmentToday.mockResolvedValue(true);
      await expect(service.getNoteById("their-draft", DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("still 404s a colleague's finalized note when the patient isn't in treatment today", async () => {
      repo.findNoteById.mockResolvedValue(theirs);
      repo.hasTreatmentToday.mockResolvedValue(false);
      await expect(service.getNoteById("theirs", DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("never lets that read access turn into WRITE access — updating a colleague's note is still a 404", async () => {
      repo.findNoteById.mockResolvedValue(theirs);
      repo.hasTreatmentToday.mockResolvedValue(true);
      await expect(service.updateNote("theirs", { plan: "hijack" } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });

    it("doesn't involve admin at all (admin already reads everything)", async () => {
      repo.findNotesByPatientId.mockResolvedValue([mine, theirs, theirDraft]);
      expect(await service.listNotesForPatient("p1", ADMIN)).toHaveLength(3);
      repo.findNoteById.mockResolvedValue(theirs);
      await service.getNoteById("theirs", ADMIN);
      expect(repo.hasTreatmentToday).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });
  });

  describe("listNotesForPatient — authorship scoping", () => {
    it("gives admin every note for the patient, regardless of author — no scope in the query", async () => {
      repo.findNotesByPatientId.mockResolvedValue([note({ authorStaffId: "dr-silva" }), note({ id: "n2", authorStaffId: "dr-costa" })]);
      const result = await service.listNotesForPatient("p1", ADMIN, { page: 2, limit: 10 });
      expect(result).toHaveLength(2);
      expect(repo.findNotesByPatientId).toHaveBeenCalledWith("p1", { page: 2, limit: 10 }); // no scope
    });

    it("gives a clinician only the notes they themselves wrote — scoped in the query, so a page is a page of THEIR notes", async () => {
      repo.findNotesByPatientId.mockResolvedValue([note({ authorStaffId: "dr-silva" })]);
      const result = await service.listNotesForPatient("p1", DR_SILVA);
      expect(result).toEqual([note({ authorStaffId: "dr-silva" })]);
      expect(repo.findNotesByPatientId.mock.calls[0][1].scope).toEqual({ readerId: "dr-silva", includeOthersFinalized: false });
    });
  });

  describe("deleteNote — discarding a draft", () => {
    const header = (o: Partial<{ authorStaffId: string; finalizedAt: Date | null }> = {}) => ({
      id: "note-1", patientId: "p1", appointmentId: "a1", authorStaffId: "dr-silva", finalizedAt: null, createdAt: FIXED_NOW, ...o,
    });
    const conflict = async (p: Promise<unknown>) => {
      const err = await p.then(() => { throw new Error("expected a rejection"); }, (e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      return (err as ConflictException).getResponse() as { code: string; message: string };
    };
    let audit: jest.SpyInstance;
    beforeEach(() => { audit = jest.spyOn(RequestContext, "setAuditDiff"); });
    afterEach(() => audit.mockRestore());

    it("lets the author discard their draft, and records whose it was (never its text) on the audit row", async () => {
      repo.findNoteHeader.mockResolvedValue(header());
      repo.deleteDraftNote.mockResolvedValue("deleted");

      await expect(service.deleteNote("note-1", DR_SILVA)).resolves.toBeUndefined();

      expect(repo.deleteDraftNote).toHaveBeenCalledWith("note-1");
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ patientId: "p1", authorStaffId: "dr-silva", appointmentId: "a1" }), null);
      expect(JSON.stringify(audit.mock.calls[0])).not.toMatch(/plan|assessment|presentingConcerns/);
    });

    it("lets admin discard anyone's draft", async () => {
      repo.findNoteHeader.mockResolvedValue(header({ authorStaffId: "dr-costa" }));
      repo.deleteDraftNote.mockResolvedValue("deleted");
      await expect(service.deleteNote("note-1", ADMIN)).resolves.toBeUndefined();
    });

    it("404s a colleague's draft — same as 'doesn't exist', and nothing is deleted", async () => {
      repo.findNoteHeader.mockResolvedValue(header({ authorStaffId: "dr-costa" }));
      await expect(service.deleteNote("note-1", DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.deleteDraftNote).not.toHaveBeenCalled();
    });

    it("404s a note that doesn't exist", async () => {
      repo.findNoteHeader.mockResolvedValue(null);
      await expect(service.deleteNote("nope", DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("the not-yours 404 comes BEFORE the finalized 409, so a colleague's finalized note can't be told apart from a missing one", async () => {
      repo.findNoteHeader.mockResolvedValue(header({ authorStaffId: "dr-costa", finalizedAt: new Date() }));
      await expect(service.deleteNote("note-1", DR_SILVA)).rejects.toThrow(NotFoundException);
    });

    it("refuses a FINALIZED note with 409 NOTE_FINALIZED — for its author and for admin alike", async () => {
      repo.findNoteHeader.mockResolvedValue(header({ finalizedAt: new Date() }));
      for (const user of [DR_SILVA, ADMIN]) {
        const body = await conflict(service.deleteNote("note-1", user));
        expect(body.code).toBe("NOTE_FINALIZED");
        expect(body.message).toMatch(/clinical record/);
      }
      expect(repo.deleteDraftNote).not.toHaveBeenCalled();
    });

    it("answers 409 NOTE_HAS_LINKED_RECORDS when a prescription or referral refers to the draft — never a 500", async () => {
      repo.findNoteHeader.mockResolvedValue(header());
      repo.deleteDraftNote.mockResolvedValue("linked");
      const body = await conflict(service.deleteNote("note-1", DR_SILVA));
      expect(body.code).toBe("NOTE_HAS_LINKED_RECORDS");
      expect(body.message).toMatch(/linked records/);
      expect(audit).not.toHaveBeenCalled(); // nothing was deleted, nothing to record
    });

    it("reports what a concurrent tab did meanwhile: finalized → 409, already deleted → 404", async () => {
      repo.findNoteHeader.mockResolvedValue(header());
      repo.deleteDraftNote.mockResolvedValueOnce("finalized");
      expect((await conflict(service.deleteNote("note-1", DR_SILVA))).code).toBe("NOTE_FINALIZED");
      repo.deleteDraftNote.mockResolvedValueOnce("not_found");
      await expect(service.deleteNote("note-1", DR_SILVA)).rejects.toThrow(NotFoundException);
    });
  });

  describe("listCrossAuthorReads — the admin's report", () => {
    const at = new Date("2026-10-05T14:00:00.000Z");
    const mark = (o: object) => ({ url: "/v1/x", diff: { after: { basis: "patient in treatment today", ...o } } });
    const listRead = { id: "log-1", createdAt: at, actorId: "dr-b", actorEmail: "b@cap.cv", resourceId: "p1", metadata: mark({ otherAuthorsNotes: 2 }) };
    const noteRead = { id: "log-2", createdAt: new Date(at.getTime() - 1000), actorId: "dr-b", actorEmail: "b@cap.cv", resourceId: "note-9", metadata: mark({ noteAuthor: "dr-a" }) };

    beforeEach(() => {
      repo.findStaffNames.mockResolvedValue(new Map([["dr-b", "Dr. B"]]));
      repo.findNotePatientIds.mockResolvedValue(new Map([["note-9", "p2"]]));
      repo.findPatientNames.mockResolvedValue(new Map<string, string | null>([["p1", "Maria"], ["p2", null]]));
    });

    it("shapes a list read and a by-id read, resolving the reader, the patient (via the note for a by-id read) and the author", async () => {
      repo.findCrossAuthorReads.mockResolvedValue([listRead, noteRead]);

      const entries = await service.listCrossAuthorReads({ page: 1, limit: 50 });

      expect(entries).toEqual([
        {
          id: "log-1", at: "2026-10-05T14:00:00.000Z",
          reader: { id: "dr-b", email: "b@cap.cv", fullName: "Dr. B" },
          patient: { id: "p1", fullName: "Maria" },
          basis: "patient in treatment today", otherAuthorsNotes: 2, note: null,
        },
        {
          id: "log-2", at: "2026-10-05T13:59:59.000Z",
          reader: { id: "dr-b", email: "b@cap.cv", fullName: "Dr. B" },
          patient: { id: "p2", fullName: null }, // an erased patient has no name
          basis: "patient in treatment today", otherAuthorsNotes: null, note: { id: "note-9", authorStaffId: "dr-a" },
        },
      ]);
      expect(repo.findCrossAuthorReads).toHaveBeenCalledWith({ page: 1, limit: 50 });
      // names are fetched in ONE batch each, not once per row
      expect(repo.findStaffNames).toHaveBeenCalledTimes(1);
      expect(repo.findStaffNames).toHaveBeenCalledWith(["dr-b"]);
      expect(repo.findNotePatientIds).toHaveBeenCalledWith(["note-9"]);
      expect(repo.findPatientNames).toHaveBeenCalledWith(["p1", "p2"]);
    });

    it("a reader whose staff row is gone → fullName null; a patient row that is gone → named null but still identified; a note that is gone → no patient", async () => {
      repo.findStaffNames.mockResolvedValue(new Map());
      repo.findNotePatientIds.mockResolvedValue(new Map()); // note-9 no longer exists
      repo.findPatientNames.mockResolvedValue(new Map()); // p1 no longer exists either
      repo.findCrossAuthorReads.mockResolvedValue([listRead, noteRead]);

      const [list, byId] = await service.listCrossAuthorReads();

      expect(list.reader).toEqual({ id: "dr-b", email: "b@cap.cv", fullName: null });
      expect(list.patient).toEqual({ id: "p1", fullName: null });
      expect(byId.patient).toBeNull();
      expect(byId.note).toEqual({ id: "note-9", authorStaffId: "dr-a" });
    });

    it("copes with an audit row that has no actor (null reader) and with a malformed mark", async () => {
      repo.findCrossAuthorReads.mockResolvedValue([{ ...listRead, actorId: null, actorEmail: null, metadata: { diff: { after: { basis: 42, otherAuthorsNotes: "x" } } } }]);
      const [e] = await service.listCrossAuthorReads();
      expect(e.reader).toEqual({ id: null, email: null, fullName: null });
      expect(e.basis).toBe("patient in treatment today"); // falls back rather than leaking a non-string
      expect(e.otherAuthorsNotes).toBeNull();
    });

    it("returns [] without any name lookups when there is nothing to report", async () => {
      repo.findCrossAuthorReads.mockResolvedValue([]);
      expect(await service.listCrossAuthorReads()).toEqual([]);
      expect(repo.findStaffNames).not.toHaveBeenCalled();
      expect(repo.findPatientNames).not.toHaveBeenCalled();
    });
  });

  describe("listAllNotes — the doctor's history", () => {
    it("pushes the authorship scope into the query for a doctor, so other doctors' notes can't crowd it out", async () => {
      repo.findAllNotes.mockResolvedValue([]);
      await service.listAllNotes(DR_SILVA, { q: "maria", riskLevel: "high" });
      expect(repo.findAllNotes).toHaveBeenCalledWith({ q: "maria", riskLevel: "high", authorStaffId: "dr-silva" });
    });

    it("passes page and limit through to the repository", async () => {
      repo.findAllNotes.mockResolvedValue([]);
      await service.listAllNotes(DR_SILVA, { page: 3, limit: 50 });
      expect(repo.findAllNotes).toHaveBeenCalledWith({ page: 3, limit: 50, authorStaffId: "dr-silva" });
    });

    it("leaves admin unscoped", async () => {
      repo.findAllNotes.mockResolvedValue([]);
      await service.listAllNotes(ADMIN, { status: "draft" });
      expect(repo.findAllNotes).toHaveBeenCalledWith({ status: "draft" });
    });

    it("can't be widened by a client-supplied authorStaffId", async () => {
      repo.findAllNotes.mockResolvedValue([]);
      await service.listAllNotes(DR_SILVA, { authorStaffId: "dr-costa" } as never);
      expect(repo.findAllNotes.mock.calls[0][0].authorStaffId).toBe("dr-silva");
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

  describe("updateNote — 24h lock, counted from finalization", () => {
    it("lets the author edit their own note within 24h", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(Date.now() - 60_000) }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("blocks the author from editing their own note once 24h have passed", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(Date.now() - 25 * HOURS) }));
      await expect(service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA)).rejects.toThrow(BadRequestException);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });

    it("counts the lock from finalization, not creation — a draft started days ago and finalized now is editable", async () => {
      repo.findNoteById.mockResolvedValue(note({ createdAt: new Date(Date.now() - 100 * HOURS), finalizedAt: new Date(Date.now() - 60_000) }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("lets admin edit a note regardless of age", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(Date.now() - 100 * HOURS) }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "updated" } as never, ADMIN);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("404s a colleague trying to edit someone else's note, lock window aside", async () => {
      repo.findNoteById.mockResolvedValue(note({ authorStaffId: "dr-costa" }));
      await expect(service.updateNote("note-1", { plan: "updated" } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });
  });

  describe("updateNote — drafts", () => {
    const draft = (o: NoteOverrides = {}) => note({ finalizedAt: null, createdAt: new Date(Date.now() - 100 * HOURS), presentingConcerns: "", observations: "", assessment: "", plan: "", ...o });

    it("keeps autosaving a half-written draft — no required-field check, no lock, however old", async () => {
      repo.findNoteById.mockResolvedValue(draft());
      repo.updateNote.mockResolvedValue(draft());
      await service.updateNote("note-1", { presentingConcerns: "so isto por agora", draft: true } as never, DR_SILVA);
      const [, data] = repo.updateNote.mock.calls[0];
      expect(data).toEqual({ presentingConcerns: "so isto por agora" }); // still a draft: no finalizedAt, no `draft` key
    });

    it("refuses to finalize a draft while a required section is still empty", async () => {
      repo.findNoteById.mockResolvedValue(draft({ presentingConcerns: "x", observations: "y", assessment: "z" }));
      await expect(service.updateNote("note-1", { draft: false } as never, DR_SILVA)).rejects.toThrow(/plan/);
      expect(repo.updateNote).not.toHaveBeenCalled();
    });

    it("finalizes a draft once the update completes it, stamping finalizedAt", async () => {
      repo.findNoteById.mockResolvedValue(draft({ presentingConcerns: "x", observations: "y", assessment: "z" }));
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "w", draft: false } as never, DR_SILVA);
      const [, data] = repo.updateNote.mock.calls[0];
      expect(data.plan).toBe("w");
      expect(data.finalizedAt).toBeInstanceOf(Date);
    });

    it("won't send a finalized note back to draft", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date() }));
      await expect(service.updateNote("note-1", { draft: true } as never, DR_SILVA)).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateNote — a finalized note must stay complete", () => {
    beforeEach(() => repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date() })));

    it("rejects blanking a required section", async () => {
      await expect(service.updateNote("note-1", { assessment: "  " } as never, DR_SILVA)).rejects.toThrow(/assessment/);
    });

    it("rejects raising the risk level without detail", async () => {
      await expect(service.updateNote("note-1", { riskLevel: "high" } as never, DR_SILVA)).rejects.toThrow(/riskNotes/);
    });

    it("accepts raising the risk level together with its detail", async () => {
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { riskLevel: "high", riskNotes: "ideacao" } as never, DR_SILVA);
      expect(repo.updateNote).toHaveBeenCalled();
    });

    it("ignores an attempt to re-point the note at another appointment", async () => {
      repo.updateNote.mockResolvedValue(note());
      await service.updateNote("note-1", { plan: "x", appointmentId: "other" } as never, DR_SILVA);
      expect(repo.updateNote.mock.calls[0][1]).toEqual({ plan: "x" });
    });
  });

  describe("updateNote — risk detail never goes stale", () => {
    const written = () => repo.updateNote.mock.calls[0][1];
    beforeEach(() => repo.updateNote.mockResolvedValue(note()));

    it("lowering a finalized note to 'none' clears its stored risk detail (it used to stay behind a 'no risk' badge)", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(), riskLevel: "high", riskNotes: "ideacao" }));
      await service.updateNote("note-1", { riskLevel: "none" } as never, DR_SILVA);
      expect(written()).toEqual({ riskLevel: "none", riskNotes: null });
    });

    it("…even when the caller also re-sends the text (the editor sends '' at level none; the API must not depend on that)", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(), riskLevel: "high", riskNotes: "ideacao" }));
      await service.updateNote("note-1", { riskLevel: "none", riskNotes: "still here" } as never, DR_SILVA);
      expect(written().riskNotes).toBeNull();
    });

    it("also cleans a leftover from before this rule: any save of a final 'none' note with stale detail clears it", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(), riskLevel: "none", riskNotes: "stale" }));
      await service.updateNote("note-1", { plan: "x" } as never, DR_SILVA);
      expect(written()).toEqual({ plan: "x", riskNotes: null });
    });

    it("a plain edit of a clean 'none' note doesn't touch riskNotes at all", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: new Date(), riskLevel: "none", riskNotes: null }));
      await service.updateNote("note-1", { plan: "x" } as never, DR_SILVA);
      expect(written()).toEqual({ plan: "x" });
    });

    it("a DRAFT keeps its detail when the level is lowered (the doctor may raise it again), but finalizing it at 'none' clears it", async () => {
      const draft = note({ finalizedAt: null, riskLevel: "high", riskNotes: "ideacao" });
      repo.findNoteById.mockResolvedValue(draft);
      await service.updateNote("note-1", { riskLevel: "none", draft: true } as never, DR_SILVA);
      expect(written()).toEqual({ riskLevel: "none" }); // untouched

      jest.clearAllMocks();
      repo.updateNote.mockResolvedValue(note());
      repo.findNoteById.mockResolvedValue(draft);
      await service.updateNote("note-1", { riskLevel: "none", draft: false } as never, DR_SILVA);
      expect(written().riskNotes).toBeNull();
      expect(written().finalizedAt).toBeInstanceOf(Date);
    });

    it("stores a blank riskNotes as null, not as an empty string", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: null, riskLevel: "high", riskNotes: "was something" }));
      await service.updateNote("note-1", { riskNotes: "   ", draft: true } as never, DR_SILVA);
      expect(written()).toEqual({ riskNotes: null });
    });

    it("still refuses to finalize above 'none' without detail", async () => {
      repo.findNoteById.mockResolvedValue(note({ finalizedAt: null, riskLevel: "moderate", riskNotes: null }));
      await expect(service.updateNote("note-1", { draft: false } as never, DR_SILVA)).rejects.toThrow(/riskNotes/);
    });
  });

  describe("prescriptions — same authorship scoping as notes", () => {
    it("stamps the caller as prescriber", async () => {
      repo.createPrescription.mockResolvedValue({ id: "rx1" });
      await service.createPrescription("p1", { items: [{ drugName: "X", dosage: "1", frequency: "1x" }] } as never, DR_SILVA);
      expect(repo.createPrescription.mock.calls[0][0]).toMatchObject({ prescribedByStaffId: "dr-silva" });
    });

    it("scopes a non-admin's list to their own prescriptions in the query itself, and pages it; admin is unscoped", async () => {
      repo.findPrescriptionsByPatientId.mockResolvedValue([{ id: "rx1", prescribedByStaffId: "dr-silva" }]);
      const result = await service.listPrescriptionsForPatient("p1", DR_SILVA, { page: 2, limit: 20 });
      expect(result).toEqual([{ id: "rx1", prescribedByStaffId: "dr-silva" }]);
      expect(repo.findPrescriptionsByPatientId).toHaveBeenCalledWith("p1", { page: 2, limit: 20, prescribedByStaffId: "dr-silva" });

      await service.listPrescriptionsForPatient("p1", ADMIN);
      expect(repo.findPrescriptionsByPatientId).toHaveBeenLastCalledWith("p1", {});
    });

    it("404s a patient that doesn't exist or was erased (a missing patient was a foreign-key 500)", async () => {
      repo.findPatientForWrite.mockResolvedValue(null);
      await expect(service.createPrescription("ghost", { items: [{ drugName: "X", dosage: "1", frequency: "1x" }] } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.createPrescription).not.toHaveBeenCalled();
    });

    describe("clinicalNoteId — must be the caller's own note for this patient", () => {
      const ITEMS = [{ drugName: "X", dosage: "1", frequency: "1x" }];
      const withNote = (id = "note-1") => ({ items: ITEMS, clinicalNoteId: id }) as never;
      beforeEach(() => repo.createPrescription.mockResolvedValue({ id: "rx1" }));

      it("links the caller's own note for this patient", async () => {
        repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "p1", authorStaffId: "dr-silva" });
        await service.createPrescription("p1", withNote(), DR_SILVA);
        expect(repo.createPrescription.mock.calls[0][0]).toMatchObject({ clinicalNoteId: "note-1" });
      });

      it("rejects a note that doesn't exist, belongs to another patient, or is a colleague's — with ONE message, so it can't be used to probe", async () => {
        const messages = new Set<string>();
        for (const header of [
          null,
          { id: "note-1", patientId: "someone-else", authorStaffId: "dr-silva" },
          { id: "note-1", patientId: "p1", authorStaffId: "dr-costa" },
        ]) {
          repo.findNoteHeader.mockResolvedValue(header);
          const err = await service.createPrescription("p1", withNote(), DR_SILVA).then(() => null, (e) => e);
          expect(err).toBeInstanceOf(BadRequestException);
          messages.add(err.message);
        }
        expect(messages.size).toBe(1);
        expect(repo.createPrescription).not.toHaveBeenCalled();
      });

      it("admin may link any note of THIS patient, but still not another patient's", async () => {
        repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "p1", authorStaffId: "dr-costa" });
        await service.createPrescription("p1", withNote(), ADMIN);
        expect(repo.createPrescription).toHaveBeenCalled();

        repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "other", authorStaffId: "dr-costa" });
        await expect(service.createPrescription("p1", withNote(), ADMIN)).rejects.toThrow(BadRequestException);
      });

      it("doesn't look a note up when none is given", async () => {
        await service.createPrescription("p1", { items: ITEMS } as never, DR_SILVA);
        expect(repo.findNoteHeader).not.toHaveBeenCalled();
      });

      it("a note deleted between the check and the write (foreign key) is a 400, not a 500; other failures pass through", async () => {
        repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "p1", authorStaffId: "dr-silva" });
        repo.createPrescription.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }));
        await expect(service.createPrescription("p1", withNote(), DR_SILVA)).rejects.toThrow(BadRequestException);
        repo.createPrescription.mockRejectedValueOnce(new Error("db down"));
        await expect(service.createPrescription("p1", withNote(), DR_SILVA)).rejects.toThrow("db down");
      });
    });
  });

  describe("referrals — referrer or target may see/act, not just authorship", () => {
    it("stamps the caller as referredBy", async () => {
      repo.createReferral.mockResolvedValue({ id: "ref1" });
      await service.createReferral("p1", { type: "external", externalProviderName: "Dr. X", reason: "needs psychiatry" } as never, DR_SILVA);
      expect(repo.createReferral.mock.calls[0][0].referredBy).toEqual({ connect: { id: "dr-silva" } });
    });

    it("scopes a clinician's list to what they sent or received, in the query itself, and pages it; admin is unscoped", async () => {
      repo.findReferralsByPatientId.mockResolvedValue([]);
      await service.listReferralsForPatient("p1", DR_SILVA, { page: 3, limit: 10 });
      expect(repo.findReferralsByPatientId).toHaveBeenCalledWith("p1", { page: 3, limit: 10, involvedStaffId: "dr-silva" });
      await service.listReferralsForPatient("p1", ADMIN);
      expect(repo.findReferralsByPatientId).toHaveBeenLastCalledWith("p1", {});
    });

    it("404s a patient that doesn't exist or was erased", async () => {
      repo.findPatientForWrite.mockResolvedValue(null);
      await expect(service.createReferral("ghost", { type: "external", externalProviderName: "Dr. X", reason: "needs psychiatry" } as never, DR_SILVA)).rejects.toThrow(NotFoundException);
      expect(repo.createReferral).not.toHaveBeenCalled();
    });

    describe("an internal referral's target", () => {
      const INTERNAL = { type: "internal", targetStaffId: "dr-costa", reason: "needs a second opinion" } as never;
      beforeEach(() => {
        repo.createReferral.mockResolvedValue({ id: "ref1" });
        repo.findStaffForReferral.mockResolvedValue({ id: "dr-costa", role: "doctor", deletedAt: null });
      });

      it("connects an active doctor as the target", async () => {
        await service.createReferral("p1", INTERNAL, DR_SILVA);
        expect(repo.createReferral.mock.calls[0][0].targetStaff).toEqual({ connect: { id: "dr-costa" } });
      });

      it("accepts an admin account as the target too (admin can open every referral anyway)", async () => {
        repo.findStaffForReferral.mockResolvedValue({ id: "dr-costa", role: "admin", deletedAt: null });
        await service.createReferral("p1", INTERNAL, DR_SILVA);
        expect(repo.createReferral).toHaveBeenCalled();
      });

      it("refuses the referrer as the target — and doesn't even look them up", async () => {
        await expect(service.createReferral("p1", { ...(INTERNAL as object), targetStaffId: "dr-silva" } as never, DR_SILVA)).rejects.toThrow(/yourself/);
        expect(repo.findStaffForReferral).not.toHaveBeenCalled();
      });

      it.each([
        ["doesn't exist", null],
        ["was deactivated", { id: "dr-costa", role: "doctor", deletedAt: new Date() }],
        ["is a nurse (couldn't open the referral: the clinical module is admin/doctor only)", { id: "dr-costa", role: "nurse", deletedAt: null }],
        ["is a receptionist", { id: "dr-costa", role: "receptionist", deletedAt: null }],
      ])("refuses a target that %s", async (_why, target) => {
        repo.findStaffForReferral.mockResolvedValue(target);
        await expect(service.createReferral("p1", INTERNAL, DR_SILVA)).rejects.toThrow(BadRequestException);
        expect(repo.createReferral).not.toHaveBeenCalled();
      });

      it("a target deleted between the check and the write is a 400, not a 500", async () => {
        repo.createReferral.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }));
        await expect(service.createReferral("p1", INTERNAL, DR_SILVA)).rejects.toThrow(BadRequestException);
      });
    });

    it("stores only the half that belongs to the type: no target on an external referral (it would reveal the referral to someone it wasn't addressed to), no provider on an internal one", async () => {
      repo.createReferral.mockResolvedValue({ id: "ref1" });
      repo.findStaffForReferral.mockResolvedValue({ id: "dr-costa", role: "doctor", deletedAt: null });

      await service.createReferral("p1", { type: "external", externalProviderName: "Dr. X", externalSpecialty: "Psiquiatria", targetStaffId: "dr-costa", reason: "needs psychiatry" } as never, DR_SILVA);
      const external = repo.createReferral.mock.calls[0][0];
      expect(external).not.toHaveProperty("targetStaff");
      expect(external).toMatchObject({ externalProviderName: "Dr. X", externalSpecialty: "Psiquiatria" });
      expect(repo.findStaffForReferral).not.toHaveBeenCalled();

      await service.createReferral("p1", { type: "internal", targetStaffId: "dr-costa", externalProviderName: "Stray Clinic", reason: "second opinion" } as never, DR_SILVA);
      const internal = repo.createReferral.mock.calls[1][0];
      expect(internal.targetStaff).toEqual({ connect: { id: "dr-costa" } });
      expect(internal).not.toHaveProperty("externalProviderName");
    });

    it("validates a referral's clinicalNoteId like a prescription's: the caller's own note for this patient", async () => {
      repo.createReferral.mockResolvedValue({ id: "ref1" });
      const ext = { type: "external", externalProviderName: "Dr. X", reason: "needs psychiatry", clinicalNoteId: "note-1" } as never;

      repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "p1", authorStaffId: "dr-costa" });
      await expect(service.createReferral("p1", ext, DR_SILVA)).rejects.toThrow(BadRequestException);
      expect(repo.createReferral).not.toHaveBeenCalled();

      repo.findNoteHeader.mockResolvedValue({ id: "note-1", patientId: "p1", authorStaffId: "dr-silva" });
      await service.createReferral("p1", ext, DR_SILVA);
      expect(repo.createReferral.mock.calls[0][0].clinicalNote).toEqual({ connect: { id: "note-1" } });
    });

    describe("updateReferralStatus", () => {
      const referral = (status: string, o: object = {}) => ({ id: "r2", status, referredByStaffId: "dr-costa", targetStaffId: "dr-silva", ...o });

      it("lets the target clinician move it forward (CAS on the status they saw); 404s an uninvolved one", async () => {
        repo.findReferralById.mockResolvedValue(referral("pending"));
        repo.updateReferralStatus.mockResolvedValue({ id: "r2", status: "scheduled" });
        await service.updateReferralStatus("r2", "scheduled", DR_SILVA);
        expect(repo.updateReferralStatus).toHaveBeenCalledWith("r2", "pending", "scheduled");

        jest.clearAllMocks();
        repo.findReferralById.mockResolvedValue(referral("pending", { targetStaffId: null }));
        await expect(service.updateReferralStatus("r2", "scheduled", { sub: "dr-nobody", email: "x", roles: ["doctor"] })).rejects.toThrow(NotFoundException);
        expect(repo.updateReferralStatus).not.toHaveBeenCalled();
      });

      it("follows the transition table: allowed moves go through", async () => {
        const allowed: [string, string][] = [
          ["pending", "scheduled"], ["pending", "completed"], ["pending", "declined"],
          ["scheduled", "pending"], ["scheduled", "completed"], ["scheduled", "declined"],
          ["declined", "pending"],
        ];
        for (const [from, to] of allowed) {
          repo.findReferralById.mockResolvedValue(referral(from));
          repo.updateReferralStatus.mockResolvedValue({ id: "r2", status: to });
          await expect(service.updateReferralStatus("r2", to as never, DR_SILVA)).resolves.toMatchObject({ status: to });
        }
      });

      it("…and the rest are refused with a 400 that names both states: a completed referral is final, a declined one can only be re-opened", async () => {
        const refused: [string, string][] = [
          ["completed", "pending"], ["completed", "scheduled"], ["completed", "declined"],
          ["declined", "scheduled"], ["declined", "completed"],
        ];
        for (const [from, to] of refused) {
          repo.findReferralById.mockResolvedValue(referral(from));
          const err = await service.updateReferralStatus("r2", to as never, DR_SILVA).then(() => null, (e) => e);
          expect(err).toBeInstanceOf(BadRequestException);
          expect(err.message).toContain(from);
          expect(err.message).toContain(to);
        }
        expect(repo.updateReferralStatus).not.toHaveBeenCalled();
      });

      it("the referrer is bound by the same table as the target", async () => {
        repo.findReferralById.mockResolvedValue(referral("completed"));
        await expect(service.updateReferralStatus("r2", "pending", { sub: "dr-costa", email: "c", roles: ["doctor"] })).rejects.toThrow(BadRequestException);
      });

      it("admin may correct any status", async () => {
        repo.findReferralById.mockResolvedValue(referral("completed"));
        repo.updateReferralStatus.mockResolvedValue({ id: "r2", status: "pending" });
        await expect(service.updateReferralStatus("r2", "pending", ADMIN)).resolves.toMatchObject({ status: "pending" });
        expect(repo.updateReferralStatus).toHaveBeenCalledWith("r2", "completed", "pending");
      });

      it("repeating the current status is a harmless no-op (a double click), even on a completed referral — nothing is written", async () => {
        repo.findReferralById.mockResolvedValue(referral("completed"));
        await expect(service.updateReferralStatus("r2", "completed", DR_SILVA)).resolves.toMatchObject({ id: "r2", status: "completed" });
        expect(repo.updateReferralStatus).not.toHaveBeenCalled();
      });

      it("two people moving it at once: the loser gets a 409 REFERRAL_CHANGED carrying the referral as it is now", async () => {
        repo.findReferralById.mockResolvedValueOnce(referral("pending")).mockResolvedValueOnce(referral("declined"));
        repo.updateReferralStatus.mockResolvedValue(null); // the status changed under us: the compare-and-set wrote nothing

        const err = await service.updateReferralStatus("r2", "scheduled", DR_SILVA).then(() => null, (e) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ code: "REFERRAL_CHANGED", referral: { id: "r2", status: "declined" } });
      });
    });
  });
});
