import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

describe("Billing — invoice creation and payment (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let patientId: string;
  let invoiceId: string;
  let total: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const patient = await prisma.patient.create({
      data: {
        fullName: "Integration Test Patient — invoice-payment",
        gender: "other",
        phone: `+238${String(Date.now() % 10_000_000).padStart(7, "0")}`,
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    if (invoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
      await prisma.invoice.delete({ where: { id: invoiceId } });
    }
    await prisma.patient.delete({ where: { id: patientId } });
    await app.close();
  });

  it("creates an issued invoice at the catalogue price, with nothing paid yet", async () => {
    const service = await prisma.service.findUniqueOrThrow({ where: { code: "CONS-GERAL" } });
    const unitPrice = Number(service.price);

    const res = await request(app.getHttpServer())
      .post("/v1/invoices")
      .send({
        patientId,
        items: [{ serviceId: service.id, description: service.name, quantity: 1, unitPrice }],
      })
      .expect(201);

    invoiceId = res.body.id;
    total = Number(res.body.total);
    expect(total).toBe(unitPrice);
    expect(res.body.status).toBe("issued");
    expect(Number(res.body.amountPaid ?? 0)).toBe(0);
  });

  it("moves to partially_paid after a partial payment, then paid once the balance is settled", async () => {
    const half = Math.round((total / 2) * 100) / 100;

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .send({ amount: half, method: "cash" })
      .expect(201);

    const afterPartial = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .expect(200);
    expect(afterPartial.body.status).toBe("partially_paid");
    expect(Number(afterPartial.body.amountPaid)).toBe(half);

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .send({ amount: total - half, method: "cash" })
      .expect(201);

    const afterFull = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .expect(200);
    expect(afterFull.body.status).toBe("paid");
    expect(Number(afterFull.body.amountPaid)).toBe(total);
  });

  it("rejects a further payment on an already-paid invoice", async () => {
    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .send({ amount: 1, method: "cash" })
      .expect(400);
  });
});
