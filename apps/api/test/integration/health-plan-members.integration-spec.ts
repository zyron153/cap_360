import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

describe("Health Plans — members (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productId: string;
  let cappedProductId: string;
  const planIds: string[] = [];
  const patientIds: string[] = [];

  async function createPatient(label: string) {
    const patient = await prisma.patient.create({
      data: {
        fullName: `Integration Test Patient — ${label}`,
        gender: "female",
        phone: `+238${String((Date.now() + Math.floor(Math.random() * 10_000)) % 10_000_000).padStart(7, "0")}`,
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    });
    patientIds.push(patient.id);
    return patient.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const suffix = Date.now();
    const product = await prisma.healthPlanProduct.create({
      data: { name: `Integration Members Product ${suffix}`, code: `IMP-${suffix}`, monthlyFee: 5000 },
    });
    productId = product.id;

    const cappedProduct = await prisma.healthPlanProduct.create({
      data: { name: `Integration Members Capped ${suffix}`, code: `IMPC-${suffix}`, monthlyFee: 3000, maxMembers: 1 },
    });
    cappedProductId = cappedProduct.id;
  });

  afterAll(async () => {
    if (planIds.length > 0) {
      await prisma.healthPlanMember.deleteMany({ where: { healthPlanId: { in: planIds } } });
      await prisma.healthPlan.deleteMany({ where: { id: { in: planIds } } });
    }
    await prisma.healthPlanProduct.delete({ where: { id: productId } });
    await prisma.healthPlanProduct.delete({ where: { id: cappedProductId } });
    if (patientIds.length > 0) {
      await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    }
    await app.close();
  });

  it("adds a member to an existing plan and reflects it in the plan response", async () => {
    const patientId = await createPatient("add-member");
    const plan = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01" })
      .expect(201);
    planIds.push(plan.body.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/health-plans/${plan.body.id}/members`)
      .send({ patientId })
      .expect(201);

    expect(res.body.members).toEqual([
      expect.objectContaining({ patientId }),
    ]);
  });

  it("404s adding a member to a plan that doesn't exist", async () => {
    const patientId = await createPatient("ghost-plan");
    await request(app.getHttpServer())
      .post("/v1/health-plans/00000000-0000-0000-0000-000000000000/members")
      .send({ patientId })
      .expect(404);
  });

  it("409s adding a patient who is already an active member of a (different) plan", async () => {
    const patientId = await createPatient("dup-active");
    const planA = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01", memberPatientIds: [patientId] })
      .expect(201);
    planIds.push(planA.body.id);

    const planB = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01" })
      .expect(201);
    planIds.push(planB.body.id);

    await request(app.getHttpServer())
      .post(`/v1/health-plans/${planB.body.id}/members`)
      .send({ patientId })
      .expect(409);
  });

  it("400s adding a member that would exceed the product's maxMembers", async () => {
    const first = await createPatient("cap-first");
    const second = await createPatient("cap-second");
    const plan = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId: cappedProductId, startDate: "2026-01-01", memberPatientIds: [first] })
      .expect(201);
    planIds.push(plan.body.id);

    await request(app.getHttpServer())
      .post(`/v1/health-plans/${plan.body.id}/members`)
      .send({ patientId: second })
      .expect(400);
  });

  it("removes a member (soft) and lets the freed patient join a different plan", async () => {
    const patientId = await createPatient("revive");
    const planA = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01", memberPatientIds: [patientId] })
      .expect(201);
    planIds.push(planA.body.id);

    const removed = await request(app.getHttpServer())
      .delete(`/v1/health-plans/${planA.body.id}/members/${patientId}`)
      .expect(200);
    expect(removed.body.members).toEqual([]);

    const membership = await prisma.healthPlanMember.findUnique({
      where: { healthPlanId_patientId: { healthPlanId: planA.body.id, patientId } },
    });
    expect(membership?.removedAt).not.toBeNull();

    const planB = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01" })
      .expect(201);
    planIds.push(planB.body.id);

    const added = await request(app.getHttpServer())
      .post(`/v1/health-plans/${planB.body.id}/members`)
      .send({ patientId })
      .expect(201);
    expect(added.body.members).toEqual([expect.objectContaining({ patientId })]);
  });

  it("re-adding a previously removed patient revives the same membership row rather than duplicating it", async () => {
    const patientId = await createPatient("revive-same-plan");
    const plan = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01", memberPatientIds: [patientId] })
      .expect(201);
    planIds.push(plan.body.id);

    await request(app.getHttpServer())
      .delete(`/v1/health-plans/${plan.body.id}/members/${patientId}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/health-plans/${plan.body.id}/members`)
      .send({ patientId })
      .expect(201);

    const rows = await prisma.healthPlanMember.findMany({ where: { healthPlanId: plan.body.id, patientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].removedAt).toBeNull();
  });

  it("is idempotent removing a patient who isn't currently a member (200, not an error)", async () => {
    const patientId = await createPatient("never-a-member");
    const plan = await request(app.getHttpServer())
      .post("/v1/health-plans")
      .send({ productId, startDate: "2026-01-01" })
      .expect(201);
    planIds.push(plan.body.id);

    await request(app.getHttpServer())
      .delete(`/v1/health-plans/${plan.body.id}/members/${patientId}`)
      .expect(200);
  });

  it("404s removing a member from a plan that doesn't exist", async () => {
    const patientId = await createPatient("ghost-plan-remove");
    await request(app.getHttpServer())
      .delete(`/v1/health-plans/00000000-0000-0000-0000-000000000000/members/${patientId}`)
      .expect(404);
  });
});
