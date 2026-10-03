// Input model for the XML builders. Amounts are already formatted decimal strings (see money.ts);
// the builders only lay them out in the element order the XSD (EnvelopedSignature.xsd) demands.

export type DocKind = "invoice" | "invoice_receipt" | "sales_receipt" | "receipt" | "credit_note";

export const DOC_TYPE_CODE: Record<DocKind, number> = {
  invoice: 1, // FTE
  invoice_receipt: 2, // FRE
  sales_receipt: 3, // TVE
  receipt: 4, // RCE
  credit_note: 5, // NCE
};

export const ROOT_ELEMENT: Record<DocKind, string> = {
  invoice: "Invoice",
  invoice_receipt: "InvoiceReceipt",
  sales_receipt: "SalesReceipt",
  receipt: "Receipt",
  credit_note: "CreditNote",
};

export interface DfeTax {
  typeCode: "NA" | "IVA";
  /** IVA: rate in percent, e.g. "15". */
  percentage?: string;
  /** NA: code from DNRE's "Motivos de Não Liquidação" list (1–21). */
  exemptionReasonCode?: number;
  /** IVA on lines: the line's tax amount, so the platform doesn't have to derive it. */
  taxTotal?: string;
}

export interface DfeParty {
  taxId: string;
  name: string;
  address?: { detail: string; code?: string };
  /** Digits only. */
  phone?: string;
  email?: string;
}

export interface DfeLine {
  id: number;
  /** N = normal · D = deduction (e.g. a health-plan coverage discount; amounts stay positive). */
  type: "N" | "D";
  quantity: string;
  unitCode: string;
  price: string;
  priceExtension: string;
  netTotal: string;
  tax: DfeTax;
  /** Item/EmitterIdentification — no spaces, ≤ 50 chars. */
  code: string;
  description: string;
}

export interface DfeTotals {
  priceExtension: string;
  /** Only when there are deduction lines. */
  discount?: string;
  net: string;
  tax: string;
  payable: string;
}

export interface DfePayment {
  /** UNECE payment means code: 10 cash · 30 credit transfer · 48 bank card · 97 clearing. */
  meansCode: string;
  reference?: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: string;
}

export interface DfeReference {
  /** IUD of the referenced DFE. */
  iud: string;
  paymentAmount?: string;
  tax?: DfeTax;
}

export interface DfeTransmission {
  /** 1 = online. (Offline/Off contingency is not implemented.) */
  issueMode: 1;
  transmitterTaxId: string;
  software: { code: string; name: string; version: string };
}

export interface DfeInput {
  kind: DocKind;
  iud: string;
  ledCode: number;
  serie: string;
  documentNumber: number;
  /** The clinic's own invoice number, kept for cross-reference (no spaces, ≤ 50). */
  innerNumber?: string;
  issueDate: string;
  issueTime: string;
  isSpecimen?: boolean;
  emitter: DfeParty;
  receiver?: DfeParty;
  lines?: DfeLine[];
  totals?: DfeTotals;
  payments?: DfePayment[];
  references?: DfeReference[];
  /** Receipt (RCE) type: 2 = Serviço. */
  receiptTypeCode?: 2;
  /** Credit note reason code (see CREDIT_NOTE_REASON_CODES). */
  issueReasonCode?: string;
  /** Required (≥ 10 chars) on credit notes. */
  note?: string;
  transmission: DfeTransmission;
  repositoryCode: 1 | 2 | 3;
}

export interface EventInput {
  /** Cancel/annul one or more authorized DFEs. */
  type: "FDC";
  id: string;
  emitterTaxId: string;
  /** "YYYY-MM-DDTHH:MM:SS" */
  issueDateTime: string;
  /** ≥ 10 chars. */
  reason: string;
  iuds: string[];
  transmission: DfeTransmission;
  repositoryCode: 1 | 2 | 3;
}
