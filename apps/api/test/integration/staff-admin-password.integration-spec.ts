import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** authBypass:false — the point of this spec is proving the real login/session pipeline with
 * admin-set passwords end-to-end, so every login below goes through the real endpoint rather than
 * the AUTH_BYPASS shortcut every other integration spec relies on.
 *
 * /auth/login is throttled to 5/min per IP (see AuthController), so this file keeps to 4 logins
 * (admin, new user, old-password attempt, new-password login) and reuses sessions otherwise. */
describe("Admin sets a user's password: create → login → 'Alterar senha' (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let newStaffId: string;
  const email = `it-admin-pw-${Date.now()}@cap.cv`;
  const FIRST_PASSWORD = "Chosen-Pass1";
  const SECOND_PASSWORD = "Another-Pass2";

  const http = () => request(app.getHttpServer());
  const login = (password: string) => http().post("/v1/auth/login").send({ email, password });

  beforeAll(async () => {
    app = await createTestApp({ authBypass: false });
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "capjacobvicente@gmail.com", password: "Teste@1234" })
      .expect(200);
    adminCookie = res.headers["set-cookie"][0];
  });

  afterAll(async () => {
    if (newStaffId) await prisma.staff.delete({ where: { id: newStaffId } }).catch(() => {});
    await app.close();
  });

  let userCookie: string;

  it("rejects a password that breaks the policy, creating nothing", async () => {
    const weak = await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "Weak Password", email, role: "receptionist", password: "short1A" })
      .expect(400);
    expect(JSON.stringify(weak.body)).toContain("password");
    expect(await prisma.staff.count({ where: { email } })).toBe(0);

    // The password is required — there's no generated fallback any more.
    await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "No Password", email, role: "receptionist" })
      .expect(400);
  });

  it("creates the user with the password the admin chose; only its hash is stored", async () => {
    const res = await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "Integration Admin Password", email, role: "receptionist", password: FIRST_PASSWORD })
      .expect(201);

    expect(res.body).toMatchObject({ fullName: "Integration Admin Password", email, role: "receptionist" });
    expect(JSON.stringify(res.body)).not.toContain(FIRST_PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    newStaffId = res.body.id;

    const row = await prisma.staff.findUniqueOrThrow({ where: { id: newStaffId } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(FIRST_PASSWORD);
  });

  it("rejects creating a second user with the same email", async () => {
    await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "Duplicate", email, role: "receptionist", password: FIRST_PASSWORD })
      .expect(409);
  });

  it("lets the new user log in with that password and straight into the app (no forced change)", async () => {
    const res = await login(FIRST_PASSWORD).expect(200);
    expect(res.body.staff).toMatchObject({ email, role: "receptionist" });
    expect(res.body.staff).not.toHaveProperty("mustChangePassword");
    userCookie = res.headers["set-cookie"][0];

    await http().get("/v1/staff/me").set("Cookie", userCookie).expect(200);
    await http().get("/v1/staff").set("Cookie", userCookie).expect(200);
  });

  it("rejects a weak password when an admin changes someone's password, leaving their session intact", async () => {
    await http()
      .patch(`/v1/staff/${newStaffId}/password`)
      .set("Cookie", adminCookie)
      .send({ password: "tooshort" })
      .expect(400);
    await http().get("/v1/staff").set("Cookie", userCookie).expect(200);
  });

  it("an admin's 'Alterar senha' replaces the password and ends the user's open session", async () => {
    const res = await http()
      .patch(`/v1/staff/${newStaffId}/password`)
      .set("Cookie", adminCookie)
      .send({ password: SECOND_PASSWORD })
      .expect(200);
    expect(res.body).toEqual({ sessionsEnded: 1 });

    // The session they already had is gone at once…
    await http().get("/v1/staff").set("Cookie", userCookie).expect(401);

    // …the old password no longer works, and the new one does.
    await login(FIRST_PASSWORD).expect(401);
    const relogin = await login(SECOND_PASSWORD).expect(200);
    userCookie = relogin.headers["set-cookie"][0];
    await http().get("/v1/staff").set("Cookie", userCookie).expect(200);
  });

  it("returns 404 for an unknown user", async () => {
    await http()
      .patch("/v1/staff/00000000-0000-4000-8000-000000000000/password")
      .set("Cookie", adminCookie)
      .send({ password: SECOND_PASSWORD })
      .expect(404);
  });

  it("only admins can create users or change other users' passwords", async () => {
    await http()
      .post("/v1/staff")
      .set("Cookie", userCookie)
      .send({ fullName: "Nope", email: `nope-${Date.now()}@cap.cv`, role: "receptionist", password: FIRST_PASSWORD })
      .expect(403);
    await http()
      .patch(`/v1/staff/${newStaffId}/password`)
      .set("Cookie", userCookie)
      .send({ password: FIRST_PASSWORD })
      .expect(403);
  });
});
