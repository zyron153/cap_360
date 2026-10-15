import { Injectable, Logger } from "@nestjs/common";
import { EFaturaError, clip } from "../efatura.errors";

// Techplace (api.techplace.cv) — a certified CV invoicing backend that reports to DNRE for us.
// One fixed host from env, never admin-editable (no server-side SSRF surface). Envelope of every
// route: { success, msg, data } — and `success:false` can arrive with HTTP 200.
const BASE = `${(process.env.TECHPLACE_BASE_URL ?? "https://api.techplace.cv").replace(/\/$/, "")}/api/v1`;
const TIMEOUT_MS = 30_000;
const TOKEN_TTL_MS = 23 * 3_600_000; // the JWT lives 24 h and cannot be refreshed
/** fetch failures that happen before the request leaves this machine: safe to retry blindly. */
const PRE_SEND = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

/** The outcome of a sale whose POST may or may not have been recorded by Techplace. Never resent
 * automatically (Techplace has no documented idempotency): an admin checks, then retries. */
export const TECHPLACE_UNCERTAIN = "TECHPLACE_UNCERTAIN";

export interface TechplaceCreds {
  username?: string;
  password?: string;
  apiKey?: string;
}

/** A business answer from Techplace. Technical failures throw EFaturaError instead. */
export type TpResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface TpRow {
  id: string;
  name: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRows = (data: any, id: string[], name: string[]): TpRow[] =>
  (Array.isArray(data) ? data : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({
      id: String(id.map((k) => x?.[k]).find((v) => v != null) ?? ""),
      name: name.map((k) => x?.[k]).filter((v) => v != null).join(" · "),
    }))
    .filter((r: TpRow) => r.id);

@Injectable()
export class TechplaceClientService {
  private readonly logger = new Logger(TechplaceClientService.name);
  private readonly tokens = new Map<string, { token: string; at: number }>();

  private async token(c: TechplaceCreds, fresh = false): Promise<string | null> {
    if (!c.username || !c.password) return null;
    const hit = this.tokens.get(c.username);
    if (hit && !fresh && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
    const r = await this.call<{ token?: string }>("POST", "/auth", {}, { username: c.username, password: c.password }, false);
    if (!r.ok || !r.data?.token) throw new EFaturaError("TP_UNAUTHORIZED", "O Techplace recusou o utilizador ou a palavra-passe", false);
    this.tokens.set(c.username, { token: r.data.token, at: Date.now() });
    return r.data.token;
  }

  /** One HTTP call. `write` = a POST whose effect must not be repeated blindly, so any failure
   * that leaves the outcome unknown becomes TECHPLACE_UNCERTAIN instead of a retryable error. */
  private async call<T>(method: "GET" | "POST", path: string, c: TechplaceCreds, body?: unknown, write = false, retry401 = true): Promise<TpResult<T>> {
    const token = path === "/auth" ? null : await this.token(c);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (c.apiKey) {
      headers["api-key"] = c.apiKey; // the docs say both spellings
      headers["x-api-key"] = c.apiKey;
    }
    const unknownOutcome = (message: string) => new EFaturaError(write ? TECHPLACE_UNCERTAIN : "TP_NETWORK", message, !write);

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const code = (e as { cause?: { code?: string } }).cause?.code ?? "";
      if (PRE_SEND.has(code)) throw new EFaturaError("TP_NETWORK", "Sem ligação ao Techplace", true);
      throw unknownOutcome("O Techplace não respondeu: verifique se a venda foi criada antes de tentar de novo");
    }

    if (res.status === 401 && token && retry401) {
      this.tokens.delete(c.username as string);
      return this.call<T>(method, path, c, body, write, false);
    }
    if (res.status === 401 || res.status === 403) throw new EFaturaError("TP_UNAUTHORIZED", `O Techplace recusou as credenciais (${res.status})`, false);
    if (res.status === 429) throw new EFaturaError("TP_HTTP_429", "O Techplace pediu para abrandar (429)", true);
    if (res.status >= 500) {
      // status only — bodies may echo patient data
      this.logger.warn(`Techplace ${method} ${path} answered ${res.status}`);
      throw unknownOutcome(`O Techplace devolveu um erro (${res.status})${write ? ": verifique se a venda foi criada antes de tentar de novo" : ""}`);
    }

    const text = await res.text().catch(() => "");
    let env: { success?: boolean; msg?: string; message?: string; data?: T & { error_code?: string } } = {};
    try {
      env = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (env.success === undefined) {
      if (res.ok) throw unknownOutcome("Resposta do Techplace não reconhecida");
      return { ok: false, code: `TP_HTTP_${res.status}`, message: `Pedido recusado pelo Techplace (${res.status})` };
    }
    if (!res.ok || env.success === false) {
      return { ok: false, code: String(env.data?.error_code ?? `TP_HTTP_${res.status}`).slice(0, 50), message: clip(env.msg ?? env.message ?? "Pedido recusado pelo Techplace") };
    }
    return { ok: true, data: env.data as T };
  }

  /** POST /fatura/sincronizador — issues one sale. */
  async issue(c: TechplaceCreds, body: unknown): Promise<TpResult<{ faturaId: string; vendaCode: string }>> {
    const r = await this.call<{ faturaId?: string; vendaCode?: string }>("POST", "/fatura/sincronizador", c, body, true);
    if (!r.ok) return r;
    if (!r.data?.faturaId || !r.data.vendaCode) throw new EFaturaError(TECHPLACE_UNCERTAIN, "O Techplace aceitou a venda mas não devolveu o identificador: verifique no Techplace", false);
    return { ok: true, data: { faturaId: r.data.faturaId, vendaCode: r.data.vendaCode } };
  }

  /** POST /produto/registrar — creates a service as a product; Techplace answers with its id once. */
  async registerProduct(c: TechplaceCreds, body: unknown): Promise<TpResult<{ produtoID: string }>> {
    const r = await this.call<{ produtoID?: string }>("POST", "/produto/registrar", c, body);
    if (!r.ok) return r;
    if (!r.data?.produtoID) throw new EFaturaError("TP_BAD_RESPONSE", "O Techplace não devolveu o ID do produto", true);
    return { ok: true, data: { produtoID: r.data.produtoID } };
  }

  /** POST /cliente/sincronizador — creates the fiscal customer (name + NIF) the sale refers to. */
  syncCustomer(c: TechplaceCreds, body: unknown): Promise<TpResult<unknown>> {
    return this.call("POST", "/cliente/sincronizador", c, body);
  }

  /** GET /venda/id — the total Techplace recorded for the sale (null when the answer isn't readable). */
  async saleTotal(c: TechplaceCreds, faturaId: string): Promise<number | null> {
    const r = await this.call<{ VALOR_FATURA?: number | string }[]>("GET", `/venda/id?id=${encodeURIComponent(faturaId)}`, c);
    const v = r.ok && Array.isArray(r.data) ? r.data[0]?.VALOR_FATURA : undefined;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }

  /** The three reference lists an admin copies ids from ("Testar ligação"). */
  async lookups(c: TechplaceCreds): Promise<{ tipos: TpRow[]; metodos: TpRow[]; condicoes: TpRow[] }> {
    const [tipos, metodos, condicoes] = await Promise.all(
      ["/fatura/tipo", "/fatura/metodo/pagamento", "/fatura/condicao/pagamento"].map((p) => this.call<unknown>("GET", p, c))
    );
    for (const r of [tipos, metodos, condicoes]) if (!r.ok) throw new EFaturaError(r.code, r.message, false);
    return {
      // `tipoFatura` takes the short code ("FR", "TV"), the others take the record id
      tipos: asRows((tipos as { data: unknown }).data, ["DESIG"], ["DESIG", "DESCR"]).map((r) => ({ id: r.id, name: r.name })),
      metodos: asRows((metodos as { data: unknown }).data, ["ID", "id"], ["DESIG", "DESCR", "nome", "designacao"]),
      condicoes: asRows((condicoes as { data: unknown }).data, ["ID", "id"], ["DESIG", "DESCR", "nome", "designacao"]),
    };
  }
}
