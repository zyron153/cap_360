import { Test } from "@nestjs/testing";
import { Prisma } from "@cap/database";
import { ClinicalRecordsRepository } from "./clinical-records.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";

process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);

const prisma = {
  clinicalNote: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  appointment: { count: jest.fn() },
  prescription: { create: jest.fn(), findMany: jest.fn() },
  referral: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  patient: { findFirst: jest.fn(), findMany: jest.fn() },
  staff: { findUnique: jest.fn(), findMany: jest.fn() },
  auditLog: { findMany: jest.fn() },
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
    it("findAllNotes: builds the author/draft/patient-name/day-range filter into the query, and an empty draft round-trips", async () => {
      prisma.clinicalNote.findMany.mockResolvedValue([
        { id: "n1", presentingConcerns: encryption.encrypt(""), observations: encryption.encrypt(""), assessment: encryption.encrypt(""), plan: encryption.encrypt(""), riskNotes: null },
      ]);

      const result = await repo.findAllNotes({ authorStaffId: "dr-silva", status: "draft", q: "maria", riskLevel: "high", from: "2026-10-03", to: "2026-10-03" });

      const args = prisma.clinicalNote.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        authorStaffId: "dr-silva",
        riskLevel: "high",
        finalizedAt: null,
        patient: { fullName: { contains: "maria", mode: "insensitive" } },
      });
      // A day is Cabo Verde local (UTC-1), not UTC midnight.
      expect(args.where.createdAt.gte.toISOString()).toBe("2026-10-03T01:00:00.000Z");
      expect(args.where.createdAt.lte.toISOString()).toBe("2026-10-04T00:59:59.999Z");
      expect(result[0].plan).toBe("");

      await repo.findAllNotes({ status: "final" });
      expect(prisma.clinicalNote.findMany.mock.calls[1][0].where).toEqual({ finalizedAt: { not: null } });
    });

    it("findAllNotes: pages with skip/take over a stable (createdAt, id) order, defaulting to the first 100", async () => {
      prisma.clinicalNote.findMany.mockResolvedValue([]);

      await repo.findAllNotes({ page: 3, limit: 20 });
      const paged = prisma.clinicalNote.findMany.mock.calls[0][0];
      expect(paged.skip).toBe(40);
      expect(paged.take).toBe(20);
      expect(paged.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

      await repo.findAllNotes({});
      const first = prisma.clinicalNote.findMany.mock.calls[1][0];
      expect(first.skip).toBe(0);
      expect(first.take).toBe(100);
    });

    it("findNoteByAppointmentAndAuthor: looks up by the compound key and decrypts, null when there is none", async () => {
      prisma.clinicalNote.findUnique.mockResolvedValueOnce({
        id: "n1", presentingConcerns: encryption.encrypt("a"), observations: encryption.encrypt("b"),
        assessment: encryption.encrypt("c"), plan: encryption.encrypt("d"), riskNotes: null,
      });
      const found = await repo.findNoteByAppointmentAndAuthor("a1", "dr-silva");
      expect(prisma.clinicalNote.findUnique.mock.calls[0][0].where).toEqual({ appointmentId_authorStaffId: { appointmentId: "a1", authorStaffId: "dr-silva" } });
      expect(found?.plan).toBe("d");

      prisma.clinicalNote.findUnique.mockResolvedValueOnce(null);
      expect(await repo.findNoteByAppointmentAndAuthor("a1", "dr-costa")).toBeNull();
    });

    it("updateNote with expectedUpdatedAt is a compare-and-set: one conditional write, null when nothing matched", async () => {
      const seen = new Date("2026-10-05T10:00:00.000Z");

      prisma.clinicalNote.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await repo.updateNote("n1", { plan: "mine" }, seen)).toBeNull();
      const call = prisma.clinicalNote.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: "n1", updatedAt: seen }); // the check is part of the write
      expect(encryption.decrypt(call.data.plan)).toBe("mine"); // still encrypted
      expect(prisma.clinicalNote.update).not.toHaveBeenCalled();

      prisma.clinicalNote.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.clinicalNote.findUnique.mockResolvedValueOnce({
        id: "n1", presentingConcerns: encryption.encrypt("a"), observations: encryption.encrypt("b"),
        assessment: encryption.encrypt("c"), plan: encryption.encrypt("mine"), riskNotes: null,
      });
      expect((await repo.updateNote("n1", { plan: "mine" }, seen))?.plan).toBe("mine"); // re-read, decrypted
    });

    it("hasTreatmentToday: counts checked-in/completed appointments inside today's CABO VERDE day, not the UTC day", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-05T00:30:00Z")); // 23:30 on 4 Oct in Cabo Verde (UTC-1)
      try {
        prisma.appointment.count.mockResolvedValueOnce(1);
        expect(await repo.hasTreatmentToday("p1", "dr-silva")).toBe(true);
        const where = prisma.appointment.count.mock.calls[0][0].where;
        expect(where).toMatchObject({ patientId: "p1", deletedAt: null, status: { in: ["checked_in", "completed"] } });
        expect(where.scheduledAt.gte.toISOString()).toBe("2026-10-04T01:00:00.000Z");
        expect(where.scheduledAt.lte.toISOString()).toBe("2026-10-05T00:59:59.999Z");

        prisma.appointment.count.mockResolvedValueOnce(0);
        expect(await repo.hasTreatmentToday("p1", "dr-silva")).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("hasTreatmentToday: the reader can't be the only person who put the patient in treatment (no self-unlock)", async () => {
      prisma.appointment.count.mockResolvedValueOnce(0);
      await repo.hasTreatmentToday("p1", "dr-silva");

      const { OR } = prisma.appointment.count.mock.calls[0][0].where;
      expect(OR).toEqual([
        { checkedInByStaffId: null, completedByStaffId: null }, // actor unknown: a system action, or before actors were recorded
        { AND: [{ checkedInByStaffId: { not: null } }, { checkedInByStaffId: { not: "dr-silva" } }] }, // someone else checked in…
        { AND: [{ completedByStaffId: { not: null } }, { completedByStaffId: { not: "dr-silva" } }] }, // …or someone else completed
      ]);
    });

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

    describe("findNotesByPatientId — a bounded, scoped page", () => {
      beforeEach(() => prisma.clinicalNote.findMany.mockResolvedValue([]));
      const args = () => prisma.clinicalNote.findMany.mock.calls[0][0];

      it("is a page (default the first 100) in a stable newest-first order, never the whole history", async () => {
        await repo.findNotesByPatientId("p1");
        expect(args()).toMatchObject({ where: { patientId: "p1" }, skip: 0, take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });

        await repo.findNotesByPatientId("p1", { page: 3, limit: 20 });
        expect(prisma.clinicalNote.findMany.mock.calls[1][0]).toMatchObject({ skip: 40, take: 20 });
      });

      it("admin (no scope) is filtered by patient only", async () => {
        await repo.findNotesByPatientId("p1", {});
        expect(args().where).toEqual({ patientId: "p1" });
      });

      it("a reader's scope is their own notes — plus every author's FINALIZED notes only when treatment opened it — inside the query", async () => {
        await repo.findNotesByPatientId("p1", { scope: { readerId: "dr-b", includeOthersFinalized: false } });
        expect(args().where).toEqual({ patientId: "p1", OR: [{ authorStaffId: "dr-b" }] });

        await repo.findNotesByPatientId("p1", { scope: { readerId: "dr-b", includeOthersFinalized: true } });
        expect(prisma.clinicalNote.findMany.mock.calls[1][0].where).toEqual({
          patientId: "p1",
          OR: [{ authorStaffId: "dr-b" }, { finalizedAt: { not: null } }], // drafts of others are never in reach
        });
      });
    });

    describe("deleteDraftNote", () => {
      it("deletes in ONE conditional statement: only a draft, only one nothing refers to — so a note finalized or linked a moment ago survives", async () => {
        prisma.clinicalNote.deleteMany.mockResolvedValue({ count: 1 });
        expect(await repo.deleteDraftNote("n1")).toBe("deleted");
        expect(prisma.clinicalNote.deleteMany.mock.calls[0][0].where).toEqual({
          id: "n1", finalizedAt: null, prescriptions: { none: {} }, referrals: { none: {} },
        });
        expect(prisma.clinicalNote.findUnique).not.toHaveBeenCalled();
      });

      it("when nothing was deleted it re-reads to say why: gone, finalized, or linked", async () => {
        prisma.clinicalNote.deleteMany.mockResolvedValue({ count: 0 });

        prisma.clinicalNote.findUnique.mockResolvedValueOnce(null);
        expect(await repo.deleteDraftNote("n1")).toBe("not_found");
        prisma.clinicalNote.findUnique.mockResolvedValueOnce({ finalizedAt: new Date() });
        expect(await repo.deleteDraftNote("n1")).toBe("finalized");
        prisma.clinicalNote.findUnique.mockResolvedValueOnce({ finalizedAt: null }); // still a draft, so something refers to it
        expect(await repo.deleteDraftNote("n1")).toBe("linked");
      });

      it("a link created in the instant between the check and the delete trips the RESTRICT foreign key (P2003): reported as linked, not a 500", async () => {
        prisma.clinicalNote.deleteMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }));
        expect(await repo.deleteDraftNote("n1")).toBe("linked");
      });

      it("any other database failure is not swallowed", async () => {
        prisma.clinicalNote.deleteMany.mockRejectedValue(new Error("db down"));
        await expect(repo.deleteDraftNote("n1")).rejects.toThrow("db down");
      });
    });

    it("findNoteHeader selects identity and state only — nothing encrypted, so nothing to decrypt", async () => {
      prisma.clinicalNote.findUnique.mockResolvedValue({ id: "n1" });
      await repo.findNoteHeader("n1");
      const { select } = prisma.clinicalNote.findUnique.mock.calls[0][0];
      expect(Object.keys(select).sort()).toEqual(["appointmentId", "authorStaffId", "createdAt", "finalizedAt", "id", "patientId"]);
    });

    it("findPatientForWrite ignores erased patients", async () => {
      prisma.patient.findFirst.mockResolvedValue(null);
      expect(await repo.findPatientForWrite("p1")).toBeNull();
      expect(prisma.patient.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", deletedAt: null });
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
      expect(result?.plan).toBe("novo plano"); // and comes back decrypted (no version given → unconditional, never null)
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

    it("lists a bounded, newest-first page, scoped to one prescriber when asked", async () => {
      prisma.prescription.findMany.mockResolvedValue([]);
      await repo.findPrescriptionsByPatientId("p1", { prescribedByStaffId: "dr-b", page: 2, limit: 25 });
      expect(prisma.prescription.findMany.mock.calls[0][0]).toMatchObject({
        where: { patientId: "p1", prescribedByStaffId: "dr-b" },
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        skip: 25,
        take: 25,
      });
      await repo.findPrescriptionsByPatientId("p1");
      expect(prisma.prescription.findMany.mock.calls[1][0]).toMatchObject({ where: { patientId: "p1" }, skip: 0, take: 100 });
    });
  });

  describe("referrals", () => {
    it("lists a bounded, newest-first page; a non-admin's scope is 'sent or received' inside the query", async () => {
      prisma.referral.findMany.mockResolvedValue([]);
      await repo.findReferralsByPatientId("p1", { involvedStaffId: "dr-b", page: 2, limit: 10 });
      expect(prisma.referral.findMany.mock.calls[0][0]).toMatchObject({
        where: { patientId: "p1", OR: [{ referredByStaffId: "dr-b" }, { targetStaffId: "dr-b" }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 10,
        take: 10,
      });
      await repo.findReferralsByPatientId("p1");
      expect(prisma.referral.findMany.mock.calls[1][0]).toMatchObject({ where: { patientId: "p1" }, skip: 0, take: 100 });
    });

    it("updateReferralStatus is a compare-and-set on the status the caller saw: one conditional write, null when it already moved", async () => {
      prisma.referral.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await repo.updateReferralStatus("r1", "pending", "scheduled")).toBeNull();
      expect(prisma.referral.updateMany.mock.calls[0][0]).toEqual({ where: { id: "r1", status: "pending" }, data: { status: "scheduled" } });

      prisma.referral.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.referral.findUnique.mockResolvedValueOnce({ id: "r1", status: "scheduled" });
      expect(await repo.updateReferralStatus("r1", "pending", "scheduled")).toMatchObject({ status: "scheduled" });
    });

    it("findStaffForReferral selects only what the target check needs", async () => {
      prisma.staff.findUnique.mockResolvedValue({ id: "s1", role: "doctor", deletedAt: null });
      await repo.findStaffForReferral("s1");
      expect(prisma.staff.findUnique.mock.calls[0][0].select).toEqual({ id: true, role: true, deletedAt: true }); // never passwordHash
    });
  });

  describe("the admin's cross-author read report", () => {
    it("filters audit_log to GET rows carrying the treating-today mark (a Json path filter), newest first with a stable tiebreak, paged", async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);

      await repo.findCrossAuthorReads({ page: 3, limit: 20 });

      expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({
        where: { action: "GET", metadata: { path: ["diff", "after", "basis"], equals: "patient in treatment today" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 40,
        take: 20,
      });
      await repo.findCrossAuthorReads({});
      expect(prisma.auditLog.findMany.mock.calls[1][0]).toMatchObject({ skip: 0, take: 50 }); // the report's default page
    });

    it("selects only what the report shows — not ip address or user agent", async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      await repo.findCrossAuthorReads({});
      expect(Object.keys(prisma.auditLog.findMany.mock.calls[0][0].select).sort()).toEqual(["actorEmail", "actorId", "createdAt", "id", "metadata", "resourceId"]);
    });

    it("looks names up in batches (one query each) and skips the query when there is nothing to look up", async () => {
      prisma.staff.findMany.mockResolvedValue([{ id: "s1", fullName: "Dr. B" }]);
      prisma.patient.findMany.mockResolvedValue([{ id: "p1", fullName: "Maria" }, { id: "p2", fullName: null }]);
      prisma.clinicalNote.findMany.mockResolvedValue([{ id: "n1", patientId: "p1" }]);

      expect(await repo.findStaffNames(["s1", "gone"])).toEqual(new Map([["s1", "Dr. B"]]));
      expect(await repo.findPatientNames(["p1", "p2"])).toEqual(new Map([["p1", "Maria"], ["p2", null]]));
      expect(await repo.findNotePatientIds(["n1"])).toEqual(new Map([["n1", "p1"]]));
      expect(prisma.staff.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["s1", "gone"] } }, select: { id: true, fullName: true } });

      jest.clearAllMocks();
      expect((await repo.findStaffNames([])).size + (await repo.findPatientNames([])).size + (await repo.findNotePatientIds([])).size).toBe(0);
      expect(prisma.staff.findMany).not.toHaveBeenCalled();
      expect(prisma.patient.findMany).not.toHaveBeenCalled();
      expect(prisma.clinicalNote.findMany).not.toHaveBeenCalled();
    });
  });
});
