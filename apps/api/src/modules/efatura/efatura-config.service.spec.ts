process.env.FIELD_ENCRYPTION_KEY = "cd".repeat(32);

import { BadRequestException } from "@nestjs/common";
import { DEFAULT_EFATURA_CONFIG } from "@cap/types";
import { EFaturaConfigService, computeMissing } from "./efatura-config.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { makeIdentity } from "./testing/efatura-test-utils";

const enc = new EncryptionService();
const CLINIC = { name: "Clinica Teste Lda", nif: "123456789" };

/** The `settings` table as a Map. */
function fakePrisma(seed: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(seed));
  return {
    rows,
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => void rows.set(where.key, create.value),
    },
  };
}

const COMPLETE = {
  ...DEFAULT_EFATURA_CONFIG,
  enabled: true,
  ledCode: 1,
  serie: "A2026",
  softwareCode: "CAP360",
  softwareName: "CAP 360",
  softwareVersion: "1.0.0",
  transmitterTaxId: "123456789",
  emitterAddressDetail: "Rua 1",
  emitterAddressCode: "CV774741741037410321",
  emitterEmail: "geral@clinica.cv",
  emitterPhone: "2611234",
  taxTypeCode: "NA" as const,
  taxExemptionReasonCode: 3,
  oauthClientId: "cap",
  oauthRedirectUri: "https://app.cap.cv/api/efatura/oauth/callback",
};
const HAS = { clientSecret: true, connected: true, certificate: true, certificateNotAfter: null };

describe("computeMissing", () => {
  it("lists nothing when everything is configured", () => {
    expect(computeMissing(COMPLETE, CLINIC, HAS)).toEqual([]);
  });

  it("names every gap on a fresh install", () => {
    const m = computeMissing(DEFAULT_EFATURA_CONFIG, { name: null, nif: null }, { clientSecret: false, connected: false, certificate: false, certificateNotAfter: null });
    expect(m).toEqual(
      expect.arrayContaining(["NIF da clínica válido (Configurações → Clínica)", "Código do LED", "Série", "Tratamento de IVA", "Client Secret", "Certificado digital de assinatura"])
    );
  });

  it("asks for the rate when IVA is chosen and for the exemption code when NA is", () => {
    expect(computeMissing({ ...COMPLETE, taxTypeCode: "IVA", taxPercentage: null }, CLINIC, HAS)).toEqual(["Taxa de IVA"]);
    expect(computeMissing({ ...COMPLETE, taxTypeCode: "NA", taxExemptionReasonCode: null }, CLINIC, HAS)).toEqual(["Motivo de isenção de IVA"]);
  });

  it("rejects a clinic NIF the platform would refuse (leading zero)", () => {
    expect(computeMissing(COMPLETE, { ...CLINIC, nif: "012345678" }, HAS)[0]).toMatch(/NIF da clínica/);
  });

  it("flags an expired certificate", () => {
    expect(computeMissing(COMPLETE, CLINIC, { ...HAS, certificateNotAfter: "2020-01-01T00:00:00Z" })).toEqual(["Certificado digital válido (expirado)"]);
  });
});

