import { randomInt } from "crypto";

/** Luhn check digit as specified in the Manual Técnico (ch. 6.2): digits are weighted 2,1,2,1…
 * from the RIGHT, products > 9 lose 9, and DV = (sum × 9) mod 10. */
export function luhnDv(digits: string): number {
  let sum = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    let p = Number(digits[i]) * ((n - i) % 2 === 1 ? 2 : 1);
    if (p > 9) p -= 9;
    sum += p;
  }
  return (sum * 9) % 10;
}

export interface IudInput {
  repositoryCode: 1 | 2 | 3;
  /** "YYMMDD" of the issue date in Cabo Verde time. */
  yymmdd: string;
  nif: string;
  ledCode: number;
  documentTypeCode: number;
  documentNumber: number;
  /** 10 random digits; generated when omitted. */
  random?: string;
}

/** The 45-character Identificador Único de DFE:
 * CV + repository(1) + YYMMDD(6) + NIF(9) + LED(5) + type(2) + number(9) + random(10) + DV(1). */
export function buildIud(i: IudInput): string {
  const random = i.random ?? String(randomInt(0, 10_000_000_000)).padStart(10, "0");
  const body =
    `${i.repositoryCode}${i.yymmdd}${i.nif}` +
    `${String(i.ledCode).padStart(5, "0")}${String(i.documentTypeCode).padStart(2, "0")}` +
    `${String(i.documentNumber).padStart(9, "0")}${random}`;
  return `CV${body}${luhnDv(body)}`;
}

/** Event ids are CV + repository + YYMMDDHHMMSS + NIF (24 chars) and double as the ZIP entry name. */
export function buildEventId(repositoryCode: 1 | 2 | 3, yymmddhhmmss: string, nif: string): string {
  return `CV${repositoryCode}${yymmddhhmmss}${nif}`;
}
