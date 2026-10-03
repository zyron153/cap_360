import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@cap/database";
import {
  DEFAULT_EFATURA_CONFIG,
  EFATURA_NIF_RE,
  EFaturaConfigSchema,
  type EFaturaConfig,
  type EFaturaConfigView,
  type UpdateEFaturaConfigDto,
} from "@cap/types";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { loadSigningKey, type SigningKey } from "./dfe/dfe-signer";

const CONFIG_KEY = "integration_efatura";
/** Encrypted values only. Never returned by any endpoint, and excluded from GET /settings. */
export const EFATURA_SECRETS_KEY = "integration_efatura_secrets";

interface Meta {
  connectedAt: string | null;
  certificateSubject: string | null;
  certificateNotAfter: string | null;
}
interface Secrets {
  clientSecret?: string;
  refreshToken?: string;
  certificate?: string;
  certificatePassword?: string;
}

/** Everything the submission pipeline needs, fully resolved (no nulls). */
export interface ReadyConfig {
  repositoryCode: 1 | 2 | 3;
  isSpecimen: boolean;
  goLiveAt: Date | null;
  ledCode: number;
  serie: string;
  software: { code: string; name: string; version: string };
  transmitterTaxId: string;
  emitter: { taxId: string; name: string; addressDetail: string; addressCode: string; email: string; phone: string };
  tax: { typeCode: "NA" | "IVA"; percentage?: number; exemptionReasonCode?: number };
  creditNoteReasonCode: string;
  oauth: { clientId: string; clientSecret: string; redirectUri: string };
  signingKey: SigningKey;
}

export type Resolved = { ok: true; config: ReadyConfig } | { ok: false; missing: string[] };

/** What still blocks submissions, in plain Portuguese (shown to the admin). */
export function computeMissing(
  cfg: EFaturaConfig,
  clinic: { name: string | null; nif: string | null },
  has: { clientSecret: boolean; connected: boolean; certificate: boolean; certificateNotAfter: string | null }
): string[] {
  const m: string[] = [];
  if (!clinic.nif || !EFATURA_NIF_RE.test(clinic.nif)) m.push("NIF da clínica válido (Configurações → Clínica)");
  if (!clinic.name || clinic.name.trim().length < 3) m.push("Nome fiscal da clínica (Configurações → Clínica)");
  if (cfg.ledCode == null) m.push("Código do LED");
  if (!cfg.serie) m.push("Série");
  if (!cfg.softwareCode) m.push("Código do software");
  if (!cfg.softwareName) m.push("Nome do software");
  if (!cfg.softwareVersion) m.push("Versão do software");
  if (!cfg.transmitterTaxId) m.push("NIF do transmissor");
  if (!cfg.emitterAddressDetail) m.push("Morada do emissor");
  if (!cfg.emitterAddressCode) m.push("Código de endereço do emissor");
  if (!cfg.emitterEmail) m.push("Email do emissor");
  if (!cfg.emitterPhone) m.push("Telefone do emissor");
  if (!cfg.taxTypeCode) m.push("Tratamento de IVA");
  else if (cfg.taxTypeCode === "IVA" && cfg.taxPercentage == null) m.push("Taxa de IVA");
  else if (cfg.taxTypeCode === "NA" && cfg.taxExemptionReasonCode == null) m.push("Motivo de isenção de IVA");
  if (!cfg.oauthClientId) m.push("Client ID");
  if (!has.clientSecret) m.push("Client Secret");
  if (!cfg.oauthRedirectUri) m.push("Redirect URI");
  if (!has.connected) m.push("Ligação à Plataforma Eletrónica (autorizar)");
  if (!has.certificate) m.push("Certificado digital de assinatura");
  else if (has.certificateNotAfter && new Date(has.certificateNotAfter).getTime() <= Date.now()) m.push("Certificado digital válido (expirado)");
  return m;
}

