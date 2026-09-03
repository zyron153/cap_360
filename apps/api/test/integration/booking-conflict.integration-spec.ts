import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** ~2 weeks out, nudged off any weekend — clear of the seeded appointments (all in the past
 * relative to "today") and of Cabo Verde's public holidays (fixed calendar dates, none fall in
 * this window for years to come). */
function futureWeekdaySlot(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat -> Mon
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun -> Mon
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe("Appointments — booking conflict (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let patientId: string;
  let staffId: string;
  let serviceId: string;
  const appointmentIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: "dr.silva@cap.cv" } });
    staffId = staff.id;
    const service = await prisma.service.findUniqueOrThrow({ where: { code: "CONS-GERAL" } });
    serviceId = service.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: "Integration Test Patient — booking-conflict",
        gender: "female",
        phone: `+238${String(Date.now() % 10_000_000).padStart(7, "0")}`,
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    if (appointmentIds.length) {
      await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    }
    await prisma.patient.delete({ where: { id: patientId } });
    await app.close();
  });

  it("books the first request, then rejects a same-staff overlapping request with 409", async () => {
    const scheduledAt = futureWeekdaySlot(10).toISOString();

    const first = await request(app.getHttpServer())
      .post("/v1/appointments")
      .send({ patientId, staffId, serviceId, scheduledAt, source: "web" })
      .expect(201);
    appointmentIds.push(first.body.id);

    await request(app.getHttpServer())
      .post("/v1/appointments")
      .send({ patientId, staffId, serviceId, scheduledAt, source: "web" })
      .expect(409);
  });

  it("allows the same staff to book a different, non-overlapping slot", async () => {
    const scheduledAt = futureWeekdaySlot(11).toISOString();

    const res = await request(app.getHttpServer())
      .post("/v1/appointments")
      .send({ patientId, staffId, serviceId, scheduledAt, source: "web" })
      .expect(201);
    appointmentIds.push(res.body.id);
  });
});
