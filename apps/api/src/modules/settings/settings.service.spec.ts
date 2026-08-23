import { Test } from "@nestjs/testing";
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
        { key: "integration_efatura", value: { enabled: true, nifContribuinte: "123", apiKey: "real-secret-key" } },
      ]);
      const result = await service.getAll();
      expect((result.integration_efatura as Record<string, unknown>).apiKey).toBe(MASK);
    });

    it("leaves non-secret fields untouched", async () => {
      prisma.setting.findMany.mockResolvedValue([
        { key: "integration_efatura", value: { enabled: true, nifContribuinte: "123456789", apiKey: "real-secret-key" } },
      ]);
      const result = await service.getAll();
      const cfg = result.integration_efatura as Record<string, unknown>;
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
        { key: "integration_efatura", value: { enabled: false, apiKey: "" } },
      ]);
      const result = await service.getAll();
      expect((result.integration_efatura as Record<string, unknown>).apiKey).toBe("");
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
        key: "integration_efatura",
        value: { enabled: true, nifContribuinte: "123", apiKey: "real-secret-key" },
      });
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_efatura", { enabled: true, nifContribuinte: "123", apiKey: MASK });

      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: expect.objectContaining({ apiKey: "real-secret-key" }) }),
        })
      );
    });

    it("stores a genuinely new apiKey when the client sends a real value", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        key: "integration_efatura",
        value: { apiKey: "old-key" },
      });
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_efatura", { apiKey: "brand-new-key" });

      expect(prisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: expect.objectContaining({ apiKey: "brand-new-key" }) }),
        })
      );
    });

    it("does not query for an existing row when no field is masked", async () => {
      prisma.setting.upsert.mockResolvedValue({});
      await service.upsert("integration_efatura", { apiKey: "brand-new-key" });
      expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    });

    it("clears the secret to empty when masked but nothing was previously stored", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      prisma.setting.upsert.mockResolvedValue({});

      await service.upsert("integration_efatura", { apiKey: MASK });

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
});
