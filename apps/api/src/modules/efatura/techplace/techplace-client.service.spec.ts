import { TechplaceClientService, TECHPLACE_UNCERTAIN } from "./techplace-client.service";
import { EFaturaError } from "../efatura.errors";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }) as unknown as Response;
const ok = (data: unknown) => res(200, { success: true, msg: "Operação bem sucedida", data });
const netError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

const KEY = { apiKey: "k-1" };
const LOGIN = { username: "cap", password: "pw" };

let fetchMock: jest.SpyInstance;
let client: TechplaceClientService;

beforeEach(() => {
  fetchMock = jest.spyOn(global, "fetch");
  client = new TechplaceClientService();
});
afterEach(() => fetchMock.mockRestore());

const caught = async (p: Promise<unknown>): Promise<EFaturaError> => {
  try {
    await p;
  } catch (e) {
    return e as EFaturaError;
  }
  throw new Error("expected a rejection");
};

describe("TechplaceClientService.issue", () => {
  it("posts the sale with the api key and returns the sale's id and number", async () => {
    fetchMock.mockResolvedValueOnce(ok({ faturaId: "f-1", vendaCode: "FRAA-9" }));
    expect(await client.issue(KEY, { CODIGO_EXT: "sub-1" })).toEqual({ ok: true, data: { faturaId: "f-1", vendaCode: "FRAA-9" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.techplace.cv/api/v1/fatura/sincronizador");
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("k-1");
    expect(init.headers["x-api-key"]).toBe("k-1");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ CODIGO_EXT: "sub-1" });
  });

  it("treats success:false — even on HTTP 200 — as a refusal carrying Techplace's message and code", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { success: false, msg: "Estoque insuficiente", data: { error_code: "INSUFFICIENT_STOCK" } }));
    expect(await client.issue(KEY, {})).toEqual({ ok: false, code: "INSUFFICIENT_STOCK", message: "Estoque insuficiente" });
  });

  it("reads a 4xx refusal the same way", async () => {
    fetchMock.mockResolvedValueOnce(res(400, { success: false, msg: "O campo 'entidadeID' é obrigatório", data: null }));
    expect(await client.issue(KEY, {})).toMatchObject({ ok: false, code: "TP_HTTP_400" });
  });

  it("logs in once, reuses the token, and re-authenticates exactly once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ token: "jwt-1" })) // /auth
      .mockResolvedValueOnce(res(401, { success: false, msg: "Token expired" }))
      .mockResolvedValueOnce(ok({ token: "jwt-2" })) // /auth again
      .mockResolvedValueOnce(ok({ faturaId: "f-1", vendaCode: "FRAA-9" }));
    expect((await client.issue(LOGIN, {})).ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer jwt-2");

    fetchMock.mockResolvedValueOnce(ok({ faturaId: "f-2", vendaCode: "FRAA-10" }));
    await client.issue(LOGIN, {});
    expect(fetchMock).toHaveBeenCalledTimes(5); // no third login: the token is cached
  });

  it("gives up with a non-retryable error when the 401 repeats", async () => {
    fetchMock.mockResolvedValue(res(401, { success: false, msg: "no" }));
    const e = await caught(client.issue(KEY, {}));
    expect(e.code).toBe("TP_UNAUTHORIZED");
    expect(e.retryable).toBe(false);
  });

  it("retries safely when the request never left (connection refused)", async () => {
    fetchMock.mockRejectedValueOnce(netError("ECONNREFUSED"));
    const e = await caught(client.issue(KEY, {}));
    expect(e).toMatchObject({ code: "TP_NETWORK", retryable: true });
  });

  it.each([
    ["a timeout", () => fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }))],
    ["a reset after sending", () => fetchMock.mockRejectedValueOnce(netError("ECONNRESET"))],
    ["a 502", () => fetchMock.mockResolvedValueOnce(res(502, "bad gateway"))],
    ["a 200 with an unreadable body", () => fetchMock.mockResolvedValueOnce(res(200, "<html>proxy</html>"))],
  ])("never auto-resends a sale after %s: the outcome is unknown", async (_name, arrange) => {
    arrange();
    const e = await caught(client.issue(KEY, {}));
    expect(e).toMatchObject({ code: TECHPLACE_UNCERTAIN, retryable: false });
  });

  it("does not trust an accepted sale without its id", async () => {
    fetchMock.mockResolvedValueOnce(ok({ vendaCode: "FRAA-9" }));
    expect((await caught(client.issue(KEY, {}))).code).toBe(TECHPLACE_UNCERTAIN);
  });

  it("asks to slow down on 429 (retryable, nothing was processed)", async () => {
    fetchMock.mockResolvedValueOnce(res(429, ""));
    expect(await caught(client.issue(KEY, {}))).toMatchObject({ code: "TP_HTTP_429", retryable: true });
  });
});

describe("TechplaceClientService other calls", () => {
  it("a read that fails technically is simply retryable", async () => {
    fetchMock.mockResolvedValueOnce(res(503, ""));
    expect(await caught(client.saleTotal(KEY, "f-1"))).toMatchObject({ code: "TP_NETWORK", retryable: true });
  });

  it("returns the total Techplace recorded, or null when it cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(ok([{ VALOR_FATURA: "3000.00" }]));
    expect(await client.saleTotal(KEY, "f 1")).toBe(3000);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.techplace.cv/api/v1/venda/id?id=f%201");
    fetchMock.mockResolvedValueOnce(ok([]));
    expect(await client.saleTotal(KEY, "f-1")).toBeNull();
    fetchMock.mockResolvedValueOnce(res(404, { success: false, msg: "Venda não encontrada" }));
    expect(await client.saleTotal(KEY, "f-1")).toBeNull();
  });

  it("registers a product and returns its id once", async () => {
    fetchMock.mockResolvedValueOnce(ok({ produtoID: "prod-1" }));
    expect(await client.registerProduct(KEY, { DESIG: "Consulta" })).toEqual({ ok: true, data: { produtoID: "prod-1" } });
    fetchMock.mockResolvedValueOnce(res(400, { success: false, msg: "Produto já existe", data: { error_code: "DUPLICATE_ENTRY" } }));
    expect(await client.registerProduct(KEY, {})).toMatchObject({ ok: false, code: "DUPLICATE_ENTRY" });
  });

  it("lists the reference ids an admin copies into the settings", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([{ ID: "t-1", DESIG: "FR", DESCR: "Fatura-Recibo" }]))
      .mockResolvedValueOnce(ok([{ ID: "m-1", DESIG: "Dinheiro" }]))
      .mockResolvedValueOnce(ok([{ id: "c-1", DESCR: "30 dias" }]));
    expect(await client.lookups(KEY)).toEqual({
      tipos: [{ id: "FR", name: "FR · Fatura-Recibo" }],
      metodos: [{ id: "m-1", name: "Dinheiro" }],
      condicoes: [{ id: "c-1", name: "30 dias" }],
    });
  });

  it("never logs or surfaces a platform body that could echo patient data", async () => {
    fetchMock.mockResolvedValueOnce(res(500, "NIF 987654321 Maria Paciente"));
    const e = await caught(client.issue(KEY, {}));
    expect(e.message).not.toContain("987654321");
    expect(e.message).not.toContain("Maria");
  });
});
