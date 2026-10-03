// All fiscal arithmetic runs on integer cents — never floats — so totals add up to the cent the
// way the platform re-computes them (Quantity × Price = PriceExtension, Net + Tax = Payable).

/** A Prisma Decimal(10,2) / number / numeric string → integer cents. */
export const toCents = (v: unknown): number => Math.round(Number(v) * 100);

/** Integer division rounded half away from zero (a, b integers, b > 0). */
export function divRound(a: number, b: number): number {
  const q = Math.floor((2 * Math.abs(a) + b) / (2 * b));
  return a < 0 ? -q : q;
}

/** `n` counts units of 10^-decimals; rendered without insignificant zeros ("30000", "12.5"). */
export function fmtScaled(n: number, decimals: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const scale = 10 ** decimals;
  const int = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export const fmtCents = (cents: number): string => fmtScaled(cents, 2);

/** Splits a tax-INCLUSIVE amount. `rateMilli` is the rate in thousandths of a percent (15% = 15000). */
export function splitInclusive(grossCents: number, rateMilli: number): { net: number; tax: number } {
  const net = divRound(grossCents * 100_000, 100_000 + rateMilli);
  return { net, tax: grossCents - net };
}

/** "15" / "7.5" → 15000 / 7500 (thousandths of a percent). */
export const rateToMilli = (pct: number): number => Math.round(pct * 1000);
