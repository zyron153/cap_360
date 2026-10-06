import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** authBypass:false — the point is real doctors with real sessions: the bypass would make every caller
 * the admin and prove nothing about who may read what.
 *
 * /auth/login is throttled to 5/min per IP (see AuthController), so this file logs in exactly three
 * times (admin + two doctors). It is the live proof of the clinical-note access model
 * (`Docs/modules/M7-clinical-records-emr.md` §3, §3.1) and of the lost-update guard (§2.1). */
describe("Clinical notes: authorship, the 'treating today' read exception, and the lost-update guard (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let cookieA: string;
  let cookieB: string;
  let doctorA: { id: string };
  let doctorB: { id: string };
  let patientId: string;
  const extraPatientIds: string[] = [];
  let serviceId: string;
  let treatedApptId: string; // the appointment whose status we flip to open/close the "treating today" window
  let bookedApptId: string; // tomorrow's appointment — only used to test the one-note-per-appointment rule

  const stamp = Date.now();
  const PASSWORD = "Doctor-Pass1";
  const http = () => request(app.getHttpServer());
  const FULL = { sessionType: "individual", presentingConcerns: "q", observations: "o", assessment: "a", plan: "p" };

  const loginAs = async (email: string, password: string) =>
    (await http().post("/v1/auth/login").send({ email, password }).expect(200)).headers["set-cookie"][0] as string;
  const createDoctor = async (tag: string) => {
    const email = `it-note-${tag}-${stamp}@cap.cv`;
    const res = await http().post("/v1/staff").set("Cookie", adminCookie).send({ fullName: `IT Doctor ${tag}`, email, role: "doctor", password: PASSWORD }).expect(201);
    return { id: res.body.id as string, email };
  };
  const bookAppointment = (staffId: string, scheduledAt: Date, status: "checked_in" | "confirmed") =>
    prisma.appointment.create({ data: { patientId, staffId, serviceId, scheduledAt, durationMinutes: 30, status } }).then((a) => a.id);
  const notesFor = (cookie: string, forPatient = patientId) => http().get(`/v1/patients/${forPatient}/clinical-notes`).set("Cookie", cookie);
  /** A patient with one finalized note by doctor A — the thing doctor B is trying (or not) to read. */
  const patientWithANote = async (tag: string) => {
    const created = await http().post("/v1/patients").set("Cookie", adminCookie).send({
      fullName: `IT Note ${tag}`, dateOfBirth: "1990-02-02", gender: "male", phone: `+23896${String(Math.floor(10000 + Math.random() * 90000))}`, consentGiven: true,
    }).expect(201);
    extraPatientIds.push(created.body.id);
    await http().post(`/v1/patients/${created.body.id}/clinical-notes`).set("Cookie", cookieA).send(FULL).expect(201);
    return created.body.id as string;
  };
  const bookFor = (forPatient: string, status: "checked_in" | "confirmed") =>
    prisma.appointment.create({ data: { patientId: forPatient, staffId: doctorA.id, serviceId, scheduledAt: new Date(), durationMinutes: 30, status } }).then((a) => a.id);
  const setStatus = (cookie: string, appointmentId: string, status: string) =>
    http().patch(`/v1/appointments/${appointmentId}/status`).set("Cookie", cookie).send({ status }).expect(200);

  beforeAll(async () => {
    app = await createTestApp({ authBypass: false });
    prisma = app.get(PrismaService);

    adminCookie = await loginAs("capjacobvicente@gmail.com", "Teste@1234");
    const a = await createDoctor("a");
    const b = await createDoctor("b");
    doctorA = a;
    doctorB = b;
    cookieA = await loginAs(a.email, PASSWORD);
    cookieB = await loginAs(b.email, PASSWORD);

    const patient = await http().post("/v1/patients").set("Cookie", adminCookie).send({
      fullName: "IT Note Access", dateOfBirth: "1985-06-20", gender: "female", phone: `+23895${String(stamp).slice(-5)}`, consentGiven: true,
    }).expect(201);
    patientId = patient.body.id;
    serviceId = (await prisma.service.findFirstOrThrow()).id;

    treatedApptId = await bookAppointment(a.id, new Date(), "confirmed"); // today, but not yet in the office
    bookedApptId = await bookAppointment(a.id, new Date(Date.now() + 36 * 3_600_000), "confirmed");
  });

  afterAll(async () => {
    // Children first, and no .catch(): a leaked row must fail the run loudly (a swallowed error here once hid three
    // leaked "IT Note…" patients for a whole run).
    for (const id of [patientId, ...extraPatientIds]) {
      if (!id) continue;
      await prisma.clinicalNote.deleteMany({ where: { patientId: id } });
      // Completing an appointment auto-creates a draft invoice for it; the patient (and the appointment) can't go while it exists.
      await prisma.invoiceItem.deleteMany({ where: { invoice: { patientId: id } } });
      await prisma.invoice.deleteMany({ where: { patientId: id } });
      await prisma.appointment.deleteMany({ where: { patientId: id } });
      await prisma.patient.delete({ where: { id } });
    }
    for (const d of [doctorA, doctorB]) if (d) await prisma.staff.delete({ where: { id: d.id } });
    await app.close();
  });

  describe("who can read a colleague's note", () => {
    let finalNoteId: string;
    let draftNoteId: string;

    it("a doctor's own notes are theirs alone while the patient isn't in treatment", async () => {
      finalNoteId = (await http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).send(FULL).expect(201)).body.id;
      draftNoteId = (await http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).send({ ...FULL, plan: "", draft: true }).expect(201)).body.id;

      expect((await notesFor(cookieA).expect(200)).body).toHaveLength(2);
      expect((await notesFor(cookieB).expect(200)).body).toHaveLength(0);
      await http().get(`/v1/clinical-notes/${finalNoteId}`).set("Cookie", cookieB).expect(404);
    });

    it("…a booked-but-not-arrived appointment today opens nothing", async () => {
      expect((await notesFor(cookieB).expect(200)).body).toHaveLength(0);
    });

    it("once the patient is checked in today, a colleague reads the FINALIZED notes — never the draft", async () => {
      // reception (here: the admin) checks the patient in through the real endpoint, so the actor is recorded
      await http().patch(`/v1/appointments/${treatedApptId}/status`).set("Cookie", adminCookie).send({ status: "checked_in" }).expect(200);

      const res = await notesFor(cookieB).expect(200);
      expect(res.body.map((n: { id: string }) => n.id)).toEqual([finalNoteId]);
      await http().get(`/v1/clinical-notes/${finalNoteId}`).set("Cookie", cookieB).expect(200);
      await http().get(`/v1/clinical-notes/${draftNoteId}`).set("Cookie", cookieB).expect(404);
    });

    it("…read-only: updating the colleague's note is still a 404, and 'my notes' stays strictly mine", async () => {
      await http().patch(`/v1/clinical-notes/${finalNoteId}`).set("Cookie", cookieB).send({ plan: "hijack" }).expect(404);
      expect((await http().get("/v1/clinical-notes").set("Cookie", cookieB).expect(200)).body).toHaveLength(0);
      expect((await http().get(`/v1/clinical-notes/${finalNoteId}`).set("Cookie", cookieA).expect(200)).body.plan).toBe("p"); // untouched
    });

    it("…and the read is audit-marked, so cross-author reads can be told apart", async () => {
      let row: { metadata: unknown } | undefined;
      for (let i = 0; i < 20 && !row; i++) {
        const rows = await prisma.auditLog.findMany({ where: { actorId: doctorB.id, resource: "patients" }, orderBy: { createdAt: "desc" }, take: 10 });
        row = rows.find((r) => JSON.stringify(r.metadata).includes("patient in treatment today"));
        if (!row) await new Promise((r) => setTimeout(r, 250)); // the audit write is fire-and-forget
      }
      expect(row).toBeDefined(); // an audit_log row marking the cross-author read
    });

    it("a completed appointment today still counts as in treatment; a status that isn't checked-in/completed does not", async () => {
      await prisma.appointment.update({ where: { id: treatedApptId }, data: { status: "completed" } });
      expect((await notesFor(cookieB).expect(200)).body).toHaveLength(1);

      await prisma.appointment.update({ where: { id: treatedApptId }, data: { status: "confirmed" } });
      expect((await notesFor(cookieB).expect(200)).body).toHaveLength(0);
    });

    it("yesterday's checked-in appointment opens nothing (the window is today, Cabo Verde time)", async () => {
      await prisma.appointment.update({ where: { id: treatedApptId }, data: { status: "checked_in", scheduledAt: new Date(Date.now() - 30 * 3_600_000) } });
      expect((await notesFor(cookieB).expect(200)).body).toHaveLength(0);
    });
  });

  describe("who put the patient in treatment matters — a doctor can't unlock a patient by checking them in themself", () => {
    it("B checking the patient in, and completing it, is not enough: B still can't read A's note", async () => {
      const p = await patientWithANote("self");
      const appt = await bookFor(p, "confirmed");

      await setStatus(cookieB, appt, "checked_in");
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(0);

      await setStatus(cookieB, appt, "completed");
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(0);
      expect((await notesFor(cookieA, p).expect(200)).body).toHaveLength(1); // the author is unaffected
    });

    it("…but once someone else is involved — reception completes it — B can read", async () => {
      const p = await patientWithANote("shared");
      const appt = await bookFor(p, "confirmed");

      await setStatus(cookieB, appt, "checked_in");
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(0);

      await setStatus(adminCookie, appt, "completed");
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(1);
    });

    it("B completing straight from 'confirmed' (no check-in at all) is also B's own doing: nothing unlocks", async () => {
      const p = await patientWithANote("selfcomplete");
      const appt = await bookFor(p, "confirmed");
      await setStatus(cookieB, appt, "completed");
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(0);
    });

    it("an appointment whose actor is unknown (a system action, or from before actors were recorded) still qualifies", async () => {
      const p = await patientWithANote("legacy");
      await bookFor(p, "checked_in"); // created straight in the DB: no actor columns
      expect((await notesFor(cookieB, p).expect(200)).body).toHaveLength(1);
    });
  });

  describe("two saves of the same note", () => {
    it("a save carrying the version the caller saw lands; a stale one is a 409 carrying the current note", async () => {
      const created = (await http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).send({ ...FULL, presentingConcerns: "v1", draft: true }).expect(201)).body;

      const saved = await http().patch(`/v1/clinical-notes/${created.id}`).set("Cookie", cookieA)
        .send({ presentingConcerns: "v2", draft: true, expectedUpdatedAt: created.updatedAt }).expect(200);
      expect(saved.body.updatedAt).not.toBe(created.updatedAt);

      const stale = await http().patch(`/v1/clinical-notes/${created.id}`).set("Cookie", cookieA)
        .send({ presentingConcerns: "stale write", draft: true, expectedUpdatedAt: created.updatedAt }).expect(409);
      expect(stale.body).toMatchObject({ code: "NOTE_CHANGED", note: { id: created.id, presentingConcerns: "v2" } });
      expect((await http().get(`/v1/clinical-notes/${created.id}`).set("Cookie", cookieA).expect(200)).body.presentingConcerns).toBe("v2");
    });

    it("two saves racing on the same version: exactly one wins (the check and the write are one statement)", async () => {
      const created = (await http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA).send({ ...FULL, draft: true }).expect(201)).body;
      const save = (text: string) => http().patch(`/v1/clinical-notes/${created.id}`).set("Cookie", cookieA)
        .send({ presentingConcerns: text, draft: true, expectedUpdatedAt: created.updatedAt });

      const [x, y] = await Promise.all([save("from tab 1"), save("from tab 2")]);

      expect([x.status, y.status].sort()).toEqual([200, 409]);
      const winner = x.status === 200 ? "from tab 1" : "from tab 2";
      // (the column is stored encrypted, so read it back through the API, which decrypts)
      expect((await http().get(`/v1/clinical-notes/${created.id}`).set("Cookie", cookieA).expect(200)).body.presentingConcerns).toBe(winner);
    });

    it("six simultaneous first-saves for one appointment: one note is created, the other five are told it exists", async () => {
      const post = (i: number) => http().post(`/v1/patients/${patientId}/clinical-notes`).set("Cookie", cookieA)
        .send({ ...FULL, presentingConcerns: `tab ${i}`, draft: true, appointmentId: bookedApptId });

      const results = await Promise.all([0, 1, 2, 3, 4, 5].map(post));

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const conflicts = results.filter((r) => r.status === 409);
      expect(conflicts).toHaveLength(5);
      for (const c of conflicts) expect(c.body).toMatchObject({ code: "NOTE_CHANGED", note: { appointmentId: bookedApptId } });
      expect(await prisma.clinicalNote.count({ where: { appointmentId: bookedApptId, authorStaffId: doctorA.id } })).toBe(1);
    });
  });
});
