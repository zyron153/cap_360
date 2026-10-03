import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

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
}
