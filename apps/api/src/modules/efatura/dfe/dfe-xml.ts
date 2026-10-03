import {
  DOC_TYPE_CODE,
  ROOT_ELEMENT,
  type DfeInput,
  type DfeLine,
  type DfeParty,
  type DfeTax,
  type DfeTransmission,
  type EventInput,
} from "./dfe.types";

export const DFE_NAMESPACE = "urn:cv:efatura:xsd:v1.0";

/** Escapes text/attribute content and drops characters XML 1.0 forbids. */
export function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The XSD's "no extra spaces" text type: trimmed, single inner spaces. */
export const normText = (s: string): string => s.replace(/\s+/g, " ").trim();

const el = (name: string, value: string | number, attrs = ""): string =>
  `<${name}${attrs ? ` ${attrs}` : ""}>${esc(String(value))}</${name}>`;

function tax(t: DfeTax): string {
  const body =
    t.typeCode === "NA"
      ? el("TaxExemptionReasonCode", t.exemptionReasonCode ?? 0)
      : el("TaxPercentage", t.percentage ?? "0") + (t.taxTotal !== undefined ? el("TaxTotal", t.taxTotal) : "");
  return `<Tax TaxTypeCode="${t.typeCode}">${body}</Tax>`;
}

function party(tag: "EmitterParty" | "ReceiverParty", p: DfeParty): string {
  const addr = p.address
    ? `<Address CountryCode="CV">${el("AddressDetail", p.address.detail)}${p.address.code ? el("AddressCode", p.address.code) : ""}</Address>`
    : "";
  const contacts =
    p.phone || p.email
      ? `<Contacts>${p.phone ? el("Telephone", p.phone) : ""}${p.email ? el("Email", p.email) : ""}</Contacts>`
      : "";
  return `<${tag}>${el("TaxId", p.taxId, 'CountryCode="CV"')}${el("Name", p.name)}${addr}${contacts}</${tag}>`;
}

function line(l: DfeLine): string {
  return (
    `<Line${l.type === "D" ? ' LineTypeCode="D"' : ""}>` +
    el("Id", l.id) +
    el("Quantity", l.quantity, `UnitCode="${esc(l.unitCode)}"`) +
    el("Price", l.price) +
    el("PriceExtension", l.priceExtension) +
    el("NetTotal", l.netTotal) +
    tax(l.tax) +
    `<Item>${el("Description", l.description)}${el("EmitterIdentification", l.code)}</Item>` +
    `</Line>`
  );
}

function transmission(t: DfeTransmission): string {
  return (
    `<Transmission>${el("IssueMode", t.issueMode)}${el("TransmitterTaxId", t.transmitterTaxId, 'CountryCode="CV"')}` +
    `<Software>${el("Code", t.software.code)}${el("Name", t.software.name)}${el("Version", t.software.version)}</Software>` +
    `</Transmission>`
  );
}

/** Builds the unsigned DFE XML in the element order of the XSD, with no insignificant whitespace
 * (manual ch. 8.3). Throws on a structurally impossible input so a bad document is never signed. */
export function buildDfeXml(d: DfeInput): string {
  const needsReceiver = d.kind !== "sales_receipt";
  if (needsReceiver && !d.receiver) throw new Error(`${d.kind} requires a receiver`);
  const hasLines = d.kind !== "receipt";
  if (hasLines && (!d.lines?.length || !d.totals)) throw new Error(`${d.kind} requires lines and totals`);

  const header =
    el("LedCode", d.ledCode) +
    el("Serie", d.serie) +
    el("DocumentNumber", d.documentNumber) +
    (d.innerNumber ? el("InnerDocumentNumber", d.innerNumber) : "") +
    el("IssueDate", d.issueDate) +
    el("IssueTime", d.issueTime);

  const linesTotals = hasLines
    ? `<Lines>${d.lines!.map(line).join("")}</Lines>` +
      `<Totals>${el("PriceExtensionTotalAmount", d.totals!.priceExtension)}` +
      (d.totals!.discount ? el("DiscountTotalAmount", d.totals!.discount) : "") +
      `${el("NetTotalAmount", d.totals!.net)}${el("TaxTotalAmount", d.totals!.tax)}${el("PayableAmount", d.totals!.payable)}</Totals>`
    : "";

  const references = d.references?.length
    ? `<References>${d.references
        .map(
          (r) =>
            `<Reference>${el("FiscalDocument", r.iud, 'IsOldDocument="false"')}` +
            (r.paymentAmount ? el("PaymentAmount", r.paymentAmount) : "") +
            (r.tax ? tax(r.tax) : "") +
            `</Reference>`
        )
        .join("")}</References>`
    : "";

  const payments = d.payments?.length
    ? `<Payments>${d.payments
        .map(
          (p) =>
            `<Payment>${el("PaymentMeansCode", p.meansCode)}${p.reference ? el("PaymentReference", p.reference) : ""}` +
            `${el("PaymentDate", p.date)}${el("PaymentAmount", p.amount)}</Payment>`
        )
        .join("")}</Payments>`
    : "";

  const note = d.note ? el("Note", d.note) : "";
  const emitter = party("EmitterParty", d.emitter);
  const receiver = d.receiver ? party("ReceiverParty", d.receiver) : "";

  // Element order per CV_EFatura_{Invoice,InvoiceReceipt,SalesReceipt,Receipt,CreditNote}_v1.0.xsd
  let body: string;
  switch (d.kind) {
    case "invoice":
    case "invoice_receipt":
      body = header + emitter + receiver + linesTotals + references + payments + note;
      break;
    case "sales_receipt":
      body = header + emitter + receiver + linesTotals + payments + note;
      break;
    case "receipt":
      body = header + emitter + receiver + el("ReceiptTypeCode", d.receiptTypeCode ?? 2) + references + payments + note;
      break;
    case "credit_note":
      body = header + el("IssueReasonCode", d.issueReasonCode ?? "2") + emitter + receiver + linesTotals + references + note;
      break;
  }

  const root = ROOT_ELEMENT[d.kind];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Dfe xmlns="${DFE_NAMESPACE}" Version="1.0" Id="${esc(d.iud)}" DocumentTypeCode="${DOC_TYPE_CODE[d.kind]}">` +
    (d.isSpecimen ? "<IsSpecimen>true</IsSpecimen>" : "") +
    `<${root}>${body}</${root}>` +
    transmission(d.transmission) +
    el("RepositoryCode", d.repositoryCode) +
    `</Dfe>`
  );
}

/** Builds an unsigned Event (FDC — cancel/annul authorized DFEs). */
export function buildEventXml(e: EventInput): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Event xmlns="${DFE_NAMESPACE}" Id="${esc(e.id)}" Version="1.0" EventTypeCode="${e.type}">` +
    el("EmitterTaxId", e.emitterTaxId, 'CountryCode="CV"') +
    el("IssueDateTime", e.issueDateTime) +
    el("IssueReasonDescription", e.reason) +
    e.iuds.map((iud) => el("IUD", iud)).join("") +
    transmission(e.transmission) +
    el("RepositoryCode", e.repositoryCode) +
    `</Event>`
  );
}
