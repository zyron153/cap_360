import { EFaturaClientService, parsePeResponse } from "./efatura-client.service";

const auth = { getAccessToken: jest.fn(), invalidate: jest.fn() };

const res = (status: number, body: string, contentType = "application/json") =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  }) as unknown as Response;

const OK_JSON = JSON.stringify({
  responses: [{ succeeded: true, entryName: "CV123.xml", authorizedDateTime: "2026-10-03T11:00:00", messages: [] }],
});
const REJECTED_JSON = JSON.stringify({
  responses: [
    {
      succeeded: false,
      entryName: "CV123.xml",
      messages: [{ code: "EP-TID-V", source: "BIZ", type: "ERROR", description: "NIF do Emissor não corresponde ao NIF do utilizador autenticado", location: "Dfe/Invoice/EmitterParty" }],
    },
  ],
});

let fetchMock: jest.SpyInstance;
let client: EFaturaClientService;

beforeEach(() => {
  jest.clearAllMocks();
  auth.getAccessToken.mockResolvedValue("tok-1");
  fetchMock = jest.spyOn(global, "fetch");
  client = new EFaturaClientService(auth as never);
});
afterEach(() => fetchMock.mockRestore());

describe("parsePeResponse", () => {
  it("reads the documented JSON shape", () => {
    expect(parsePeResponse(OK_JSON, "application/json")).toEqual([
      expect.objectContaining({ succeeded: true, entryName: "CV123.xml", authorizedAt: new Date("2026-10-03T11:00:00"), messages: [] }),
    ]);
  });

  it("carries the platform's messages on a rejection", () => {
    const [r] = parsePeResponse(REJECTED_JSON, "application/json");
    expect(r.succeeded).toBe(false);
    expect(r.messages[0]).toMatchObject({ code: "EP-TID-V", type: "ERROR", location: "Dfe/Invoice/EmitterParty" });
  });

  it("tolerates capitalised (XML-derived) JSON keys", () => {
    const body = JSON.stringify({ Responses: [{ Succeeded: "true", EntryName: "a.xml", Messages: [] }] });
    expect(parsePeResponse(body, "application/json")[0]).toMatchObject({ succeeded: true, entryName: "a.xml" });
  });

  it("falls back to the XML flavour", () => {
    const xml =
      '<Responses><Response Succeeded="false"><EntryName>a.xml</EntryName><Messages><Message><Source>BIZ</Source><Type>ERROR</Type><Code>X-1</Code><Description>Falhou</Description></Message></Messages></Response></Responses>';
    const [r] = parsePeResponse(xml, "application/xml");
    expect(r).toMatchObject({ succeeded: false, entryName: "a.xml" });
    expect(r.messages[0]).toMatchObject({ code: "X-1", description: "Falhou" });
  });

  it("returns nothing for garbage", () => {
    expect(parsePeResponse("<html>502 Bad Gateway</html>", "text/html")).toEqual([]);
    expect(parsePeResponse("not json {", "application/json")).toEqual([]);
    expect(parsePeResponse("", "")).toEqual([]);
  });
});

describe("EFaturaClientService.post", () => {
  const zip = Buffer.from("PK-fake-zip");

  it("sends multipart with bearer token, repository header and the ZIP in the `file` part", async () => {
    fetchMock.mockResolvedValue(res(200, OK_JSON));

    const r = await client.post("dfe", zip, 2);

    expect(r.succeeded).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.efatura.cv/v1/dfe");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok-1", "cv-ef-repository-code": "2", Accept: "application/json" });
    const file = (init.body as FormData).get("file") as File;
    expect(file.type).toBe("application/octet-stream");
    expect(Buffer.from(await file.arrayBuffer()).equals(zip)).toBe(true);
  });

  it("posts events to /v1/event", async () => {
    fetchMock.mockResolvedValue(res(200, OK_JSON));
    await client.post("event", zip, 1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://services.efatura.cv/v1/event");
    expect(fetchMock.mock.calls[0][1].headers["cv-ef-repository-code"]).toBe("1");
  });

  it("returns a business rejection (HTTP 200, succeeded=false) as a result, not an exception", async () => {
    fetchMock.mockResolvedValue(res(200, REJECTED_JSON));
    const r = await client.post("dfe", zip, 2);
    expect(r.succeeded).toBe(false);
    expect(r.messages[0].code).toBe("EP-TID-V");
  });

  it("treats a 4xx with a parseable body as a rejection too", async () => {
    fetchMock.mockResolvedValue(res(400, REJECTED_JSON));
    expect((await client.post("dfe", zip, 2)).succeeded).toBe(false);
  });

  it("on 401 drops the cached token and retries once with a fresh one", async () => {
    auth.getAccessToken.mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    fetchMock.mockResolvedValueOnce(res(401, "")).mockResolvedValueOnce(res(200, OK_JSON));

    expect((await client.post("dfe", zip, 2)).succeeded).toBe(true);

    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("a second 401 is a credentials problem, not worth retrying", async () => {
    fetchMock.mockResolvedValue(res(401, ""));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_UNAUTHORIZED", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("403 means missing scope / NIF mismatch — not retryable", async () => {
    fetchMock.mockResolvedValue(res(403, ""));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_FORBIDDEN", retryable: false });
  });

  it.each([500, 502, 503, 429])("%s is a transient failure worth retrying", async (status) => {
    fetchMock.mockResolvedValue(res(status, "<html>oops</html>", "text/html"));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: `PE_HTTP_${status}`, retryable: true });
  });

  it("a timeout is retryable", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_TIMEOUT", retryable: true });
  });

  it("a network error is retryable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_NETWORK", retryable: true });
  });

  it("an unreadable 200 is retried; an unreadable 4xx is not", async () => {
    fetchMock.mockResolvedValueOnce(res(200, "<html>proxy page</html>", "text/html"));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_BAD_RESPONSE", retryable: true });
    fetchMock.mockResolvedValueOnce(res(404, "nope", "text/plain"));
    await expect(client.post("dfe", zip, 2)).rejects.toMatchObject({ code: "PE_HTTP_404", retryable: false });
  });

  it("never puts the response body in the error (it may echo patient data)", async () => {
    fetchMock.mockResolvedValue(res(502, "Maria Paciente NIF 987654321"));
    await expect(client.post("dfe", zip, 2)).rejects.not.toThrow(/Maria|987654321/);
  });

  it("uses a request timeout", async () => {
    fetchMock.mockResolvedValue(res(200, OK_JSON));
    await client.post("dfe", zip, 2);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("EFaturaClientService.dfeExists", () => {
  it("true when the platform returns the DFE", async () => {
    fetchMock.mockResolvedValue(res(200, '<?xml version="1.0"?><Dfe xmlns="urn:cv:efatura:xsd:v1.0"/>', "application/xml"));
    expect(await client.dfeExists("CV123", 2)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://services.efatura.cv/v1/dfe/xml/CV123");
  });

  it("false on 404", async () => {
    fetchMock.mockResolvedValue(res(404, ""));
    expect(await client.dfeExists("CV123", 2)).toBe(false);
  });

  it("throws (so nothing is re-sent blindly) when the platform cannot say", async () => {
    fetchMock.mockResolvedValue(res(503, ""));
    await expect(client.dfeExists("CV123", 2)).rejects.toMatchObject({ retryable: true });
    fetchMock.mockResolvedValue(res(403, ""));
    await expect(client.dfeExists("CV123", 2)).rejects.toMatchObject({ retryable: false });
  });
});
