process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);

import { ConflictException } from "@nestjs/common";
import { strFromU8, unzipSync } from "fflate";
import { EFaturaService } from "./efatura.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { loadSigningKey } from "./dfe/dfe-signer";
import { EFaturaError } from "./efatura.errors";
import { FakeDb, type FakeInvoice } from "./testing/fake-db";
import { makeIdentity } from "./testing/efatura-test-utils";
import type { ReadyConfig } from "./efatura-config.service";

const enc = new EncryptionService();
const id = makeIdentity();
const SIGNING_KEY = loadSigningKey(`${id.keyPem}\n${id.certPem}`, "");

const READY: ReadyConfig = {
  repositoryCode: 2,
  isSpecimen: false,
  goLiveAt: null,
  ledCode: 1,
  serie: "A2026",
  software: { code: "CAP360", name: "CAP 360", version: "1.0.0" },
  transmitterTaxId: "123456789",
  emitter: { taxId: "123456789", name: "Clinica Teste Lda", addressDetail: "Rua 1, Praia", addressCode: "CV774741741037410321", email: "geral@clinica.cv", phone: "2611234" },
  tax: { typeCode: "NA", exemptionReasonCode: 3 },
  creditNoteReasonCode: "2",
  oauth: { clientId: "cap", clientSecret: "s", redirectUri: "https://x/cb" },
  signingKey: SIGNING_KEY,
};

const config = { resolve: jest.fn(), getView: jest.fn() };
const client = { post: jest.fn(), dfeExists: jest.fn() };
const queue = { add: jest.fn() };

let db: FakeDb;
let service: EFaturaService;
let n = 0;

function invoice(over: Partial<FakeInvoice> = {}, opts: { nif?: string | null } = {}): FakeInvoice {
  const i = ++n;
  const hasNif = opts.nif !== null;
  return db.addInvoice({
    id: `inv-${i}`,
    invoiceNumber: `INV-2026-${String(i).padStart(4, "0")}`,
    status: "issued",
    issuedAt: new Date(),
    total: "3000",
    patient: { fullName: "Maria Paciente", nif: hasNif ? enc.encrypt(opts.nif ?? "987654321") : null },
    items: [{ id: `it-${i}`, description: "Consulta", quantity: 1, total: "3000", service: { code: "CONSULTA", name: "Consulta de Psicologia" } }],
    payments: [],
    ...over,
  });
}

const accepted = () => ({ succeeded: true, authorizedAt: new Date("2026-10-03T12:00:00Z"), messages: [] });
const xmlOf = (sub: { signedXml: string }) => enc.decrypt(sub.signedXml);
const root = (xml: string) => xml.match(/<(Invoice|InvoiceReceipt|SalesReceipt|Receipt|CreditNote)>/)?.[1];

beforeEach(() => {
  jest.clearAllMocks();
  db = new FakeDb();
  service = new EFaturaService(db as never, config as never, client as never, enc, queue as never);
  config.resolve.mockResolvedValue({ ok: true, enabled: true, config: READY });
  client.post.mockResolvedValue(accepted());
  client.dfeExists.mockResolvedValue(false);
  queue.add.mockResolvedValue({});
});

