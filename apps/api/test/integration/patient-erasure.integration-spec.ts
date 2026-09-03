import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

describe("Patients — create then right-to-erasure (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let patientId: string;
  // Cabo Verde numbers are +238 plus exactly 7 local digits (see PatientsService.normalizePhone).
  const phone = `+238${String(Date.now() % 10_000_000).padStart(7, "0")}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (patientId) await prisma.patient.delete({ where: { id: patientId } });
    await app.close();
  });

  it("creates a patient over real HTTP, storing encrypted PII that round-trips on read", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/patients")
      .send({
        fullName: "Integration Test Patient — erasure",
        dateOfBirth: "1990-01-01",
        gender: "male",
        phone,
        consentGiven: true,
      })
      .expect(201);

    patientId = created.body.id;
    expect(created.body.fullName).toBe("Integration Test Patient — erasure");
    expect(created.body.dateOfBirth).toBe("1990-01-01");

    const fetched = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}`)
      .expect(200);
    expect(fetched.body.phone).toBe(phone);
  });

  it("scrubs PII and blocks normal lookup once erased, while the row itself survives for audit history", async () => {
    await request(app.getHttpServer())
      .delete(`/v1/patients/${patientId}`)
      .expect(204);

    // The service's own read path treats an erased patient as gone.
    await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}`)
      .expect(404);

    // But the row itself is retained (not hard-deleted) with PII actually scrubbed at rest —
    // checked directly against the DB since the service layer won't return it anymore.
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.fullName).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.dateOfBirth).toBeNull();
  });
});
