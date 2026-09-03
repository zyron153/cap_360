import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** authBypass:false — the point of this spec is proving the real login/session pipeline works
 * end-to-end (activation sets a real argon2id hash; login must verify it and issue a real
 * session), so both logins below go through the real endpoint rather than the AUTH_BYPASS
 * shortcut every other integration spec relies on. */
describe("Staff invitation → activation → login (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let newStaffId: string;
  let invitationEmail: string;

  beforeAll(async () => {
    app = await createTestApp({ authBypass: false });
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "capjacobvicente@gmail.com", password: "Teste@1234" })
      .expect(200);
    adminCookie = login.headers["set-cookie"][0];
  });

  afterAll(async () => {
    if (newStaffId) await prisma.staff.delete({ where: { id: newStaffId } }).catch(() => {});
    if (invitationEmail) {
      await prisma.staffInvitation.deleteMany({ where: { email: invitationEmail } });
    }
    await app.close();
  });

  it("lets a newly-activated invitee log in and reach a protected route with the real session", async () => {
    invitationEmail = `it-invite-${Date.now()}@cap.cv`;

    await request(app.getHttpServer())
      .post("/v1/staff/invite")
      .set("Cookie", adminCookie)
      .send({ fullName: "Integration Test Receptionist", email: invitationEmail, role: "receptionist" })
      .expect(201);

    // The invitation token is deliberately never returned over the API (whoever holds it can
    // activate the account) — it only ever reaches the real invitee by email, so a test has to
    // read it straight from the row it just caused to be written, same as a person would read
    // it from their inbox.
    const invitation = await prisma.staffInvitation.findFirstOrThrow({
      where: { email: invitationEmail },
    });

    const activation = await request(app.getHttpServer())
      .post(`/v1/public/invitations/${invitation.token}/activate`)
      .send({ fullName: "Integration Test Receptionist", password: "S3curePass!" })
      .expect(201);
    newStaffId = activation.body.id;

    const staffLogin = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: invitationEmail, password: "S3curePass!" })
      .expect(200);
    expect(staffLogin.body.staff).toMatchObject({ email: invitationEmail, role: "receptionist" });
    const staffCookie = staffLogin.headers["set-cookie"][0];

    const me = await request(app.getHttpServer())
      .get("/v1/staff/me")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(me.body).toMatchObject({ id: newStaffId, email: invitationEmail, role: "receptionist" });
  });

  it("reuses the invitation token once already accepted", async () => {
    const invitation = await prisma.staffInvitation.findFirstOrThrow({
      where: { email: invitationEmail },
    });

    await request(app.getHttpServer())
      .post(`/v1/public/invitations/${invitation.token}/activate`)
      .send({ fullName: "Second Attempt", password: "AnotherPass1" })
      .expect(404);
  });
});