describe("EFaturaService.process — issuing the invoice's own document", () => {
  it("reports an unpaid invoice as an FTE: number 1, signed, zipped as <IUD>.xml, accepted", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });

    await service.process(sub.id);

    const row = db.subs.get(sub.id);
    expect(row.status).toBe("accepted");
    expect(row.documentTypeCode).toBe(1);
    expect(row.documentNumber).toBe(1);
    expect(row.iud).toMatch(/^CV2\d{6}123456789\d{27}$/);
    expect(row.acceptedAt).toEqual(new Date("2026-10-03T12:00:00Z"));
    const xml = xmlOf(row);
    expect(root(xml)).toBe("Invoice");
    expect(xml).toContain(`Id="${row.iud}"`);
    expect(xml).toContain("<ds:Signature");
    expect(xml).toContain("<TaxExemptionReasonCode>3</TaxExemptionReasonCode>");
    expect(xml).toContain("<InnerDocumentNumber>INV-2026-0001</InnerDocumentNumber>");
    // sent exactly once, as a one-entry ZIP named after the IUD, to the dfe resource
    expect(client.post).toHaveBeenCalledTimes(1);
    const [resource, zip, repo] = client.post.mock.calls[0];
    expect(resource).toBe("dfe");
    expect(repo).toBe(2);
    expect(Object.keys(unzipSync(new Uint8Array(zip)))).toEqual([`${row.iud}.xml`]);
    expect(strFromU8(unzipSync(new Uint8Array(zip))[`${row.iud}.xml`])).toBe(xml);
  });

  it("freezes the tax treatment on the invoice items (so a credit note can mirror it)", async () => {
    const inv = invoice();
    await service.process(db.addSub({ invoiceId: inv.id }).id);
    expect(inv.items[0]).toMatchObject({ taxTypeCode: "NA", taxExemptionReasonCode: 3, taxPercentage: null });
  });

  it("reports an invoice paid in full the same day as an FRE and makes its receipt rows redundant", async () => {
    const inv = invoice({ payments: [{ id: "pay-1", amount: "3000", method: "cash", paidAt: new Date() }] });
    const primary = db.addSub({ invoiceId: inv.id });
    const receipt = db.addSub({ invoiceId: inv.id, purpose: "receipt", paymentId: "pay-1", referencesId: primary.id });

    await service.process(primary.id);

    expect(db.subs.get(primary.id).documentTypeCode).toBe(2);
    expect(root(xmlOf(db.subs.get(primary.id)))).toBe("InvoiceReceipt");
    expect(xmlOf(db.subs.get(primary.id))).toContain("<PaymentMeansCode>10</PaymentMeansCode>");
    expect(db.subs.get(receipt.id).status).toBe("not_required");
  });

  it("reports a fully paid invoice for a patient without NIF as a TVE (no receiver) below 20 000 CVE", async () => {
    const inv = invoice({ payments: [{ id: "pay-1", amount: "3000", method: "vinti4", paidAt: new Date() }] }, { nif: null });
    const sub = db.addSub({ invoiceId: inv.id });

    await service.process(sub.id);

    const xml = xmlOf(db.subs.get(sub.id));
    expect(db.subs.get(sub.id).documentTypeCode).toBe(3);
    expect(root(xml)).toBe("SalesReceipt");
    expect(xml).not.toContain("<ReceiverParty>");
    expect(xml).toContain("<PaymentMeansCode>48</PaymentMeansCode>");
  });

  it("parks (not an error) an unpaid invoice without NIF: it waits for payment", async () => {
    const inv = invoice({}, { nif: null });
    const sub = db.addSub({ invoiceId: inv.id });

    await service.process(sub.id);

    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "AWAITING_PAYMENT", signedXml: null });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("parks an invoice of 20 000 CVE or more without NIF, asking for the NIF", async () => {
    const inv = invoice({ total: "25000", items: [{ id: "i", description: "Pacote", quantity: 1, total: "25000", service: null }] }, { nif: null });
    const sub = db.addSub({ invoiceId: inv.id });

    await service.process(sub.id);

    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "NEEDS_NIF" });
  });

  it("does not report a zero-value invoice", async () => {
    const inv = invoice({ total: "0", items: [{ id: "i", description: "Grátis", quantity: 1, total: "0" }] });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("not_required");
  });

  it("keeps a separate gap-free sequence per document type", async () => {
    const a = db.addSub({ invoiceId: invoice().id });
    const b = db.addSub({ invoiceId: invoice().id });
    const paid = invoice({ payments: [{ id: "p", amount: "3000", method: "cash", paidAt: new Date() }] });
    const c = db.addSub({ invoiceId: paid.id });

    await service.process(a.id);
    await service.process(b.id);
    await service.process(c.id);

    expect([db.subs.get(a.id).documentNumber, db.subs.get(b.id).documentNumber]).toEqual([1, 2]); // FTE 1, 2
    expect(db.subs.get(c.id).documentNumber).toBe(1); // FRE has its own counter
  });

  it("never sends an invoice that was cancelled before its turn came", async () => {
    const inv = invoice({ status: "cancelled" });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("cancelled");
    expect(client.post).not.toHaveBeenCalled();
  });

  it("does not report invoices issued before the go-live date", async () => {
    config.resolve.mockResolvedValue({ ok: true, enabled: true, config: { ...READY, goLiveAt: new Date(Date.now() + 3_600_000) } });
    const sub = db.addSub({ invoiceId: invoice({ issuedAt: new Date() }).id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("not_required");
    expect(client.post).not.toHaveBeenCalled();
  });

  it("refuses to sign when the computed total disagrees with the invoice total", async () => {
    const inv = invoice({ total: "3500" }); // items add up to 3000
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id); // non-retryable: recorded, not thrown
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TOTAL_MISMATCH" });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("uses a negative (health-plan) item as a deduction line and still totals correctly", async () => {
    const inv = invoice({
      total: "2100",
      items: [
        { id: "a", description: "Consulta", quantity: 1, total: "3000", service: { code: "CONSULTA", name: "Consulta" } },
        { id: "b", description: "Desconto Plano de Saúde (30%)", quantity: 1, total: "-900", service: null },
      ],
    });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    const xml = xmlOf(db.subs.get(sub.id));
    expect(xml).toContain('<Line LineTypeCode="D">');
    expect(xml).toContain("<DiscountTotalAmount>900</DiscountTotalAmount>");
    expect(xml).toContain("<PayableAmount>2100</PayableAmount>");
  });
});

