import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

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
});
