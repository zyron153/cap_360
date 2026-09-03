import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

// Field names used across integration settings (E-Factura, Keycloak, WhatsApp, R2, SMTP, ...)
// that hold credentials and must never be sent back to the client in plaintext.
const MASK = "••••••••";
const SECRET_FIELDS = ["apiKey", "clientSecret", "accessToken", "webhookToken", "secretKey", "password"];

function maskSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of SECRET_FIELDS) {
    if (typeof out[field] === "string" && out[field]) out[field] = MASK;
  }
  return out;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, maskSecrets(r.value)]));
  }

  async upsert(key: string, value: unknown) {
    const merged = await this.preserveMaskedSecrets(key, value);
    /* eslint-disable @typescript-eslint/no-explicit-any -- Prisma's Json column type has no
     * narrower shape to cast `merged` (already validated per-integration upstream) to here. */
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: merged as any },
      create: { key, value: merged as any },
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (key === "notifications") {
      await this.notifications.syncScheduledJobs(merged as Record<string, boolean>);
    }
    return { ok: true };
  }

  // The client only ever sees masked secrets from getAll(). If a save round-trips
  // the mask unchanged, keep the real stored value instead of overwriting it.
  private async preserveMaskedSecrets(key: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const incoming = value as Record<string, unknown>;
    const maskedFields = SECRET_FIELDS.filter((f) => incoming[f] === MASK);
    if (maskedFields.length === 0) return value;

    const existing = await this.prisma.setting.findUnique({ where: { key } });
    const existingValue = (existing?.value as Record<string, unknown>) ?? {};
    const merged = { ...incoming };
    for (const field of maskedFields) merged[field] = existingValue[field] ?? "";
    return merged;
  }
}
