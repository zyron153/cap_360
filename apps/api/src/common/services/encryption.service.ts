import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Application-layer field encryption for sensitive columns (e.g. Patient.nif).
 * AES-256-GCM, stdlib only. Ciphertext format: "<ivHex>:<authTagHex>:<encryptedHex>".
 *
 * Encryption is non-deterministic (random IV per call), so it cannot be used for
 * equality lookups on its own — pair a column encrypted with `encrypt()` with a
 * sibling column storing `blindIndex()` of the same plaintext for exact-match search.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const hex = process.env.FIELD_ENCRYPTION_KEY;
    if (!hex) {
      throw new Error("FIELD_ENCRYPTION_KEY is not set — required for field-level encryption");
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error("FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes) for AES-256");
    }
    this.key = Buffer.from(hex, "hex");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) throw new Error("Malformed ciphertext");
    const [ivHex, authTagHex, dataHex] = parts;
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /** Deterministic HMAC-SHA256 of a plaintext value, for exact-match lookups on an encrypted column. */
  blindIndex(plaintext: string): string {
    return createHmac("sha256", this.key).update(`blind-index:${plaintext}`).digest("hex");
  }
}
