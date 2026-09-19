import { createHmac } from "crypto";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { createTestApp } from "./setup";

const APP_SECRET = "integration-app-secret";
const VERIFY_TOKEN = "integration-verify-token";
const SETTING_KEY = "integration_whatsapp";

describe("WhatsApp webhook → inbox (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let savedSetting: { value: unknown } | null;
  const local = String(Date.now()).slice(-7);
  const from = `238${local}`;
  const phone = `+238${local}`;

  const payload = (id: string, body: string) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { messages: [{ id, from, type: "text", text: { body } }] } }] }],
  });
  const signed = (obj: unknown) => {
    const raw = JSON.stringify(obj);
    const sig = `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
    return request(app.getHttpServer())
      .post("/v1/whatsapp/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sig)
      .send(raw);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // The dev DB may hold real integration credentials — swap in test ones, restore in afterAll.
    savedSetting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const value = { phoneNumberId: "test", accessToken: "test", webhookToken: VERIFY_TOKEN, appSecret: APP_SECRET };
    await prisma.setting.upsert({ where: { key: SETTING_KEY }, update: { value }, create: { key: SETTING_KEY, value } });
  });

  afterAll(async () => {
    await prisma.whatsappConversation.deleteMany({ where: { phone } });
    if (savedSetting) {
      await prisma.setting.update({ where: { key: SETTING_KEY }, data: { value: savedSetting.value as never } });
    } else {
      await prisma.setting.delete({ where: { key: SETTING_KEY } });
    }
    await app.close();
  });

  it("answers Meta's verify handshake only with the right token", async () => {
    const url = "/v1/whatsapp/webhook?hub.mode=subscribe&hub.challenge=abc123";
    const ok = await request(app.getHttpServer()).get(`${url}&hub.verify_token=${VERIFY_TOKEN}`);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("abc123");
    const bad = await request(app.getHttpServer()).get(`${url}&hub.verify_token=wrong`);
    expect(bad.status).toBe(403);
  });

  it("rejects an unsigned or badly signed POST and stores nothing", async () => {
    const unsigned = await request(app.getHttpServer()).post("/v1/whatsapp/webhook").send(payload("wamid.int.0", "x"));
    expect(unsigned.status).toBe(403);
    const forged = await request(app.getHttpServer())
      .post("/v1/whatsapp/webhook")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(payload("wamid.int.0", "x"));
    expect(forged.status).toBe(403);
    expect(await prisma.whatsappMessage.count({ where: { externalId: "wamid.int.0" } })).toBe(0);
  });

  it("stores a signed message encrypted, dedupes a Meta retry, and serves it via the inbox API", async () => {
    const id = `wamid.int.${Date.now()}`;
    const body = payload(id, "Bom dia, preciso remarcar");

    expect((await signed(body)).status).toBe(200);
    expect((await signed(body)).status).toBe(200); // retry

    const conv = await prisma.whatsappConversation.findUniqueOrThrow({ where: { phone } });
    expect(conv).toMatchObject({ status: "open", unreadCount: 1, patientId: null });
    const rows = await prisma.whatsappMessage.findMany({ where: { conversationId: conv.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).not.toContain("remarcar"); // ciphertext at rest

    const list = await request(app.getHttpServer()).get("/v1/whatsapp/conversations?status=open&limit=100");
    expect(list.status).toBe(200);
    const entry = list.body.data.find((c: { id: string }) => c.id === conv.id);
    expect(entry.lastMessage.body).toBe("Bom dia, preciso remarcar");

    const detail = await request(app.getHttpServer()).get(`/v1/whatsapp/conversations/${conv.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages[0]).toMatchObject({ direction: "inbound", body: "Bom dia, preciso remarcar" });
    expect((await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conv.id } })).unreadCount).toBe(0);
  });

  it("resolves a conversation and reopens it on the next inbound message", async () => {
    const conv = await prisma.whatsappConversation.findUniqueOrThrow({ where: { phone } });
    expect((await request(app.getHttpServer()).patch(`/v1/whatsapp/conversations/${conv.id}/resolve`)).status).toBe(200);
    expect((await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("resolved");

    await signed(payload(`wamid.int.re.${Date.now()}`, "ainda aí?"));
    expect((await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("open");
  });
});
