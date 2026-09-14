import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

/** ~3 weeks out, nudged off any weekend — same reasoning as booking-conflict.integration-spec.ts's
 * own helper: clear of business-hours/availability rejections a same-day or weekend slot could hit. */
function futureWeekdaySlot(hour: number, daysOut = 21): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat -> Mon
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun -> Mon
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe("Health Plans — renewal (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;
  let deactivatedProductId: string;
  let companyId: string;
  const planIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const suffix = Date.now();
    const company = await prisma.company.create({
      data: { name: `Integration Renewal Co ${suffix}`, taxId: `IRC-${suffix}` },
    });
    companyId = company.id;

    const product = await prisma.healthPlanProduct.create({
      data: {
        name: `Integration Renewal Product ${suffix}`,
        code: `IRP-${suffix}`,
        monthlyFee: 5000,
        durationMonths: 12,
      },
    });
    productId = product.id;

    const deactivatedProduct = await prisma.healthPlanProduct.create({
      data: {
        name: `Integration Renewal Deactivated ${suffix}`,
        code: `IRPD-${suffix}`,
        monthlyFee: 3000,
        durationMonths: 1,
        active: false,
      },
    });
    deactivatedProductId = deactivatedProduct.id;
  });

  afterAll(async () => {
    if (planIds.length > 0) {
      await prisma.healthPlan.deleteMany({ where: { id: { in: planIds } } });
    }
    await prisma.healthPlanProduct.delete({ where: { id: productId } });
    await prisma.healthPlanProduct.delete({ where: { id: deactivatedProductId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  it("extends endDate by the product's durationMonths and reactivates a lapsed plan", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, companyId, startDate: "2020-01-01", endDate: "2020-12-31" })
      .expect(201);
    planIds.push(created.body.id);
    expect(created.body.active).toBe(true);

    // Force it into a lapsed state directly — createPlan doesn't compute `active` from endDate.
    await prisma.healthPlan.update({ where: { id: created.body.id }, data: { active: false } });

    const renewed = await request(app.getHttpServer())
      .post(`/v1/health-plans/${created.body.id}/renew`)
      .expect(201);

    expect(renewed.body.active).toBe(true);
    const newEndDate = new Date(renewed.body.endDate);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const expected = new Date(Date.UTC(todayUtc.getUTCFullYear() + 1, todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
    expect(newEndDate.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  it("rejects renewing a plan whose product has been deactivated", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId: deactivatedProductId, companyId, startDate: "2026-01-01" })
      .expect(201);
    planIds.push(created.body.id);

    await request(app.getHttpServer())
      .post(`/v1/health-plans/${created.body.id}/renew`)
      .expect(400);
  });

  it("404s renewing a plan that doesn't exist", async () => {
    await request(app.getHttpServer())
      .post("/v1/health-plans/00000000-0000-0000-0000-000000000000/renew")
      .expect(404);
  });

  describe("session lifecycle", () => {
    let sessionProductId: string;
    let sessionPatientId: string;
    let staffId: string;
    let serviceId: string;
    const appointmentIds: string[] = [];

    beforeAll(async () => {
      const suffix = Date.now();
      const product = await prisma.healthPlanProduct.create({
        data: {
          name: `Integration Session Product ${suffix}`,
          code: `ISP-${suffix}`,
          monthlyFee: 5000,
          durationMonths: 1,
          sessionsPerCycle: 2,
        },
      });
      sessionProductId = product.id;

      const staff = await prisma.staff.findUniqueOrThrow({ where: { email: "dr.silva@cap.cv" } });
      staffId = staff.id;
      const service = await prisma.service.findUniqueOrThrow({ where: { code: "CONS-GERAL" } });
      serviceId = service.id;

      const patient = await prisma.patient.create({
        data: {
          fullName: "Integration Test Patient — session-lifecycle",
          gender: "female",
          phone: `+238${String(Date.now() % 10_000_000).padStart(7, "0")}`,
          consentGiven: true,
          consentGivenAt: new Date(),
        },
      });
      sessionPatientId = patient.id;
    });

    afterAll(async () => {
      if (appointmentIds.length) {
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      }
      // Membership rows, and the invoice the completed appointment auto-drafted, both reference
      // this patient with no cascade-on-patient-delete — must go first, ahead of the outer
      // describe's own afterAll (which deletes the plans themselves, including this one via
      // `planIds`, but runs later since Jest unwinds nested afterAlls innermost-first).
      await prisma.healthPlanMember.deleteMany({ where: { patientId: sessionPatientId } });
      await prisma.invoice.deleteMany({ where: { patientId: sessionPatientId } });
      await prisma.patient.delete({ where: { id: sessionPatientId } });
      // The session-lifecycle plan itself is also in the shared `planIds` array, but the outer
      // describe's afterAll (which sweeps that array) runs after this one — delete it here too so
      // the product FK is free by the time this afterAll deletes the product.
      await prisma.healthPlan.deleteMany({ where: { productId: sessionProductId } });
      await prisma.healthPlanProduct.delete({ where: { id: sessionProductId } });
    });

    it("drains the shared session pool on a completed appointment, then refills it on renew", async () => {
      const plan = await request(app.getHttpServer())
        .post("/v1/health-plans")
        .send({ productId: sessionProductId, startDate: "2026-01-01", memberPatientIds: [sessionPatientId] })
        .expect(201);
      planIds.push(plan.body.id);
      expect(plan.body.sessionsRemaining).toBe(2);

      const scheduledAt = futureWeekdaySlot(10);
      const appt = await request(app.getHttpServer())
        .post("/v1/appointments")
        .send({ patientId: sessionPatientId, staffId, serviceId, scheduledAt: scheduledAt.toISOString(), source: "web" })
        .expect(201);
      appointmentIds.push(appt.body.id);

      await request(app.getHttpServer())
        .patch(`/v1/appointments/${appt.body.id}/status`)
        .send({ status: "completed" })
        .expect(200);

      const afterCompletion = await request(app.getHttpServer())
        .get(`/v1/health-plans/${plan.body.id}`)
        .expect(200);
      expect(afterCompletion.body.sessionsRemaining).toBe(1);

      const renewed = await request(app.getHttpServer())
        .post(`/v1/health-plans/${plan.body.id}/renew`)
        .expect(201);
      expect(renewed.body.sessionsRemaining).toBe(2);
    });
  });
});
