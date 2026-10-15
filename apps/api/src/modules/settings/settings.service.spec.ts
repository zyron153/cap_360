import { Test } from "@nestjs/testing";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const prisma = {
  setting: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};
const notifications = { syncScheduledJobs: jest.fn() };

const MASK = "••••••••";

describe("SettingsService", () => {
  let service: SettingsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(SettingsService);
    jest.clearAllMocks();
  });

  describe("getAll — secret masking", () => {
    it("masks apiKey in the returned value", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_whatsapp", value: { enabled: true, nifContribuinte: "123", apiKey: "real-secret-key" } },
      ]);
      const result = await service.getAll();
      expect((result.integration_whatsapp as Record<string, unknown>).apiKey).toBe(MASK);
    });

    it("leaves non-secret fields untouched", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_whatsapp", value: { enabled: true, nifContribuinte: "123456789", apiKey: "real-secret-key" } },
      ]);
      const result = await service.getAll();
      const cfg = result.integration_whatsapp as Record<string, unknown>;
      expect(cfg.enabled).toBe(true);
      expect(cfg.nifContribuinte).toBe("123456789");
    });

    it("masks every known secret field across different integration keys", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_keycloak", value: { clientId: "cms-api", clientSecret: "kc-secret" } },
        { key: "integration_whatsapp", value: { accessToken: "wa-token", webhookToken: "wh-token" } },
        { key: "integration_cloudflare_r2", value: { accountId: "abc", secretKey: "r2-secret" } },
        { key: "integration_email_smtp", value: { username: "user", password: "smtp-pass" } },
      ]);
      const result = await service.getAll();
      expect((result.integration_keycloak as Record<string, unknown>).clientSecret).toBe(MASK);
      expect((result.integration_whatsapp as Record<string, unknown>).accessToken).toBe(MASK);
      expect((result.integration_whatsapp as Record<string, unknown>).webhookToken).toBe(MASK);
      expect((result.integration_cloudflare_r2 as Record<string, unknown>).secretKey).toBe(MASK);
      expect((result.integration_email_smtp as Record<string, unknown>).password).toBe(MASK);
    });

    it("leaves an empty secret field empty rather than masking it", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_whatsapp", value: { enabled: false, apiKey: "" } },
      ]);
      const result = await service.getAll();
      expect((result.integration_whatsapp as Record<string, unknown>).apiKey).toBe("");
    });

    it("passes through non-object values (e.g. access_control) unchanged", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "access_control", value: { admin: { billing: { view: true } } } },
      ]);
      const result = await service.getAll();
      expect(result.access_control).toEqual({ admin: { billing: { view: true } } });
    });
  });

  describe("upsert — preserving real secrets on masked round-trip", () => {
    it("keeps the existing apiKey when the client sends back the mask unchanged", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        key: "integration_whatsapp",
        value: { enabled: true, nifContribuinte: "123", apiKey: "real-secret-key" },
      });
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_whatsapp", { enabled: true, nifContribuinte: "123", apiKey: MASK });

      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: expect.objectContaining({ apiKey: "real-secret-key" }) }),
        })
      );
    });

    it("stores a genuinely new apiKey when the client sends a real value", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        key: "integration_whatsapp",
        value: { apiKey: "old-key" },
      });
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_whatsapp", { apiKey: "brand-new-key" });

      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: expect.objectContaining({ apiKey: "brand-new-key" }) }),
        })
      );
    });

    it("does not query for an existing row when no field is masked", async () => {
      prisma.setting.upsert.mockResolvedValue({});
      await service.upsert("integration_whatsapp", { apiKey: "brand-new-key" });
      expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    });

    it("clears the secret to empty when masked but nothing was previously stored", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_whatsapp", { apiKey: MASK });

      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: expect.objectContaining({ apiKey: "" }) }),
        })
      );
    });

    it("still calls notifications.syncScheduledJobs for the notifications key", async () => {
      prisma.setting.upsert.mockResolvedValue({});
      await service.upsert("notifications", { emailReminders: true });
      expect(notifications.syncScheduledJobs).toHaveBeenCalledWith({ emailReminders: true });
    });

    it("returns { ok: true }", async () => {
      prisma.setting.upsert.mockResolvedValue({});
      expect(await service.upsert("clinic", { name: "Clínica X" })).toEqual({ ok: true });
    });
  });

  describe("e-Fatura settings", () => {
    it("never travel through the generic endpoints: GET /settings omits them", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_efatura", value: { enabled: true } },
        { key: "integration_efatura_secrets", value: { refreshToken: "enc" } },
        { key: "clinic", value: { name: "Clínica X" } },
      ]);
      expect(Object.keys(await service.getAll())).toEqual(["clinic"]);
    });

    it("cannot be written through PATCH /settings/integration/efatura", async () => {
      await expect(service.upsert("integration_efatura", { enabled: true })).rejects.toThrow(BadRequestException);
      await expect(service.upsert("integration_efatura_secrets", {})).rejects.toThrow(BadRequestException);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });
  });

  describe("updateClinic — the clinic identity feeds every fiscal document", () => {
    const body = { name: "Clínica X", nif: "123456789", phone: "+238 2611234", hours: [] };

    beforeEach(() => prisma.setting.upsert.mockResolvedValue({}));

    it("rejects an invalid NIF (leading zero / wrong length)", async () => {
      await expect(service.updateClinic({ ...body, nif: "012345678" }, ["admin"])).rejects.toThrow(BadRequestException);
      await expect(service.updateClinic({ ...body, nif: "12345" }, ["admin"])).rejects.toThrow(BadRequestException);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it("accepts an empty NIF (not configured yet)", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      await expect(service.updateClinic({ ...body, nif: "" }, ["receptionist"])).resolves.toEqual({ ok: true });
    });

    it("lets an admin change name and NIF", async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: { name: "Antigo", nif: "111111111" } });
      await expect(service.updateClinic(body, ["admin"])).resolves.toEqual({ ok: true });
    });

    it("stops reception from changing the NIF or the name", async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: { name: "Clínica X", nif: "111111111" } });
      await expect(service.updateClinic(body, ["receptionist"])).rejects.toThrow(ForbiddenException);
      prisma.setting.findUnique.mockResolvedValue({ value: { name: "Outro nome", nif: "123456789" } });
      await expect(service.updateClinic(body, ["receptionist"])).rejects.toThrow(ForbiddenException);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it("still lets reception edit everything else", async () => {
      prisma.setting.findUnique.mockResolvedValue({ value: { name: "Clínica X", nif: "123456789" } });
      await expect(service.updateClinic({ ...body, phone: "9999999" }, ["receptionist"])).resolves.toEqual({ ok: true });
    });
  });
});
