import { EncryptionService } from "./encryption.service";

const VALID_KEY = "a".repeat(64); // 32 bytes hex

function withKey(key: string | undefined) {
  const prev = process.env.FIELD_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = key;
  return () => {
    if (prev === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
    else process.env.FIELD_ENCRYPTION_KEY = prev;
  };
}

describe("EncryptionService", () => {
  it("round-trips a value through encrypt then decrypt", () => {
    const restore = withKey(VALID_KEY);
    const svc = new EncryptionService();
    const ciphertext = svc.encrypt("289959195");
    expect(ciphertext).not.toBe("289959195");
    expect(svc.decrypt(ciphertext)).toBe("289959195");
    restore();
  });

  it("produces a different ciphertext each time for the same plaintext (random IV)", () => {
    const restore = withKey(VALID_KEY);
    const svc = new EncryptionService();
    const a = svc.encrypt("289959195");
    const b = svc.encrypt("289959195");
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe("289959195");
    expect(svc.decrypt(b)).toBe("289959195");
    restore();
  });

  it("produces ciphertext long enough that VarChar(50) could never have held it", () => {
    const restore = withKey(VALID_KEY);
    const svc = new EncryptionService();
    expect(svc.encrypt("289959195").length).toBeGreaterThan(50);
    restore();
  });

  it("throws rather than silently returning garbage when the ciphertext was tampered with", () => {
    const restore = withKey(VALID_KEY);
    const svc = new EncryptionService();
    const ciphertext = svc.encrypt("289959195");
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === "00" ? "11" : "00");
    expect(() => svc.decrypt(tampered)).toThrow();
    restore();
  });

  it("blindIndex is deterministic for the same input, for exact-match lookups on encrypted columns", () => {
    const restore = withKey(VALID_KEY);
    const svc = new EncryptionService();
    expect(svc.blindIndex("289959195")).toBe(svc.blindIndex("289959195"));
    expect(svc.blindIndex("289959195")).not.toBe(svc.blindIndex("289959196"));
    restore();
  });

  it("fails fast at construction when FIELD_ENCRYPTION_KEY is missing", () => {
    const restore = withKey(undefined);
    expect(() => new EncryptionService()).toThrow(/FIELD_ENCRYPTION_KEY/);
    restore();
  });

  it("fails fast at construction when FIELD_ENCRYPTION_KEY is not valid 32-byte hex", () => {
    const restore = withKey("not-hex-and-wrong-length");
    expect(() => new EncryptionService()).toThrow(/FIELD_ENCRYPTION_KEY/);
    restore();
  });
});
