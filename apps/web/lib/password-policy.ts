/** Mirrors the API's password policy (PasswordSchema in packages/types/src/auth.ts): 10–72
 * characters, at least one uppercase letter and one digit. The API is the source of truth — this
 * only lets the UI show the rules up front and report progress while the user types. */

export type PasswordRuleItem = { label: string; met: boolean };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_RULE_SUMMARY = "pelo menos 10 caracteres, uma maiúscula e um número";

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && /[A-Z]/.test(password) && /\d/.test(password);
}

// Visually ambiguous characters (0/O, 1/l/I) are left out — an admin reads a generated password out
// or pastes it into a message, so it has to survive being transcribed by eye.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";

/** Uniform random index below `max` using the browser CSPRNG (rejection sampling, so no modulo bias). */
function randomIndex(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

/** The "Gerar" button: a random strong password that always satisfies the policy above (and adds a
 * lowercase letter and a symbol on top). Generated in the browser — it never touches the API until
 * the admin saves it as the user's password. */
export function generatePassword(length = 14): string {
  const pick = (chars: string) => chars[randomIndex(chars.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates, so the guaranteed characters above don't always sit at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** One entry per rule, in the order they're shown. */
export function passwordPolicyItems(password: string): PasswordRuleItem[] {
  return [
    { label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`, met: password.length >= PASSWORD_MIN_LENGTH },
    { label: "Uma letra maiúscula (A–Z)", met: /[A-Z]/.test(password) },
    { label: "Um número (0–9)", met: /\d/.test(password) },
  ];
}