describe("EFaturaService.process — outcomes", () => {
  it("records a platform rejection with its message code, without retrying", async () => {
    client.post.mockResolvedValue({ succeeded: false, messages: [{ code: "RP-TID-EX", type: "ERROR", description: "NIF do recetor não existe" }] });
    const sub = db.addSub({ invoiceId: invoice().id });

    await expect(service.process(sub.id)).resolves.toBeUndefined();

    expect(db.subs.get(sub.id)).toMatchObject({ status: "rejected", errorCode: "RP-TID-EX" });
    expect(db.subs.get(sub.id).errorMessage).toContain("NIF do recetor não existe");
  });

  it("marks a transient failure as error and rethrows so the queue retries it", async () => {
    client.post.mockRejectedValue(new EFaturaError("PE_TIMEOUT", "A plataforma não respondeu a tempo", true));
    const sub = db.addSub({ invoiceId: invoice().id });

    await expect(service.process(sub.id)).rejects.toThrow("não respondeu");

    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "PE_TIMEOUT" });
    // the prepared document survives, so the retry re-sends exactly what was signed
    expect(db.subs.get(sub.id).signedXml).not.toBeNull();
  });

  it("records a non-retryable failure (e.g. credentials) without rethrowing", async () => {
    client.post.mockRejectedValue(new EFaturaError("PE_FORBIDDEN", "Sem permissão", false));
    const sub = db.addSub({ invoiceId: invoice().id });
    await expect(service.process(sub.id)).resolves.toBeUndefined();
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "PE_FORBIDDEN" });
  });

  it("an unexpected crash is recorded generically (no raw message leaked) and rethrown", async () => {
    client.post.mockRejectedValue(new Error("connect ECONNRESET 10.0.0.1 secret-token"));
    const sub = db.addSub({ invoiceId: invoice().id });
    await expect(service.process(sub.id)).rejects.toThrow("ECONNRESET");
    expect(db.subs.get(sub.id).errorCode).toBe("INTERNAL");
    expect(db.subs.get(sub.id).errorMessage).not.toContain("secret-token");
  });

  it("asks the platform before re-sending a document whose earlier attempt may have got through", async () => {
    const sub = db.addSub({ invoiceId: invoice().id });
    client.post.mockRejectedValueOnce(new EFaturaError("PE_TIMEOUT", "timeout", true));
    await expect(service.process(sub.id)).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1);

    client.dfeExists.mockResolvedValue(true); // the first POST had actually been authorized
    await service.process(sub.id);

    expect(client.dfeExists).toHaveBeenCalledWith(db.subs.get(sub.id).iud, 2);
    expect(client.post).toHaveBeenCalledTimes(1); // no duplicate POST
    expect(db.subs.get(sub.id).status).toBe("accepted");
  });

  it("re-sends the identical signed document when the platform has not seen it", async () => {
    const sub = db.addSub({ invoiceId: invoice().id });
    client.post.mockRejectedValueOnce(new EFaturaError("PE_TIMEOUT", "timeout", true));
    await expect(service.process(sub.id)).rejects.toThrow();
    const firstXml = xmlOf(db.subs.get(sub.id));

    await service.process(sub.id);

    expect(db.subs.get(sub.id).status).toBe("accepted");
    expect(xmlOf(db.subs.get(sub.id))).toBe(firstXml);
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a submission that is already done or in flight", async () => {
    const done = db.addSub({ invoiceId: invoice().id, status: "accepted" });
    const busy = db.addSub({ invoiceId: invoice().id, status: "submitting" });
    await service.process(done.id);
    await service.process(busy.id);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("parks the row when the integration is switched off", async () => {
    config.resolve.mockResolvedValue({ ok: false, enabled: false, missing: [] });
    const sub = db.addSub({ invoiceId: invoice().id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "DISABLED" });
  });

  it("records an incomplete configuration as a non-retryable error naming what is missing", async () => {
    config.resolve.mockResolvedValue({ ok: false, enabled: true, missing: ["Código do LED", "Série"] });
    const sub = db.addSub({ invoiceId: invoice().id });
    await expect(service.process(sub.id)).resolves.toBeUndefined();
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "NOT_CONFIGURED" });
    expect(db.subs.get(sub.id).errorMessage).toContain("Código do LED");
  });

  it("rebuilds a prepared-but-never-sent document that has gone stale, keeping its number", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id); // accepted → pretend it never left
    const row = db.subs.get(sub.id);
    Object.assign(row, { status: "pending", submittedAt: null, issuedAt: new Date(Date.now() - 21 * 3_600_000) });
    const oldIud = row.iud;
    client.post.mockClear();

    await service.process(sub.id);

    expect(db.subs.get(sub.id).iud).not.toBe(oldIud);
    expect(db.subs.get(sub.id).documentNumber).toBe(1); // same number, no gap
    expect([...db.counters.values()]).toEqual([1]); // one number consumed in total — no gap
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("refuses to re-send a document older than the online window that may already exist", async () => {
    const sub = db.addSub({ invoiceId: invoice().id });
    client.post.mockRejectedValueOnce(new EFaturaError("PE_TIMEOUT", "timeout", true));
    await expect(service.process(sub.id)).rejects.toThrow();
    db.subs.get(sub.id).issuedAt = new Date(Date.now() - 25 * 3_600_000);
    client.post.mockClear();

    await service.process(sub.id);

    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "EXPIRED_ONLINE_WINDOW" });
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe("EFaturaService.process — receipts (RCE)", () => {
  function setup(primary: Record<string, unknown> = {}) {
    const inv = invoice({ payments: [{ id: "pay-1", amount: "1000", method: "bank_transfer", reference: "REF 1", paidAt: new Date() }] });
    const p = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 1, iud: `CV2261003123456789000010100000000100000000014`, ...primary });
    const r = db.addSub({ invoiceId: inv.id, purpose: "receipt", paymentId: "pay-1", referencesId: p.id });
    inv.items[0].taxTypeCode = "NA";
    inv.items[0].taxExemptionReasonCode = 3;
    return { inv, p, r };
  }

  it("sends a Recibo referencing the authorized FTE and the payment", async () => {
    const { p, r } = setup();
    await service.process(r.id);
    const row = db.subs.get(r.id);
    const xml = xmlOf(row);
    expect(row).toMatchObject({ status: "accepted", documentTypeCode: 4, documentNumber: 1 });
    expect(root(xml)).toBe("Receipt");
    expect(xml).toContain(`<FiscalDocument IsOldDocument="false">${p.iud}</FiscalDocument>`);
    expect(xml).toContain("<PaymentAmount>1000</PaymentAmount>");
    expect(xml).toContain("<PaymentReference>REF1</PaymentReference>");
    expect(xml).toContain("<ReceiptTypeCode>2</ReceiptTypeCode>");
  });

  it("waits (parked, not an error) until the FTE is authorized", async () => {
    const { r } = setup({ status: "pending", iud: null });
    await service.process(r.id);
    expect(db.subs.get(r.id)).toMatchObject({ status: "pending", errorCode: "AWAITING_PRIMARY" });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("is not needed when the invoice was reported as an FRE", async () => {
    const { r } = setup({ documentTypeCode: 2 });
    await service.process(r.id);
    expect(db.subs.get(r.id).status).toBe("not_required");
  });

  it("is cancelled together with a cancelled primary", async () => {
    const { r } = setup({ status: "cancelled" });
    await service.process(r.id);
    expect(db.subs.get(r.id).status).toBe("cancelled");
  });

  it("releases waiting receipts once the primary document is authorized", async () => {
    const inv = invoice({ payments: [{ id: "pay-1", amount: "1000", method: "cash", paidAt: new Date(Date.now() - 2 * 86_400_000) }] });
    const p = db.addSub({ invoiceId: inv.id });
    const r = db.addSub({ invoiceId: inv.id, purpose: "receipt", paymentId: "pay-1", referencesId: p.id });

    await service.process(p.id);

    expect(db.subs.get(p.id).documentTypeCode).toBe(1); // paid on another day → FTE
    expect(queue.add).toHaveBeenCalledWith("submit", { submissionId: r.id }, expect.objectContaining({ jobId: `submit-${r.id}` }));
  });
});

