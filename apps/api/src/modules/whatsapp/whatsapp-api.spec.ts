import { createHmac } from "crypto";
import { verifySignature } from "./whatsapp-api";

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifySignature", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');

  it("accepts a correctly signed body", () => {
    expect(verifySignature(body, sign(body.toString(), "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(body, sign(body.toString(), "other"), "s3cret")).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = sign(body.toString(), "s3cret");
    expect(verifySignature(Buffer.from('{"object":"tampered"}'), header, "s3cret")).toBe(false);
  });

  it("fails closed when header, secret, or raw body is missing", () => {
    const header = sign(body.toString(), "s3cret");
    expect(verifySignature(body, undefined, "s3cret")).toBe(false);
    expect(verifySignature(body, header, undefined)).toBe(false);
    expect(verifySignature(undefined, header, "s3cret")).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    expect(verifySignature(body, "sha256=abc", "s3cret")).toBe(false);
  });
});