@Injectable()
export class EFaturaConfigService {
  private readonly logger = new Logger(EFaturaConfigService.name);
  private keyCache?: { blob: string; key: SigningKey };

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService
  ) {}

  private async readJson(key: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as Record<string, unknown> | null) ?? {};
  }

  private async writeJson(key: string, value: Record<string, unknown>) {
    const v = value as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
  }

  private async load() {
    const raw = await this.readJson(CONFIG_KEY);
    const parsed = EFaturaConfigSchema.safeParse({ ...DEFAULT_EFATURA_CONFIG, ...raw });
    if (!parsed.success && Object.keys(raw).length > 0) {
      // e.g. the pre-direct-integration row (string booleans, apiKey, endpoint): start clean, disabled.
      this.logger.warn("integration_efatura setting is not in the current shape — using defaults (disabled)");
    }
    const cfg: EFaturaConfig = parsed.success ? parsed.data : { ...DEFAULT_EFATURA_CONFIG };
    const meta: Meta = {
      connectedAt: typeof raw.connectedAt === "string" ? raw.connectedAt : null,
      certificateSubject: typeof raw.certificateSubject === "string" ? raw.certificateSubject : null,
      certificateNotAfter: typeof raw.certificateNotAfter === "string" ? raw.certificateNotAfter : null,
    };
    const secrets = (await this.readJson(EFATURA_SECRETS_KEY)) as Secrets;
    const clinicRow = await this.prisma.setting.findUnique({ where: { key: "clinic" } });
    const clinic = (clinicRow?.value ?? {}) as { name?: string; nif?: string };
    return { cfg, meta, secrets, clinic: { name: clinic.name?.trim() || null, nif: clinic.nif?.trim() || null } };
  }

  private async save(cfg: EFaturaConfig, meta: Meta) {
    await this.writeJson(CONFIG_KEY, { ...cfg, ...meta });
  }

  async getView(): Promise<EFaturaConfigView> {
    const { cfg, meta, secrets, clinic } = await this.load();
    const missing = computeMissing(cfg, clinic, {
      clientSecret: !!secrets.clientSecret,
      connected: !!secrets.refreshToken,
      certificate: !!secrets.certificate,
      certificateNotAfter: meta.certificateNotAfter,
    });
    return {
      ...cfg,
      hasClientSecret: !!secrets.clientSecret,
      connected: !!secrets.refreshToken,
      connectedAt: meta.connectedAt,
      hasCertificate: !!secrets.certificate,
      certificateSubject: meta.certificateSubject,
      certificateNotAfter: meta.certificateNotAfter,
      clinicName: clinic.name,
      clinicNif: clinic.nif,
      ready: cfg.enabled && missing.length === 0,
      missing,
    };
  }

  async update(dto: UpdateEFaturaConfigDto): Promise<EFaturaConfigView> {
    const { cfg, meta, secrets } = await this.load();
    const { oauthClientSecret, ...fields } = dto;
    const next = EFaturaConfigSchema.safeParse({ ...cfg, ...fields });
    if (!next.success) throw new BadRequestException(next.error.issues.map((i) => i.message).join("; "));
    // Switching on without a start date means "from now": history is never reported retroactively.
    if (next.data.enabled && !next.data.goLiveAt) next.data.goLiveAt = new Date().toISOString();
    if (next.data.taxTypeCode === "IVA" && next.data.taxExemptionReasonCode != null) next.data.taxExemptionReasonCode = null;
    if (next.data.taxTypeCode === "NA" && next.data.taxPercentage != null) next.data.taxPercentage = null;
    // The consent was granted to a specific client + redirect URI: changing either invalidates it.
    const clientChanged = next.data.oauthClientId !== cfg.oauthClientId || next.data.oauthRedirectUri !== cfg.oauthRedirectUri;
    const newSecret = oauthClientSecret !== undefined;
    if (clientChanged || newSecret) {
      delete secrets.refreshToken;
      meta.connectedAt = null;
    }
    if (newSecret) secrets.clientSecret = this.encryption.encrypt(oauthClientSecret);
    await this.save(next.data, meta);
    await this.writeJson(EFATURA_SECRETS_KEY, secrets as Record<string, unknown>);
    return this.getView();
  }

  /** Validates (password, expiry, key↔certificate match) before anything is stored. */
  async setCertificate(file: string, password: string): Promise<EFaturaConfigView> {
    let key: SigningKey;
    try {
      key = loadSigningKey(file, password);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Certificado inválido");
    }
    const { cfg, meta, secrets } = await this.load();
    secrets.certificate = this.encryption.encrypt(file);
    secrets.certificatePassword = this.encryption.encrypt(password);
    meta.certificateSubject = key.subject;
    meta.certificateNotAfter = key.notAfter.toISOString();
    this.keyCache = undefined;
    await this.save(cfg, meta);
    await this.writeJson(EFATURA_SECRETS_KEY, secrets as Record<string, unknown>);
    return this.getView();
  }

  async removeCertificate(): Promise<EFaturaConfigView> {
    const { cfg, meta, secrets } = await this.load();
    delete secrets.certificate;
    delete secrets.certificatePassword;
    meta.certificateSubject = null;
    meta.certificateNotAfter = null;
    this.keyCache = undefined;
    await this.save(cfg, meta);
    await this.writeJson(EFATURA_SECRETS_KEY, secrets as Record<string, unknown>);
    return this.getView();
  }

  // ── OAuth secrets (used by EFaturaAuthService) ──────────────────────────────

  async getOAuthClient(): Promise<{ clientId: string; clientSecret: string; redirectUri: string } | null> {
    const { cfg, secrets } = await this.load();
    if (!cfg.oauthClientId || !cfg.oauthRedirectUri || !secrets.clientSecret) return null;
    return {
      clientId: cfg.oauthClientId,
      clientSecret: this.encryption.decrypt(secrets.clientSecret),
      redirectUri: cfg.oauthRedirectUri,
    };
  }

  async getRefreshToken(): Promise<string | null> {
    const { secrets } = await this.load();
    return secrets.refreshToken ? this.encryption.decrypt(secrets.refreshToken) : null;
  }

  async saveRefreshToken(token: string | null): Promise<void> {
    const { cfg, meta, secrets } = await this.load();
    if (token) {
      secrets.refreshToken = this.encryption.encrypt(token);
      meta.connectedAt = meta.connectedAt ?? new Date().toISOString();
    } else {
      delete secrets.refreshToken;
      meta.connectedAt = null;
    }
    await this.save(cfg, meta);
    await this.writeJson(EFATURA_SECRETS_KEY, secrets as Record<string, unknown>);
  }

  /** Stamps a (re)connection — called once the consent code has been exchanged. */
  async markConnected(refreshToken: string): Promise<void> {
    const { cfg, meta, secrets } = await this.load();
    secrets.refreshToken = this.encryption.encrypt(refreshToken);
    meta.connectedAt = new Date().toISOString();
    await this.save(cfg, meta);
    await this.writeJson(EFATURA_SECRETS_KEY, secrets as Record<string, unknown>);
  }

  // ── Runtime resolution ──────────────────────────────────────────────────────

  async resolve(): Promise<Resolved & { enabled: boolean }> {
    const { cfg, meta, secrets, clinic } = await this.load();
    const missing = computeMissing(cfg, clinic, {
      clientSecret: !!secrets.clientSecret,
      connected: !!secrets.refreshToken,
      certificate: !!secrets.certificate,
      certificateNotAfter: meta.certificateNotAfter,
    });
    if (missing.length > 0) return { ok: false, missing, enabled: cfg.enabled };

    let signingKey: SigningKey;
    try {
      const blob = secrets.certificate as string;
      if (this.keyCache?.blob === blob) signingKey = this.keyCache.key;
      else {
        signingKey = loadSigningKey(this.encryption.decrypt(blob), this.encryption.decrypt(secrets.certificatePassword ?? this.encryption.encrypt("")));
        this.keyCache = { blob, key: signingKey };
      }
    } catch (e) {
      return { ok: false, missing: [e instanceof Error ? e.message : "Certificado digital inválido"], enabled: cfg.enabled };
    }

    return {
      ok: true,
      enabled: cfg.enabled,
      config: {
        repositoryCode: cfg.repositoryCode,
        isSpecimen: cfg.isSpecimen,
        goLiveAt: cfg.goLiveAt ? new Date(cfg.goLiveAt) : null,
        ledCode: cfg.ledCode as number,
        serie: cfg.serie as string,
        software: { code: cfg.softwareCode as string, name: cfg.softwareName as string, version: cfg.softwareVersion as string },
        transmitterTaxId: cfg.transmitterTaxId as string,
        emitter: {
          taxId: clinic.nif as string,
          name: clinic.name as string,
          addressDetail: cfg.emitterAddressDetail as string,
          addressCode: cfg.emitterAddressCode as string,
          email: cfg.emitterEmail as string,
          phone: cfg.emitterPhone as string,
        },
        tax: {
          typeCode: cfg.taxTypeCode as "NA" | "IVA",
          percentage: cfg.taxPercentage ?? undefined,
          exemptionReasonCode: cfg.taxExemptionReasonCode ?? undefined,
        },
        creditNoteReasonCode: cfg.creditNoteReasonCode,
        oauth: {
          clientId: cfg.oauthClientId as string,
          clientSecret: this.encryption.decrypt(secrets.clientSecret as string),
          redirectUri: cfg.oauthRedirectUri as string,
        },
        signingKey,
      },
    };
  }

  /** Cheap gate used when an invoice is issued: should this invoice be reported at all? */
  async isReportable(issuedAt: Date): Promise<boolean> {
    const { cfg } = await this.load();
    if (!cfg.enabled) return false;
    return !cfg.goLiveAt || issuedAt.getTime() >= new Date(cfg.goLiveAt).getTime();
  }
}