describe("EFaturaConfigService", () => {
  const make = (seed: Record<string, unknown> = { clinic: CLINIC }) => {
    const prisma = fakePrisma(seed);
    return { prisma, svc: new EFaturaConfigService(prisma as never, enc) };
  };

  it("starts disabled and incomplete, never exposing secrets", async () => {
    const { svc } = make();
    const v = await svc.getView();
    expect(v).toMatchObject({ enabled: false, ready: false, hasClientSecret: false, connected: false, hasCertificate: false, clinicNif: "123456789" });
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(["refreshToken"]));
    expect(JSON.stringify(v)).not.toMatch(/"(refreshToken|clientSecret|oauthClientSecret|certificate|certificatePassword|password)"/);
  });

  it("ignores a pre-direct-integration row (string booleans, apiKey) and starts disabled", async () => {
    const { svc } = make({ clinic: CLINIC, integration_efatura: { enabled: "true", sandbox: "false", apiKey: "old-key", endpoint: "https://mw.efatura.cv" } });
    expect((await svc.getView()).enabled).toBe(false);
  });

  it("validates input with the platform's own patterns", async () => {
    const { svc } = make();
    await expect(svc.update({ emitterPhone: "+238 261 1234" })).rejects.toThrow(BadRequestException);
    await expect(svc.update({ emitterAddressCode: "CV123" })).rejects.toThrow(BadRequestException);
    await expect(svc.update({ transmitterTaxId: "012345678" })).rejects.toThrow(BadRequestException);
  });

  it("switching on without a start date means 'from now' — history is never back-filled", async () => {
    const { svc } = make();
    const before = Date.now();
    const v = await svc.update({ enabled: true });
    expect(new Date(v.goLiveAt as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("keeps an explicit go-live date", async () => {
    const { svc } = make();
    const v = await svc.update({ enabled: true, goLiveAt: "2026-11-01T00:00:00.000Z" });
    expect(v.goLiveAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("clears the unused tax field when the treatment changes", async () => {
    const { svc } = make();
    await svc.update({ taxTypeCode: "NA", taxExemptionReasonCode: 3 });
    const v = await svc.update({ taxTypeCode: "IVA", taxPercentage: 15 });
    expect(v).toMatchObject({ taxTypeCode: "IVA", taxPercentage: 15, taxExemptionReasonCode: null });
  });

  it("stores the OAuth client secret encrypted and only reports that it exists", async () => {
    const { svc, prisma } = make();
    const v = await svc.update({ oauthClientSecret: "super-secret" });
    expect(v.hasClientSecret).toBe(true);
    const stored = JSON.stringify(prisma.rows.get("integration_efatura_secrets"));
    expect(stored).not.toContain("super-secret");
    expect(JSON.stringify(prisma.rows.get("integration_efatura"))).not.toContain("super-secret");
  });

  it("changing the client or redirect URI invalidates the existing consent", async () => {
    const { svc } = make();
    await svc.update({ oauthClientId: "cap", oauthRedirectUri: "https://a.cv/cb", oauthClientSecret: "s" });
    await svc.markConnected("refresh-1");
    expect((await svc.getView()).connected).toBe(true);

    expect((await svc.update({ oauthRedirectUri: "https://b.cv/cb" })).connected).toBe(false);
    expect(await svc.getRefreshToken()).toBeNull();
  });

  it("keeps the consent when an unrelated field changes", async () => {
    const { svc } = make();
    await svc.update({ oauthClientId: "cap", oauthRedirectUri: "https://a.cv/cb", oauthClientSecret: "s" });
    await svc.markConnected("refresh-1");
    expect((await svc.update({ serie: "B2026" })).connected).toBe(true);
    expect(await svc.getRefreshToken()).toBe("refresh-1");
  });

  it("validates a certificate before storing it, and never returns it", async () => {
    const { svc, prisma } = make();
    const id = makeIdentity({ cn: "Selo Teste" });
    const v = await svc.setCertificate(id.p12Base64, id.password);
    expect(v).toMatchObject({ hasCertificate: true });
    expect(v.certificateSubject).toContain("Selo Teste");
    expect(JSON.stringify(v)).not.toContain(id.p12Base64);
    expect(JSON.stringify(prisma.rows.get("integration_efatura_secrets"))).not.toContain(id.p12Base64.slice(0, 40));
    await expect(svc.setCertificate(id.p12Base64, "wrong")).rejects.toThrow(BadRequestException);
    expect((await svc.removeCertificate()).hasCertificate).toBe(false);
  });

  it("resolve() hands back a fully typed, ready config once everything is in place", async () => {
    const { svc } = make();
    const id = makeIdentity();
    const { ledCode, serie, ...rest } = COMPLETE;
    await svc.update({ ...rest, ledCode, serie, oauthClientSecret: "s" });
    await svc.markConnected("refresh");
    await svc.setCertificate(`${id.keyPem}\n${id.certPem}`, "");

    const r = await svc.resolve();

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toMatchObject({ ledCode: 1, serie: "A2026", repositoryCode: 2, tax: { typeCode: "NA", exemptionReasonCode: 3 } });
      expect(r.config.emitter).toMatchObject({ taxId: "123456789", name: "Clinica Teste Lda" });
      expect(r.config.oauth.clientSecret).toBe("s");
      expect(r.config.signingKey.privateKeyPem).toContain("PRIVATE KEY");
    }
  });

  it("resolve() reports what is missing instead of throwing", async () => {
    const { svc } = make();
    const r = await svc.resolve();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.length).toBeGreaterThan(5);
  });

  it("isReportable honours enabled and the go-live date", async () => {
    const { svc } = make();
    expect(await svc.isReportable(new Date())).toBe(false); // disabled
    await svc.update({ enabled: true, goLiveAt: "2026-11-01T00:00:00.000Z" });
    expect(await svc.isReportable(new Date("2026-10-31T00:00:00Z"))).toBe(false);
    expect(await svc.isReportable(new Date("2026-11-02T00:00:00Z"))).toBe(true);
  });
});
