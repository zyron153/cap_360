/** A failure while talking to (or preparing a document for) the e-Fatura platform.
 * `retryable` = trying again unchanged can succeed (network, 5xx, expired token that refreshes);
 * false = a human must fix something first (credentials, data, configuration). */
export class EFaturaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true
  ) {
    super(message);
    this.name = "EFaturaError";
  }
}

/** Fits a message into the VarChar(500) error column. */
export const clip = (s: string, n = 500): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
