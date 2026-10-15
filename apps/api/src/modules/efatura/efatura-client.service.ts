import { Injectable, Logger } from "@nestjs/common";
import { EFaturaAuthService } from "./efatura-auth.service";
import { EFaturaError, clip } from "./efatura.errors";

// The platform's REST API (manual v11 ch. 10 / OpenAPI "DNRE API 2.0.0"). One fixed host: the
// environment (Principal / Homologação / Teste) is chosen with the cv-ef-repository-code header,
// never with a different URL — and the host is not admin-editable (no server-side SSRF surface).
const BASE = (process.env.EFATURA_BASE_URL ?? "https://services.efatura.cv").replace(/\/$/, "");
const POST_TIMEOUT_MS = 30_000; // validation + authorization are synchronous on the platform side
const GET_TIMEOUT_MS = 15_000;

export interface PeMessage {
  code: string;
  type: string;
  description: string;
  location?: string;
}

/** Outcome for one XML file in the ZIP. */
export interface PeResult {
  succeeded: boolean;
  entryName?: string;
  authorizedAt?: Date;
  messages: PeMessage[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = (o: any, ...keys: string[]): any => keys.map((k) => o?.[k]).find((v) => v !== undefined);

function fromJson(body: unknown): PeResult[] {
  const list = pick(body, "responses", "Responses");
  const arr = Array.isArray(list) ? list : Array.isArray(pick(list, "response", "Response")) ? pick(list, "response", "Response") : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return arr.map((r: any) => {
    const msgs = pick(r, "messages", "Messages");
    const msgList = Array.isArray(msgs) ? msgs : Array.isArray(pick(msgs, "message", "Message")) ? pick(msgs, "message", "Message") : [];
    const authorized = pick(r, "authorizedDateTime", "AuthorizedDateTime", "timeStamp", "TimeStamp");
    return {
      succeeded: pick(r, "succeeded", "Succeeded") === true || pick(r, "succeeded", "Succeeded") === "true",
      entryName: pick(r, "entryName", "EntryName"),
      authorizedAt: authorized ? new Date(authorized) : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: msgList.map((m: any) => ({
        code: String(pick(m, "code", "Code") ?? ""),
        type: String(pick(m, "type", "Type") ?? ""),
        description: String(pick(m, "description", "Description") ?? ""),
        location: pick(m, "location", "Location"),
      })),
    };
  });
}

// ponytail: tolerant regex reader for the XML flavour of the same payload — only reached if the
// platform ignores `Accept: application/json`. Swap for a real XML parser if that ever matters.
function fromXml(xml: string): PeResult[] {
  const tag = (s: string, name: string) => s.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1];
  return [...xml.matchAll(/<Response\b([^>]*)>([\s\S]*?)<\/Response>/g)].map((m) => {
    const ts = tag(m[2], "TimeStamp") ?? tag(m[2], "AuthorizedDateTime");
    return {
      succeeded: /Succeeded="true"/i.test(m[1]),
      entryName: tag(m[2], "EntryName"),
      authorizedAt: ts ? new Date(ts) : undefined,
      messages: [...m[2].matchAll(/<Message\b[^>]*>([\s\S]*?)<\/Message>/g)].map((mm) => ({
        code: tag(mm[1], "Code") ?? "",
        type: tag(mm[1], "Type") ?? "",
        description: tag(mm[1], "Description") ?? "",
        location: tag(mm[1], "Location"),
      })),
    };
  });
}

export function parsePeResponse(body: string, contentType: string): PeResult[] {
  const trimmed = body.trim();
  if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return fromJson(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return trimmed.startsWith("<") ? fromXml(trimmed) : [];
}

@Injectable()
export class EFaturaClientService {
  private readonly logger = new Logger(EFaturaClientService.name);

  constructor(private readonly auth: EFaturaAuthService) {}

  /** POST /v1/dfe or /v1/event with a ZIP holding the signed XML. Returns the platform's verdict
   * (accepted or rejected-with-messages); throws EFaturaError for anything technical. */
  async post(resource: "dfe" | "event", zip: Buffer, repositoryCode: number): Promise<PeResult> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(zip)], { type: "application/octet-stream" }), `${resource}.zip`);

      let res: Response;
      try {
        res = await fetch(`${BASE}/v1/${resource}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "cv-ef-repository-code": String(repositoryCode), Accept: "application/json" },
          body: form,
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        });
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new EFaturaError(timeout ? "PE_TIMEOUT" : "PE_NETWORK", timeout ? "A plataforma não respondeu a tempo" : `Sem ligação à plataforma: ${e instanceof Error ? e.message : String(e)}`, true);
      }

      if (res.status === 401) {
        await this.auth.invalidate(); // the cached token may have been revoked; try once with a fresh one
        if (attempt === 0) continue;
        throw new EFaturaError("PE_UNAUTHORIZED", "A plataforma recusou o token de acesso (401)", false);
      }
      if (res.status === 403) {
        throw new EFaturaError("PE_FORBIDDEN", "Sem permissão na plataforma (403): verifique os scopes autorizados e se o NIF do emissor corresponde ao da conta", false);
      }
      const text = await res.text().catch(() => "");
      if (res.status >= 500 || res.status === 429) {
        // Log status only — platform bodies may echo patient data.
        this.logger.warn(`PE ${resource} answered ${res.status}`);
        throw new EFaturaError(`PE_HTTP_${res.status}`, `A plataforma devolveu um erro temporário (${res.status})`, true);
      }

      const results = parsePeResponse(text, res.headers.get("content-type") ?? "");
      if (results.length === 0) {
        if (res.ok) throw new EFaturaError("PE_BAD_RESPONSE", "Resposta da plataforma não reconhecida", true);
        throw new EFaturaError(`PE_HTTP_${res.status}`, `Pedido recusado pela plataforma (${res.status})`, false);
      }
      return results[0];
    }
  }

  /** True when the platform already holds a DFE with this IUD (used to reconcile before re-sending). */
  async dfeExists(iud: string, repositoryCode: number): Promise<boolean> {
    const token = await this.auth.getAccessToken();
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/dfe/xml/${encodeURIComponent(iud)}`, {
        headers: { Authorization: `Bearer ${token}`, "cv-ef-repository-code": String(repositoryCode), Accept: "application/xml" },
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      });
    } catch (e) {
      throw new EFaturaError("PE_NETWORK", `Sem ligação à plataforma: ${clip(e instanceof Error ? e.message : String(e), 200)}`, true);
    }
    if (res.status === 404) return false;
    if (res.status === 401 || res.status === 403) throw new EFaturaError(`PE_HTTP_${res.status}`, "Sem permissão para consultar o documento", false);
    if (!res.ok) throw new EFaturaError(`PE_HTTP_${res.status}`, `Consulta recusada (${res.status})`, res.status >= 500);
    return (await res.text()).includes("<Dfe");
  }
}
