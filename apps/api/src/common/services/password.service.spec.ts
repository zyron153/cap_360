import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  describe("hash", () => {
    it("produces an argon2id hash string, not the plaintext", async () => {
      const hash = await service.hash("Correct-Horse-1");
      expect(hash).not.toBe("Correct-Horse-1");
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it("produces a different hash each time (random salt)", async () => {
      const h1 = await service.hash("Correct-Horse-1");
      const h2 = await service.hash("Correct-Horse-1");
      expect(h1).not.toBe(h2);
    });
  });

  describe("verify", () => {
    it("returns true for the correct password against its own hash", async () => {
      const hash = await service.hash("Correct-Horse-1");
      await expect(service.verify(hash, "Correct-Horse-1")).resolves.toBe(true);
    });

    it("returns false for a wrong password", async () => {
      const hash = await service.hash("Correct-Horse-1");
      await expect(service.verify(hash, "wrong-password")).resolves.toBe(false);
    });

    it("returns false (not throw) against a malformed hash", async () => {
      await expect(service.verify("not-a-real-hash", "anything")).resolves.toBe(false);
    });
  });
});
