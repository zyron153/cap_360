import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** authBypass:false — the point of this spec is proving the real login/session pipeline enforces
 * the temporary-password rule end-to-end, so every login below goes through the real endpoint
 * rather than the AUTH_BYPASS shortcut every other integration spec relies on. */
describe("Admin-created user → temporary password → forced change (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let newStaffId: string;
  const email = `it-temp-pw-${Date.now()}@cap.cv`;
  const NEW_PASSWORD = "MyOwnPass123";

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

  let temporaryPassword: string;
  let userCookie: string;

  it("creating a user returns a one-time temporary password and sends no invitation", async () => {
    const res = await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "Integration Temp Password", email, role: "receptionist" })
      .expect(201);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ fullName: "Integration Temp Password", email });
    expect(res.body.temporaryPassword).toMatch(/^(?=.*[A-Z])(?=.*\d).{10,}$/);
    newStaffId = res.body.staffId;
    temporaryPassword = res.body.temporaryPassword;

    // Only the hash is persisted — never the plaintext.
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: newStaffId } });
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash).not.toContain(temporaryPassword);
  });

  it("rejects creating a second user with the same email", async () => {
    await http()
      .post("/v1/staff")
      .set("Cookie", adminCookie)
      .send({ fullName: "Duplicate", email, role: "receptionist" })
      .expect(409);
  });

  it("logs in with the temporary password and is told a change is required", async () => {
    const res = await login(temporaryPassword).expect(200);
    expect(res.body.staff).toMatchObject({ email, mustChangePassword: true });
    userCookie = res.headers["set-cookie"][0];
  });

  it("blocks every route except profile + change-password until the password is changed", async () => {
    const me = await http().get("/v1/staff/me").set("Cookie", userCookie).expect(200);
    expect(me.body).toMatchObject({ id: newStaffId, mustChangePassword: true });

    const blocked = await http().get("/v1/staff").set("Cookie", userCookie).expect(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("refuses a 'new' password identical to the temporary one", async () => {
    await http()
      .patch("/v1/staff/me/password")
      .set("Cookie", userCookie)
      .send({ currentPassword: temporaryPassword, newPassword: temporaryPassword })
      .expect(400);
  });

  it("changing the password lifts the restriction on the same session", async () => {
    await http()
      .patch("/v1/staff/me/password")
      .set("Cookie", userCookie)
      .send({ currentPassword: temporaryPassword, newPassword: NEW_PASSWORD })
      .expect(200);

    await http().get("/v1/staff").set("Cookie", userCookie).expect(200);
    const res = await login(NEW_PASSWORD).expect(200);
    expect(res.body.staff.mustChangePassword).toBe(false);
  });

  // NOTE: /auth/login is throttled to 5/min per IP (see AuthController), and this file already
  // used 3 logins (admin, temporary, new password) — so everything below reuses sessions instead
  // of logging in again.
  let resetPassword: string;
  let resetCookie: string;

  it("an admin reset issues a new temporary password and locks out the user's open session", async () => {
    const res = await http().post(`/v1/staff/${newStaffId}/reset-password`).set("Cookie", adminCookie).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    resetPassword = res.body.temporaryPassword as string;
    expect(resetPassword).not.toBe(temporaryPassword);

    // The session the user already had is cut off at once (the guard re-reads the flag per
    // request), and the account is flagged again.
    const blocked = await http().get("/v1/staff").set("Cookie", userCookie).expect(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // The new temporary password forces another change.
    const relogin = await login(resetPassword).expect(200);
    expect(relogin.body.staff.mustChangePassword).toBe(true);
    resetCookie = relogin.headers["set-cookie"][0];
  });

  it("only admins can create users or reset passwords", async () => {
    await http()
      .patch("/v1/staff/me/password")
      .set("Cookie", resetCookie)
      .send({ currentPassword: resetPassword, newPassword: NEW_PASSWORD })
      .expect(200);

    await http().post("/v1/staff").set("Cookie", resetCookie)
      .send({ fullName: "Nope", email: `nope-${Date.now()}@cap.cv`, role: "receptionist" }).expect(403);
    await http().post(`/v1/staff/${newStaffId}/reset-password`).set("Cookie", resetCookie).expect(403);
  });
});
