import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

jest.setTimeout(180_000);

/** authBypass:false — real sessions for the admin and two doctors (3 logins: /auth/login is throttled to 5/min per
 * IP, see AuthController). Covers, over real HTTP and the real database:
 *   - discarding a draft (DELETE /clinical-notes/:id) and its rules,
 *   - the admin's report of cross-author reads (GET /clinical-notes/access-log),
 *   - the write-side validation of prescriptions and referrals, the referral status rules and the list paging.
 * (`Docs/modules/M7-clinical-records-emr.md` §2.1, §2.3, §2.4, §3.1, §5.)
 *
 * Everything it creates is named "AG1 …" and removed by id in afterAll (children first; errors are NOT swallowed). */
describe("Clinical records: discarding drafts, the cross-author access log, link validation (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let cookieA: string;
  let cookieB: string;
  let doctorA: { id: string; email: string };
  let doctorB: { id: string; email: string };
  let nurseId: string;
  let serviceId: string;

  const stamp = Date.now();
  const PASSWORD = "Doctor-Pass1";
  const http = () => request(app.getHttpServer());
  const FULL = { sessionType: "individual", presentingConcerns: "q", observations: "o", assessment: "a", plan: "p" };
  const RX = { items: [{ drugName: "Sertralina", dosage: "50mg", frequency: "1x ao dia" }] };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let phoneSeq = 0;

  const patientIds: string[] = [];
  const staffIds: string[] = [];

  const loginAs = async (email: string, password: string) =>
    (await http().post("/v1/auth/login").send({ email, password }).expect(200)).headers["set-cookie"][0] as string;
  const createStaff = async (tag: string, role: "doctor" | "nurse") => {
    const email = `ag1-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@cap.cv`;
    const res = await http().post("/v1/staff").set("Cookie", adminCookie).send({ fullName: `AG1 IT ${tag}`, email, role, password: PASSWORD }).expect(201);
    staffIds.push(res.body.id);
    return { id: res.body.id as string, email };
  };
  const createPatient = async (tag: string) => {
    phoneSeq += 1;
    const res = await http().post("/v1/patients").set("Cookie", adminCookie).send({
      fullName: `AG1 IT ${tag}`, dateOfBirth: "1991-03-03", gender: "female",
      phone: `+23897${String((stamp + phoneSeq * 7919) % 100000).padStart(5, "0")}`, consentGiven: true,
    }).expect(201);
    patientIds.push(res.body.id);
    return res.body.id as string;
  };
  const bookAppointment = (patientId: string, staffId: string, scheduledAt: Date, status: "confirmed" | "checked_in" = "confirmed") =>
    prisma.appointment.create({ data: { patientId, staffId, serviceId, scheduledAt, durationMinutes: 30, status } }).then((a) => a.id);
  const tomorrow = () => new Date(Date.now() + 36 * 3_600_000);
  const noteOf = (cookie: string, patientId: string, body: object = FULL) =>
    http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookie).send(body);
  const del = (cookie: string, id: string) => http().delete(`/v1/clinical-notes/${id}`).set("Cookie", cookie);
  const accessLog = (cookie: string, qs = "") => http().get(`/v1/clinical-notes/access-log${qs}`).set("Cookie", cookie);

  /** The audit write is fire-and-forget: poll for the row instead of racing it. */
  const waitForAudit = async (where: Prisma.AuditLogWhereInput) => {
    for (let i = 0; i < 40; i++) {
      const row = await prisma.auditLog.findFirst({ where, orderBy: { createdAt: "desc" } });
      if (row) return row;
      await sleep(250);
    }
    return null;
  };
  /** Polls the report (as the admin) until `ready(entries for this patient)` holds, then returns those entries. */
  const reportFor = async (patientId: string, ready: (n: number) => boolean) => {
    let mine: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < 40; i++) {
      const res = await accessLog(adminCookie, "?limit=100").expect(200);
      mine = (res.body as Array<Record<string, any>>).filter((e) => e.patient?.id === patientId); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (ready(mine.length)) break;
      await sleep(250);
    }
    return mine;
  };

  beforeAll(async () => {
    app = await createTestApp({ authBypass: false });
    prisma = app.get(PrismaService);
    adminCookie = await loginAs("capjacobvicente@gmail.com", "Teste@1234");
    doctorA = await createStaff("Doctor A", "doctor");
    doctorB = await createStaff("Doctor B", "doctor");
    nurseId = (await createStaff("Nurse", "nurse")).id;
    cookieA = await loginAs(doctorA.email, PASSWORD);
    cookieB = await loginAs(doctorB.email, PASSWORD);
    serviceId = (await prisma.service.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    // Children first, and no .catch(): a leak must fail loudly. (Completing an appointment auto-creates a draft invoice.)
    for (const patientId of patientIds) {
      await prisma.prescription.deleteMany({ where: { patientId } }); // items cascade
      await prisma.referral.deleteMany({ where: { patientId } }); // referrals/prescriptions hold RESTRICT FKs to notes
      await prisma.clinicalNote.deleteMany({ where: { patientId } });
      await prisma.invoiceItem.deleteMany({ where: { invoice: { patientId } } });
      await prisma.invoice.deleteMany({ where: { patientId } });
      await prisma.appointment.deleteMany({ where: { patientId } });
      await prisma.patient.delete({ where: { id: patientId } });
    }
    for (const id of staffIds) await prisma.staff.delete({ where: { id } });
    await app.close();
  });

  // ─── DELETE /clinical-notes/:id ──────────────────────────────────────────────────────────────────────────

  describe("discarding a draft", () => {
    it("the author discards it: 204, it is gone, the audit row says whose draft, and the (appointment, author) slot is free again", async () => {
      const patientId = await createPatient("discard");
      const appointmentId = await bookAppointment(patientId, doctorA.id, tomorrow());
      const draft = (await noteOf(cookieA, patientId, { ...FULL, plan: "", draft: true, appointmentId }).expect(201)).body;

      // the slot is taken while the draft exists …
      await noteOf(cookieA, patientId, { ...FULL, draft: true, appointmentId }).expect(409);

      const res = await del(cookieA, draft.id).expect(204);
      expect(res.body).toEqual({});

      await http().get(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).expect(404);
      expect((await http().get(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).expect(200)).body).toHaveLength(0);
      await del(cookieA, draft.id).expect(404); // already gone

      // … and free afterwards: a new note can be started for the same appointment
      const again = await noteOf(cookieA, patientId, { ...FULL, draft: true, appointmentId }).expect(201);
      expect(again.body.id).not.toBe(draft.id);

      const audit = await waitForAudit({ action: "DELETE", resource: "clinical-notes", resourceId: draft.id });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(doctorA.id);
      expect(audit?.metadata).toMatchObject({ diff: { before: { patientId, authorStaffId: doctorA.id, appointmentId }, after: null } });
      expect(JSON.stringify(audit?.metadata)).not.toMatch(/presentingConcerns|assessment/); // never the text
    });

    it("an autosave that arrives after the draft was discarded is a 404 — not a 500, and not an empty-note 409 — with or without the version it saw", async () => {
      const patientId = await createPatient("discard-then-save");
      const draft = (await noteOf(cookieA, patientId, { ...FULL, draft: true }).expect(201)).body;
      await del(cookieA, draft.id).expect(204);

      const save = (body: object) => http().patch(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).send(body);
      await save({ presentingConcerns: "late autosave", draft: true }).expect(404);
      await save({ presentingConcerns: "late autosave", draft: true, expectedUpdatedAt: draft.updatedAt }).expect(404);
      await http().get(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).expect(404); // and nothing was resurrected
    });

    it("another doctor gets a 404 (the draft is untouched); admin may discard anyone's draft", async () => {
      const patientId = await createPatient("discard-other");
      const draft = (await noteOf(cookieA, patientId, { ...FULL, draft: true }).expect(201)).body;

      await del(cookieB, draft.id).expect(404);
      expect((await http().get(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).expect(200)).body.id).toBe(draft.id);

      await del(adminCookie, draft.id).expect(204);
      await http().get(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).expect(404);
    });

    it("a finalized note is a clinical record: 409 NOTE_FINALIZED for its author and for admin, and it stays readable — also one finalized from a draft", async () => {
      const patientId = await createPatient("discard-final");
      const final = (await noteOf(cookieA, patientId).expect(201)).body;
      for (const cookie of [cookieA, adminCookie]) {
        const res = await del(cookie, final.id).expect(409);
        expect(res.body).toMatchObject({ code: "NOTE_FINALIZED", message: expect.stringMatching(/clinical record/) });
      }
      expect((await http().get(`/v1/clinical-notes/${final.id}`).set("Cookie", cookieA).expect(200)).body.plan).toBe("p");

      const draft = (await noteOf(cookieA, patientId, { ...FULL, draft: true }).expect(201)).body;
      await http().patch(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).send({ draft: false }).expect(200);
      await del(cookieA, draft.id).expect(409);
    });

    it("a colleague's FINALIZED note answers 404, not 409, so deleting can't be used to tell it exists", async () => {
      const patientId = await createPatient("discard-final-other");
      const final = (await noteOf(cookieA, patientId).expect(201)).body;
      await del(cookieB, final.id).expect(404);
    });

    it("a draft a prescription refers to answers 409 NOTE_HAS_LINKED_RECORDS — nothing is deleted or detached, and the database itself refuses too", async () => {
      const patientId = await createPatient("discard-linked-rx");
      const draft = (await noteOf(cookieA, patientId, { ...FULL, draft: true }).expect(201)).body;
      const rx = (await http().post(`/v1/patients/${patientId}/prescriptions`).set("Cookie", cookieA).send({ ...RX, clinicalNoteId: draft.id }).expect(201)).body;

      const res = await del(cookieA, draft.id).expect(409);
      expect(res.body).toMatchObject({ code: "NOTE_HAS_LINKED_RECORDS", message: expect.stringMatching(/linked records/) });

      expect((await http().get(`/v1/clinical-notes/${draft.id}`).set("Cookie", cookieA).expect(200)).body.id).toBe(draft.id);
      expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).clinicalNoteId).toBe(draft.id); // still linked

      // The foreign key is RESTRICT (it was SET NULL, which would have silently detached the prescription):
      await expect(prisma.clinicalNote.delete({ where: { id: draft.id } })).rejects.toMatchObject({ code: "P2003" });
    });

    it("…and so does one a referral refers to; once the link is gone the draft can be discarded", async () => {
      const patientId = await createPatient("discard-linked-ref");
      const draft = (await noteOf(cookieA, patientId, { ...FULL, draft: true }).expect(201)).body;
      const ref = (await http().post(`/v1/patients/${patientId}/referrals`).set("Cookie", cookieA)
        .send({ type: "external", externalProviderName: "Dr. Externo", reason: "avaliação psiquiátrica", clinicalNoteId: draft.id }).expect(201)).body;

      expect((await del(cookieA, draft.id).expect(409)).body.code).toBe("NOTE_HAS_LINKED_RECORDS");

      await prisma.referral.delete({ where: { id: ref.id } });
      await del(cookieA, draft.id).expect(204);
    });

    it("rejects a malformed id with 400, and an unauthenticated call with 401", async () => {
      await del(cookieA, "not-a-uuid").expect(400);
      await http().delete(`/v1/clinical-notes/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`).expect(401);
    });
  });

  // ─── GET /clinical-notes/access-log ──────────────────────────────────────────────────────────────────────

  describe("the admin's cross-author access log", () => {
    let patientId: string;
    let noteId: string;

    beforeAll(async () => {
      patientId = await createPatient("access-log");
      noteId = (await noteOf(cookieA, patientId).expect(201)).body.id;
    });

    it("is admin only: a doctor (even the note's author) gets 403, an anonymous caller 401 — and the route isn't swallowed by ':id'", async () => {
      await accessLog(cookieB).expect(403);
      await accessLog(cookieA).expect(403);
      await http().get("/v1/clinical-notes/access-log").expect(401);
      expect(Array.isArray((await accessLog(adminCookie).expect(200)).body)).toBe(true); // 200, not ParseUUIDPipe's 400
    });

    it("lists exactly the cross-author reads of this patient — and only once the patient is in treatment", async () => {
      // not yet in treatment: B reads nothing, so there is nothing to report
      expect((await http().get(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieB).expect(200)).body).toHaveLength(0);
      await http().get(`/v1/clinical-notes/${noteId}`).set("Cookie", cookieB).expect(404);

      // reception (here: the admin) checks the patient in, through the real endpoint, so the actor is recorded
      const appointmentId = await bookAppointment(patientId, doctorA.id, new Date());
      await http().patch(`/v1/appointments/${appointmentId}/status`).set("Cookie", adminCookie).send({ status: "checked_in" }).expect(200);

      // B reads A's notes: the list, then the note by id — the second with a query string appended (it used to void the audit row)
      const list = await http().get(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieB).expect(200);
      expect(list.body.map((n: { id: string }) => n.id)).toEqual([noteId]);
      await http().get(`/v1/clinical-notes/${noteId}?${"cachebust=1&".repeat(6)}`).set("Cookie", cookieB).expect(200);

      // A reads their own notes and the admin reads everything: neither is a cross-author read
      await http().get(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).expect(200);
      await http().get(`/v1/clinical-notes/${noteId}`).set("Cookie", adminCookie).expect(200);

      const mine = await reportFor(patientId, (n) => n >= 2);
      await sleep(1500); // give a (wrong) extra row from A's or the admin's read time to appear before asserting there is none
      const settled = await reportFor(patientId, () => true);

      expect(mine).toHaveLength(2);
      expect(settled).toHaveLength(2);
      const reader = { id: doctorB.id, email: doctorB.email, fullName: "AG1 IT Doctor B" };
      const patient = { id: patientId, fullName: "AG1 IT access-log" };
      const byId = settled.find((e) => e.note);
      const listRead = settled.find((e) => !e.note);
      expect(listRead).toMatchObject({ reader, patient, basis: "patient in treatment today", otherAuthorsNotes: 1, note: null });
      expect(byId).toMatchObject({ reader, patient, basis: "patient in treatment today", otherAuthorsNotes: null, note: { id: noteId, authorStaffId: doctorA.id } });
      expect(new Date(listRead?.at).getTime()).toBeLessThan(Date.now() + 1000);
    });

    it("is newest first with stable paging: one row per page, no repeats, and bad paging is a 400", async () => {
      const all = (await accessLog(adminCookie, "?limit=100").expect(200)).body as Array<{ id: string; at: string }>;
      expect(all.length).toBeGreaterThanOrEqual(2);
      const times = all.map((e) => new Date(e.at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first

      const p1 = (await accessLog(adminCookie, "?limit=1&page=1").expect(200)).body as Array<{ id: string }>;
      const p2 = (await accessLog(adminCookie, "?limit=1&page=2").expect(200)).body as Array<{ id: string }>;
      expect(p1).toHaveLength(1);
      expect(p2).toHaveLength(1);
      expect(p1[0].id).toBe(all[0].id);
      expect(p2[0].id).toBe(all[1].id);

      await accessLog(adminCookie, "?limit=101").expect(400);
      await accessLog(adminCookie, "?limit=0").expect(400);
      await accessLog(adminCookie, "?page=0").expect(400);
      await accessLog(adminCookie, "?page=abc").expect(400);
      await accessLog(adminCookie, "?page=1000000").expect(400); // an absurd page used to reach the database as a skip overflow
    });

    it("an erased patient is still reported — by id, with a null name", async () => {
      const erased = await createPatient("access-erased");
      const erasedNote = (await noteOf(cookieA, erased).expect(201)).body.id;
      const appointmentId = await bookAppointment(erased, doctorA.id, new Date());
      await http().patch(`/v1/appointments/${appointmentId}/status`).set("Cookie", adminCookie).send({ status: "checked_in" }).expect(200);
      await http().get(`/v1/clinical-notes/${erasedNote}`).set("Cookie", cookieB).expect(200);
      await http().delete(`/v1/patients/${erased}`).set("Cookie", adminCookie).expect(204); // right to erasure: name scrubbed

      const [entry] = await reportFor(erased, (n) => n >= 1);
      expect(entry).toMatchObject({ patient: { id: erased, fullName: null }, note: { id: erasedNote, authorStaffId: doctorA.id } });
    });

    it("reading the report is itself audited", async () => {
      await accessLog(adminCookie, "?limit=5&page=1").expect(200);
      const row = await waitForAudit({ action: "GET", resource: "clinical-notes", resourceId: "access-log" });
      expect(row).not.toBeNull(); // resource/resourceId are the path only, not "access-log?limit=5&page=1"
    });
  });

  // ─── write-side validation: prescriptions, referrals, notes ──────────────────────────────────────────────

  describe("a missing or erased patient is a 404, not a 500", () => {
    const GHOST = "00000000-0000-4000-8000-000000000001";
    it("for a new note, prescription and referral", async () => {
      await noteOf(cookieA, GHOST).expect(404);
      await http().post(`/v1/patients/${GHOST}/prescriptions`).set("Cookie", cookieA).send(RX).expect(404);
      await http().post(`/v1/patients/${GHOST}/referrals`).set("Cookie", cookieA).send({ type: "external", externalProviderName: "Dr. X", reason: "avaliação" }).expect(404);
    });

    it("also once the patient was erased (right to erasure keeps the row, so the foreign key alone would have accepted it)", async () => {
      const erased = await createPatient("write-erased");
      await http().delete(`/v1/patients/${erased}`).set("Cookie", adminCookie).expect(204);
      await noteOf(cookieA, erased).expect(404);
      await http().post(`/v1/patients/${erased}/prescriptions`).set("Cookie", cookieA).send(RX).expect(404);
    });
  });

  describe("clinicalNoteId on a prescription or referral", () => {
    it("must be the caller's own note for THIS patient — one 400 whether it is missing, a colleague's, or another patient's", async () => {
      const patientId = await createPatient("link-a");
      const other = await createPatient("link-b");
      const mine = (await noteOf(cookieA, patientId).expect(201)).body.id;
      const otherPatientsNote = (await noteOf(cookieA, other).expect(201)).body.id;
      const rx = (id: string, cookie = cookieA) => http().post(`/v1/patients/${patientId}/prescriptions`).set("Cookie", cookie).send({ ...RX, clinicalNoteId: id });

      expect((await rx(mine).expect(201)).body.clinicalNoteId).toBe(mine);
      const missing = await rx("00000000-0000-4000-8000-0000000000aa").expect(400);
      const anotherPatient = await rx(otherPatientsNote).expect(400);
      const colleagues = await rx(mine, cookieB).expect(400);
      expect(new Set([missing.body.message, anotherPatient.body.message, colleagues.body.message]).size).toBe(1);

      // admin may link any note of this patient, but not another patient's
      await rx(mine, adminCookie).expect(201);
      await rx(otherPatientsNote, adminCookie).expect(400);

      // and a referral is checked the same way
      const ref = (id: string, cookie = cookieA) => http().post(`/v1/patients/${patientId}/referrals`).set("Cookie", cookie)
        .send({ type: "external", externalProviderName: "Dr. Externo", reason: "avaliação", clinicalNoteId: id });
      await ref(mine).expect(201);
      await ref(mine, cookieB).expect(400);
      await ref(otherPatientsNote).expect(400);
    });
  });

  describe("internal referrals and their status", () => {
    let patientId: string;
    beforeAll(async () => { patientId = await createPatient("referral"); });
    const refer = (cookie: string, body: object) => http().post(`/v1/patients/${patientId}/referrals`).set("Cookie", cookie).send({ reason: "segunda opinião", ...body });
    const setStatus = (cookie: string, id: string, status: string) => http().patch(`/v1/referrals/${id}/status`).set("Cookie", cookie).send({ status });

    it("the target must be an active doctor (or admin) other than the referrer", async () => {
      await refer(cookieA, { type: "internal", targetStaffId: doctorA.id }).expect(400); // yourself
      await refer(cookieA, { type: "internal", targetStaffId: nurseId }).expect(400); // couldn't open it
      await refer(cookieA, { type: "internal", targetStaffId: "00000000-0000-4000-8000-0000000000bb" }).expect(400); // doesn't exist
      const ok = await refer(cookieA, { type: "internal", targetStaffId: doctorB.id }).expect(201);
      expect(ok.body).toMatchObject({ type: "internal", targetStaffId: doctorB.id, status: "pending", targetStaff: { fullName: "AG1 IT Doctor B" } });
    });

    it("an external referral never stores a target (it would show the referral to someone it wasn't addressed to)", async () => {
      const ext = await refer(cookieA, { type: "external", externalProviderName: "Dr. Externo", targetStaffId: doctorB.id }).expect(201);
      expect(ext.body.targetStaffId).toBeNull();
      expect((await http().get(`/v1/patients/${patientId}/referrals`).set("Cookie", cookieB).expect(200)).body.map((r: { id: string }) => r.id)).not.toContain(ext.body.id);
    });

    it("status follows the rules: the target moves it forward, completed is final, a declined one can only be re-opened, admin can correct", async () => {
      const ref = (await refer(cookieA, { type: "internal", targetStaffId: doctorB.id }).expect(201)).body;

      expect((await setStatus(cookieB, ref.id, "scheduled").expect(200)).body.status).toBe("scheduled");
      await setStatus(cookieB, ref.id, "scheduled").expect(200); // a double click is a no-op, not an error
      await setStatus(cookieB, ref.id, "completed").expect(200);

      const refused = await setStatus(cookieB, ref.id, "pending").expect(400);
      expect(refused.body.message).toMatch(/completed.*pending/);
      await setStatus(cookieA, ref.id, "declined").expect(400); // the referrer is bound by the same table
      expect((await setStatus(adminCookie, ref.id, "pending").expect(200)).body.status).toBe("pending"); // admin corrects

      await setStatus(cookieA, ref.id, "declined").expect(200);
      await setStatus(cookieA, ref.id, "completed").expect(400); // declined → only pending
      await setStatus(cookieA, ref.id, "pending").expect(200); // re-opened

      // an uninvolved doctor still gets the usual 404 (this is the file's 4th and last login)
      const third = await createStaff("Doctor C", "doctor");
      await setStatus(await loginAs(third.email, PASSWORD), ref.id, "scheduled").expect(404);
    });
  });

  // ─── list paging ───────────────────────────────────────────────────────────────────────────────────────

  describe("the per-patient lists are bounded pages, newest first, still plain arrays", () => {
    it("notes, prescriptions and referrals page with ?page&limit; limit is capped at 100", async () => {
      const patientId = await createPatient("paging");
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await noteOf(cookieA, patientId, { ...FULL, presentingConcerns: `n${i}` }).expect(201)).body.id);
        await http().post(`/v1/patients/${patientId}/prescriptions`).set("Cookie", cookieA).send(RX).expect(201);
        await http().post(`/v1/patients/${patientId}/referrals`).set("Cookie", cookieA).send({ type: "external", externalProviderName: `Dr. ${i}`, reason: "avaliação" }).expect(201);
      }
      const newestFirst = [...ids].reverse();

      for (const path of ["clinical-notes", "prescriptions", "referrals"]) {
        const url = (qs: string) => http().get(`/v1/patients/${patientId}/${path}${qs}`).set("Cookie", cookieA);
        const all = (await url("").expect(200)).body as Array<{ id: string; presentingConcerns?: string }>;
        expect(all).toHaveLength(3);
        const page1 = (await url("?limit=2").expect(200)).body as Array<{ id: string }>;
        const page2 = (await url("?limit=2&page=2").expect(200)).body as Array<{ id: string }>;
        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(1);
        expect([...page1, ...page2].map((r) => r.id)).toEqual(all.map((r) => r.id)); // stable, no gaps, no repeats
        await url("?limit=101").expect(400);
        await url("?page=0").expect(400);
        await url("?page=1000000").expect(400);
        if (path === "clinical-notes") expect(all.map((n) => n.id)).toEqual(newestFirst);
      }
    });

    it("a doctor's page holds only what they may see: a colleague's notes don't shrink it or leak into it", async () => {
      const patientId = await createPatient("paging-scope");
      await noteOf(cookieA, patientId).expect(201);
      const bs = [(await noteOf(cookieB, patientId).expect(201)).body.id, (await noteOf(cookieB, patientId).expect(201)).body.id];
      const page = (await http().get(`/v1/patients/${patientId}/clinical-notes?limit=2`).set("Cookie", cookieB).expect(200)).body as Array<{ id: string }>;
      expect(page.map((n) => n.id)).toEqual([...bs].reverse()); // B's two notes fill the page; A's newer-or-older note is not in it
      expect((await http().get(`/v1/patients/${patientId}/clinical-notes?limit=2&page=2`).set("Cookie", cookieB).expect(200)).body).toHaveLength(0);
    });
  });

  describe("GET /clinical-notes filters", () => {
    it("an impossible calendar day is a 400, not a 500", async () => {
      await http().get("/v1/clinical-notes?from=2026-13-45").set("Cookie", cookieA).expect(400);
      await http().get("/v1/clinical-notes?to=2026-02-30").set("Cookie", cookieA).expect(400);
      await http().get("/v1/clinical-notes?from=2026-02-28&to=2026-03-01").set("Cookie", cookieA).expect(200);
    });
  });
});
