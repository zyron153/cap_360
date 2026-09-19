import { createHmac, timingSafeEqual } from "crypto";

/** The `integration_whatsapp` Setting row. `webhookToken` = Meta's verify token; `appSecret` signs webhooks. */
export interface WaConfig {
  phoneNumberId: string;
  accessToken: string;
  webhookToken?: string;
  appSecret?: string;
}

/** Sends a free-text message; throws on any non-2xx. Returns Meta's message id (wamid…). */
export async function sendWhatsAppText(cfg: WaConfig, to: string, body: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id ?? "";
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verifies Meta's `X-Hub-Signature-256: sha256=<hmac of the raw body>` header. Fails closed. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string | undefined): boolean {
  if (!rawBody || !header || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(header, expected);
}