describe("EFaturaService.planVoid", () => {
  const tx = () => db as never;

  it("cancels locally a document that was never authorized — it will never be sent", async () => {
    const inv = invoice();
    const p = db.addSub({ invoiceId: inv.id, status: "pending" });
    const r = db.addSub({ invoiceId: inv.id, purpose: "receipt", status: "pending", referencesId: p.id });

    const ids = await service.planVoid(tx(), inv.id, "Engano", false);

    expect(ids).toEqual([]);
    expect(db.subs.get(p.id).status).toBe("cancelled");
    expect(db.subs.get(r.id).status).toBe("cancelled");
  });

  it("voids an authorized, unpaid invoice with an FDC event", async () => {
    const inv = invoice();
    const p = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 1, iud: "CV2261003123456789000010100000000100000000014" });

    const ids = await service.planVoid(tx(), inv.id, "Engano", false);

    expect(ids).toHaveLength(1);
    expect(db.subs.get(ids[0])).toMatchObject({ purpose: "cancel", referencesId: p.id, reason: "Engano", status: "pending" });
    expect(db.subs.get(p.id).status).toBe("accepted"); // the original keeps its authorization history
  });

  it("reverses an authorized FTE that already has payments with a credit note", async () => {
    const inv = invoice();
    db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 1, iud: "CV2261003123456789000010100000000100000000014" });
    const ids = await service.planVoid(tx(), inv.id, "Serviço não prestado", true);
    expect(db.subs.get(ids[0]).purpose).toBe("credit_note");
  });

  it("also tells DNRE about a failed send whose answer may have been lost (error + already submitted)", async () => {
    const inv = invoice();
    db.addSub({ invoiceId: inv.id, status: "error", submittedAt: new Date(), iud: "CV2261003123456789000010100000000100000000014" });
    const ids = await service.planVoid(tx(), inv.id, "Engano", false);
    expect(db.subs.get(ids[0]).purpose).toBe("cancel");
  });

  it("refuses to cancel while the document is being sent right now (409)", async () => {
    const inv = invoice();
    db.addSub({ invoiceId: inv.id, status: "submitting" });
    await expect(service.planVoid(tx(), inv.id, "Engano", false)).rejects.toThrow(ConflictException);
  });

  it("does nothing for an invoice that was never reported", async () => {
    expect(await service.planVoid(tx(), invoice().id, "Engano", false)).toEqual([]);
  });

  it("an FDC event is signed, validated by shape and posted to the event resource", async () => {
    const inv = invoice();
    const p = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 1, iud: "CV2261003123456789000010100000000100000000014" });
    const [voidId] = await service.planVoid(tx(), inv.id, "Fatura emitida por engano", false);

    await service.process(voidId);

    const row = db.subs.get(voidId);
    expect(client.post.mock.calls[0][0]).toBe("event");
    expect(row.status).toBe("accepted");
    expect(row.iud).toMatch(/^CV2\d{12}123456789$/); // event id: 24 chars
    const xml = xmlOf(row);
    expect(xml).toContain('EventTypeCode="FDC"');
    expect(xml).toContain(`<IUD>${p.iud}</IUD>`);
    expect(xml).toContain("Anulação da fatura");
  });

  it("a credit note mirrors the original lines and references the original IUD", async () => {
    const inv = invoice({ payments: [{ id: "pay-1", amount: "1000", method: "cash", paidAt: new Date(Date.now() - 2 * 86_400_000) }] });
    inv.items[0].taxTypeCode = "NA";
    inv.items[0].taxExemptionReasonCode = 3;
    const p = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 1, iud: "CV2261003123456789000010100000000100000000014" });
    const [creditId] = await service.planVoid(tx(), inv.id, "Serviço não prestado", true);

    await service.process(creditId);

    const row = db.subs.get(creditId);
    const xml = xmlOf(row);
    expect(row).toMatchObject({ status: "accepted", documentTypeCode: 5 });
    expect(root(xml)).toBe("CreditNote");
    expect(xml).toContain("<IssueReasonCode>2</IssueReasonCode>");
    expect(xml).toContain(`<FiscalDocument IsOldDocument="false">${p.iud}</FiscalDocument>`);
    expect(xml).toContain("<PayableAmount>3000</PayableAmount>");
  });
});

