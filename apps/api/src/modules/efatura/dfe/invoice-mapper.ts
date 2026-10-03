import { divRound, fmtCents, fmtScaled, rateToMilli, splitInclusive } from "./money";
import { normText } from "./dfe-xml";
import type { DfeLine, DfePayment, DfeTax, DfeTotals, DocKind } from "./dfe.types";

// Pure functions that turn CAP 360 billing data into the amounts and structures of a DFE.
// Everything here works on integer cents; nothing touches the database or the network.

/** TVE may omit the receiver only below this total (manual v11, RP-R). */
export const TVE_RECEIVER_THRESHOLD_CENTS = 20_000 * 100;

export interface TaxPolicy {
  typeCode: "NA" | "IVA";
  /** IVA rate in percent (CAP prices are tax-inclusive). */
  percentage?: number;
  /** NA exemption code (1–21). */
  exemptionReasonCode?: number;
}

export interface ItemInput {
  description: string;
  quantity: number;
  /** Line total in cents, negative for a discount line. */
  totalCents: number;
  serviceCode?: string | null;
  serviceName?: string | null;
}

export interface BuiltLines {
  lines: DfeLine[];
  totals: DfeTotals;
  /** Σ payable, in cents (= the invoice total when prices are tax-inclusive). */
  payableCents: number;
  /** The tax applied to every line (frozen on the invoice items so a credit note can mirror it). */
  tax: TaxPolicy;
}

const taxFor = (p: TaxPolicy): { rateMilli: number } => ({ rateMilli: p.typeCode === "IVA" ? rateToMilli(p.percentage ?? 0) : 0 });

/** The no-spaces code the platform wants in Item/EmitterIdentification (≤ 50 chars). */
export const itemCode = (code: string | null | undefined, fallback: string): string => {
  const c = (code ?? "").replace(/\s+/g, "").slice(0, 50);
  return c || fallback;
};

export function dfeTax(policy: TaxPolicy, taxCents?: number): DfeTax {
  return policy.typeCode === "NA"
    ? { typeCode: "NA", exemptionReasonCode: policy.exemptionReasonCode }
    : { typeCode: "IVA", percentage: fmtScaled(rateToMilli(policy.percentage ?? 0), 3), taxTotal: taxCents === undefined ? undefined : fmtCents(taxCents) };
}

/** Lines and totals the way the platform re-computes them (manual v11 §6.3.18):
 *  - positive items are N lines, negative ones (health-plan coverage) become D lines with positive amounts;
 *  - IVA is extracted from the tax-inclusive total of each line, rounded half-up to the cent;
 *  - Payable = Net + Tax, so it equals the invoice total and what the patient actually pays. */
export function buildLines(items: ItemInput[], policy: TaxPolicy): BuiltLines {
  const { rateMilli } = taxFor(policy);
  let pe = 0;
  let disc = 0;
  let net = 0;
  let tax = 0;
  let hasDeduction = false;

  const lines: DfeLine[] = items.map((it, i) => {
    const deduction = it.totalCents < 0;
    const gross = Math.abs(it.totalCents);
    const split = policy.typeCode === "IVA" ? splitInclusive(gross, rateMilli) : { net: gross, tax: 0 };
    const qty = deduction ? 1 : Math.max(1, it.quantity);
    const sign = deduction ? -1 : 1;
    pe += sign * split.net;
    net += sign * split.net;
    tax += sign * split.tax;
    if (deduction) {
      disc += split.net;
      hasDeduction = true;
    }
    return {
      id: i + 1,
      type: deduction ? "D" : "N",
      quantity: String(qty),
      unitCode: "EA",
      // unit price derived from the line total, to 5 decimals, so Quantity × Price ≈ PriceExtension
      price: fmtScaled(divRound(split.net * 1000, qty), 5),
      priceExtension: fmtCents(split.net),
      netTotal: fmtCents(split.net),
      tax: dfeTax(policy, policy.typeCode === "IVA" ? split.tax : undefined),
      code: deduction ? "DESCONTO" : itemCode(it.serviceCode, "SERVICO"),
      // catalogue name when there is one: it is controlled text, free-text descriptions are not
      description: normText(it.serviceName || it.description).slice(0, 300) || "Serviço",
    };
  });

  const payable = net + tax;
  return {
    lines,
    totals: {
      priceExtension: fmtCents(pe),
      discount: hasDeduction ? fmtCents(disc) : undefined,
      net: fmtCents(net),
      tax: fmtCents(tax),
      payable: fmtCents(payable),
    },
    payableCents: payable,
    tax: policy,
  };
}

/** UNECE payment means (UNECE D19B, as accepted by the XSD). */
export const PAYMENT_MEANS: Record<string, string> = {
  cash: "10", // in cash
  bank_transfer: "30", // credit transfer
  vinti4: "48", // bank card
  health_plan: "97", // clearing between partners
};

export interface PaymentInput {
  amountCents: number;
  method: string;
  reference?: string | null;
  paidAtCvDate: string; // "YYYY-MM-DD"
}

export const toDfePayment = (p: PaymentInput): DfePayment => ({
  meansCode: PAYMENT_MEANS[p.method] ?? "1", // 1 = instrument not defined
  reference: p.reference ? p.reference.replace(/\s+/g, "").slice(0, 50) || undefined : undefined,
  date: p.paidAtCvDate,
  amount: fmtCents(p.amountCents),
});

export type Decision =
  | { kind: Extract<DocKind, "invoice" | "invoice_receipt" | "sales_receipt"> }
  | { wait: "AWAITING_PAYMENT" | "NEEDS_NIF" | "NOTHING_TO_REPORT"; message: string };

/** Which document reports this invoice (manual v11 §6.4–6.6):
 *  - paid in full the day it is issued → FRE (receiver known) or TVE (private person, < 20 000 CVE);
 *  - otherwise → FTE, later settled by one RCE per payment. An FTE needs a receiver NIF. */
export function chooseDocument(input: { totalCents: number; paidSameDayCents: number; hasNif: boolean }): Decision {
  const { totalCents, paidSameDayCents, hasNif } = input;
  if (totalCents <= 0) return { wait: "NOTHING_TO_REPORT", message: "Fatura de valor zero: não é comunicada à DNRE" };
  const fullyPaid = paidSameDayCents >= totalCents;
  if (hasNif) return { kind: fullyPaid ? "invoice_receipt" : "invoice" };
  if (totalCents >= TVE_RECEIVER_THRESHOLD_CENTS) {
    return { wait: "NEEDS_NIF", message: "Faltam o NIF do paciente: obrigatório em faturas de 20 000 CVE ou mais" };
  }
  // No NIF and below the threshold: only a Talão de Venda (paid on the spot) is possible.
  return fullyPaid
    ? { kind: "sales_receipt" }
    : { wait: "AWAITING_PAYMENT", message: "Paciente sem NIF: o documento será emitido quando a fatura for paga na totalidade" };
}
