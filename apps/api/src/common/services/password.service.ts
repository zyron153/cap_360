import { Injectable } from "@nestjs/common";
import { randomInt } from "crypto";
import * as argon2 from "argon2";

// Visually ambiguous characters (0/O, 1/l/I) are left out — the admin reads this password out or
// copies it into a message, so it must survive being transcribed by eye.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const pick = (chars: string) => chars[randomInt(chars.length)];

/** Hashes/verifies staff passwords with argon2id (OWASP-recommended default). */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed/foreign hash format — treat as "does not match" rather than a 500.
      return false;
    }
  }

  /** Random one-time password for a new / reset account. Always satisfies the password policy
   * (≥10 chars, an uppercase letter, a digit — see ResetPasswordSchema) and adds a lowercase letter
   * and a symbol on top; uses crypto.randomInt, never Math.random. */
  generateTemporary(length = 14): string {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < length) chars.push(pick(ALL));
    // Fisher–Yates, so the guaranteed characters above don't always sit at the front.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }
}