describe("EFaturaService.retry / enqueue / sweep", () => {
  it("re-prepares a rejected document (data may have been fixed) but keeps its number", async () => {
    client.post.mockResolvedValueOnce({ succeeded: false, messages: [{ code: "X", type: "ERROR", description: "recusado" }] });
    const sub = db.addSub({ invoiceId: invoice().id });
    await service.process(sub.id);
    const number = db.subs.get(sub.id).documentNumber;

    expect(await service.retry(db.subs.get(sub.id).invoiceId)).toBe(1);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", signedXml: null, iud: null, errorCode: null });
    await service.process(sub.id);

    expect(db.subs.get(sub.id)).toMatchObject({ status: "accepted", documentNumber: number });
  });

  it("only touches documents that failed or are waiting — never an accepted one", async () => {
    const inv = invoice();
    const ok = db.addSub({ invoiceId: inv.id, status: "accepted" });
    expect(await service.retry(inv.id)).toBe(0);
    expect(db.subs.get(ok.id).status).toBe("accepted");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("enqueue dedupes per submission (jobId) and removes finished jobs so a later retry can queue again", async () => {
    await service.enqueue("sub-9");
    expect(queue.add).toHaveBeenCalledWith(
      "submit",
      { submissionId: "sub-9" },
      expect.objectContaining({ jobId: "submit-sub-9", attempts: 3, removeOnComplete: true, removeOnFail: true })
    );
  });

  it("a failed enqueue (e.g. Redis down) is not fatal — the sweeper will pick the row up", async () => {
    queue.add.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.enqueue("sub-9")).resolves.toBeUndefined();
  });

  describe("sweep", () => {
    const old = (ms: number) => new Date(Date.now() - ms);
    const make = (data: Record<string, unknown>) => db.addSub({ invoiceId: invoice().id, ...data });

    it("re-queues lost pending jobs, stuck 'submitting' ones and errors whose back-off elapsed", async () => {
      const lost = make({ status: "pending", updatedAt: old(2 * 60_000) });
      const stuck = make({ status: "submitting", updatedAt: old(11 * 60_000) });
      const failed = make({ status: "error", retryCount: 1, updatedAt: old(3 * 60_000) });

      expect(await service.sweep()).toBe(3);

      expect(db.subs.get(stuck.id).status).toBe("pending");
      for (const s of [lost, stuck, failed]) {
        expect(queue.add).toHaveBeenCalledWith("submit", { submissionId: s.id }, expect.anything());
      }
    });

    it("leaves recent work alone and respects the exponential back-off", async () => {
      make({ status: "pending", updatedAt: old(10_000) });
      make({ status: "submitting", updatedAt: old(60_000) });
      make({ status: "error", retryCount: 4, updatedAt: old(8 * 60_000) }); // needs 16 min
      expect(await service.sweep()).toBe(0);
    });

    it("re-checks a parked document only every 15 minutes", async () => {
      make({ status: "pending", errorCode: "AWAITING_PAYMENT", updatedAt: old(5 * 60_000) });
      const due = make({ status: "pending", errorCode: "NEEDS_NIF", updatedAt: old(16 * 60_000) });
      expect(await service.sweep()).toBe(1);
      expect(queue.add).toHaveBeenCalledWith("submit", { submissionId: due.id }, expect.anything());
    });

    it("does nothing while the integration is off or incomplete", async () => {
      make({ status: "pending", updatedAt: old(2 * 60_000) });
      config.resolve.mockResolvedValue({ ok: false, enabled: true, missing: ["x"] });
      expect(await service.sweep()).toBe(0);
      config.resolve.mockResolvedValue({ ok: false, enabled: false, missing: [] });
      expect(await service.sweep()).toBe(0);
    });

    it("skips documents of invoices issued before the go-live date", async () => {
      const goLive = new Date();
      config.resolve.mockResolvedValue({ ok: true, enabled: true, config: { ...READY, goLiveAt: goLive } });
      const before = db.addInvoice({ ...invoice(), id: "inv-old", issuedAt: new Date(goLive.getTime() - 86_400_000) });
      db.addSub({ invoiceId: before.id, status: "pending", updatedAt: old(2 * 60_000) });
      expect(await service.sweep()).toBe(0);
    });
  });
});
