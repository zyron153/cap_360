// Wire-level check: the real fetch/FormData/Blob stack against a local HTTP server, so the bytes
// that would reach services.efatura.cv (multipart framing, headers) are verified, not just mocked.
import { createServer, type IncomingMessage, type Server } from "http";
import type { AddressInfo } from "net";
import { unzipSync } from "fflate";

let server: Server;
let captured: { method?: string; url?: string; headers: IncomingMessage["headers"]; body: Buffer } | null;
let respond: (status: number, body: string) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      captured = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      respond = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      };
      respond(200, JSON.stringify({ responses: [{ succeeded: true, entryName: "x.xml", authorizedDateTime: "2026-10-03T11:00:00", messages: [] }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.EFATURA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe("EFaturaClientService over real HTTP", () => {
  it("sends a multipart/form-data body whose `file` part is the exact ZIP, with auth + repository headers", async () => {
    const { EFaturaClientService } = await import("./efatura-client.service"); // after the env override
    const { zipXml } = await import("./dfe/zip");
    const zip = zipXml("CV2261003123456789000010100000000100000000014.xml", "<Dfe>é ü ✓</Dfe>");
    const client = new EFaturaClientService({ getAccessToken: async () => "tok-xyz", invalidate: async () => undefined } as never);

    const result = await client.post("dfe", zip, 2);

    expect(result.succeeded).toBe(true);
    expect(captured?.method).toBe("POST");
    expect(captured?.url).toBe("/v1/dfe");
    expect(captured?.headers.authorization).toBe("Bearer tok-xyz");
    expect(captured?.headers["cv-ef-repository-code"]).toBe("2");
    expect(captured?.headers.accept).toBe("application/json");

    const type = String(captured?.headers["content-type"]);
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
    const raw = captured!.body.toString("latin1");
    expect(raw).toMatch(/Content-Disposition: form-data; name="file"; filename="dfe\.zip"/);
    expect(raw).toMatch(/Content-Type: application\/octet-stream/);

    // carve the binary payload out of the framing and compare with what was sent
    const start = captured!.body.indexOf("\r\n\r\n") + 4;
    const boundary = "--" + type.split("boundary=")[1];
    const end = captured!.body.lastIndexOf(Buffer.from(`\r\n${boundary}`));
    const payload = captured!.body.subarray(start, end);
    expect(payload.equals(zip)).toBe(true);
    const files = unzipSync(new Uint8Array(payload));
    expect(Object.keys(files)).toEqual(["CV2261003123456789000010100000000100000000014.xml"]);
  });
});
