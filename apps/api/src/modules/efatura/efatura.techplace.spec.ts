process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);

import { EFaturaService } from "./efatura.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { EFaturaError } from "./efatura.errors";
import { TECHPLACE_UNCERTAIN } from "./techplace/techplace-client.service";
import { FakeDb, type FakeInvoice, type FakeItem } from "./testing/fake-db";
import type { TechplaceConfig } from "./efatura-config.service";

const enc = new EncryptionService();

const TP: TechplaceConfig = {
  goLiveAt: null,
  entityId: "ent-1",
  userId: "usr-1",
  credentials: { apiKey: "k" },
  types: { invoice_receipt: "FR", sales_receipt: "TV" },
  conditionId: "cond-1",
  methods: { cash: "m-cash", vinti4: "m-card" },
  ivaId: "iva-1",
  unitId: "un-1",
  fallbackProductId: null,
};

const config = { resolveTechplace: jest.fn(), getView: jest.fn() };
const techplace = { issue: jest.fn(), registerProduct: jest.fn(), syncCustomer: jest.fn(), saleTotal: jest.fn() };
const queue = { add: jest.fn() };

let db: FakeDb;
let service: EFaturaService;
let n = 0;
const previousProvider = process.env.EFATURA_PROVIDER;
beforeAll(() => void (process.env.EFATURA_PROVIDER = "techplace"));
afterAll(() => void (previousProvider === undefined ? delete process.env.EFATURA_PROVIDER : (process.env.EFATURA_PROVIDER = previousProvider)));

const svc = (over: Partial<NonNullable<FakeItem["service"]>> = {}) => ({ id: "svc-1", code: "CONSULTA", name: "Consulta de Psicologia", price: "3000", techplaceProductId: null, ...over });

function invoice(over: Partial<FakeInvoice> = {}, opts: { nif?: string | null } = {}): FakeInvoice {
  const i = ++n;
  return db.addInvoice({
    id: `inv-${i}`,
    invoiceNumber: `INV-2026-${String(i).padStart(4, "0")}`,
    status: "issued",
    issuedAt: new Date(),
    total: "3000",
    patientId: `pat-${i}`,
    patient: { fullName: "Maria Paciente", nif: opts.nif === null ? null : enc.encrypt(opts.nif ?? "987654321") },
    items: [{ id: `it-${i}`, description: "Consulta", quantity: 1, total: "3000", service: svc() }],
    payments: [{ id: `pay-${i}`, amount: "3000", method: "cash", paidAt: new Date() }],
    ...over,
  });
}

const accepted = { ok: true, data: { faturaId: "f-1", vendaCode: "FRAA-1" } };

beforeEach(() => {
  jest.clearAllMocks();
  db = new FakeDb();
  service = new EFaturaService(db as never, config as never, {} as never, enc, queue as never, techplace as never);
  config.resolveTechplace.mockResolvedValue({ ok: true, enabled: true, config: TP });
  techplace.syncCustomer.mockResolvedValue({ ok: true, data: {} });
  techplace.registerProduct.mockResolvedValue({ ok: true, data: { produtoID: "prod-1" } });
  techplace.issue.mockResolvedValue(accepted);
  techplace.saleTotal.mockResolvedValue(3000);
  queue.add.mockResolvedValue({});
});

describe("EFaturaService.process on the Techplace transport — issuing", () => {
  it("reports a paid invoice with NIF as a Fatura-Recibo: customer, product, sale, number kept, accepted", async () => {
    const inv = invoice();
    const receipt = db.addSub({ invoiceId: inv.id, purpose: "receipt", paymentId: `pay-${n}` });
    const sub = db.addSub({ invoiceId: inv.id });

    await service.process(sub.id);

    expect(techplace.syncCustomer).toHaveBeenCalledWith(TP.credentials, expect.objectContaining({ NIF: "987654321", DESIG: "Maria Paciente", CODIGO_EXT: "987654321" }));
    expect(techplace.registerProduct).toHaveBeenCalledWith(TP.credentials, expect.objectContaining({ CODIGO_EXT: "CONSULTA", DESIG: "Consulta de Psicologia", produto_servico: "S", iva_ID: "iva-1", unidade_ID: "un-1" }));
    expect(techplace.issue).toHaveBeenCalledTimes(1);
    expect(techplace.issue.mock.calls[0][1]).toMatchObject({
      tipoFatura: "FR", estadoPagamento: 2, valorPagamento: 3000, metodoPagamento: "m-cash", cliente_externo: "987654321", CODIGO_EXT: sub.id,
      produtos: [{ produto_id: "prod-1", qttd: 1, preco_unid: 3000 }],
    });
    const row = db.subs.get(sub.id);
    expect(row).toMatchObject({ status: "accepted", documentTypeCode: 2, externalId: "f-1", externalCode: "FRAA-1", errorCode: null });
    expect(row.acceptedAt).toBeInstanceOf(Date);
    expect(db.subs.get(receipt.id).status).toBe("not_required"); // the sale already covers the payment
    expect(inv.items[0].service?.techplaceProductId).toBe("prod-1");
  });

  it("reports a paid invoice without NIF as a Talão de Venda, with no customer", async () => {
    const inv = invoice({}, { nif: null });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(techplace.syncCustomer).not.toHaveBeenCalled();
    const body = techplace.issue.mock.calls[0][1];
    expect(body.tipoFatura).toBe("TV");
    expect(body).not.toHaveProperty("cliente_externo");
    expect(db.subs.get(sub.id).documentTypeCode).toBe(3);
  });

  it("registers each service once, even when two lines share it, and reuses a stored product id", async () => {
    const shared = svc();
    const inv = invoice({
      total: "5000",
      items: [
        { id: "a", description: "Consulta", quantity: 1, total: "3000", service: shared },
        { id: "b", description: "Consulta", quantity: 1, total: "2000", service: shared },
      ],
      payments: [{ id: "p", amount: "5000", method: "cash", paidAt: new Date() }],
    });
    techplace.saleTotal.mockResolvedValueOnce(5000);
    await service.process(db.addSub({ invoiceId: inv.id }).id);
    expect(techplace.registerProduct).toHaveBeenCalledTimes(1);
    expect(techplace.issue.mock.calls[0][1].produtos.map((p: { produto_id: string }) => p.produto_id)).toEqual(["prod-1", "prod-1"]);

    const again = invoice({ items: [{ id: "c", description: "Consulta", quantity: 1, total: "3000", service: svc({ techplaceProductId: "prod-9" }) }] });
    techplace.registerProduct.mockClear();
    await service.process(db.addSub({ invoiceId: again.id }).id);
    expect(techplace.registerProduct).not.toHaveBeenCalled();
    expect(techplace.issue.mock.calls[1][1].produtos[0].produto_id).toBe("prod-9");
  });

  it("sends a health-plan discount line as desconto_financeiro", async () => {
    const inv = invoice({
      total: "2500",
      items: [
        { id: "a", description: "Consulta", quantity: 1, total: "3000", service: svc() },
        { id: "b", description: "Desconto plano", quantity: 1, total: "-500", service: null },
      ],
      payments: [{ id: "p", amount: "2500", method: "vinti4", paidAt: new Date() }],
    });
    techplace.saleTotal.mockResolvedValue(2500);
    await service.process(db.addSub({ invoiceId: inv.id }).id);
    expect(techplace.issue.mock.calls[0][1]).toMatchObject({ desconto_financeiro: 500, valorPagamento: 2500, metodoPagamento: "m-card" });
  });

  it("uses the generic product for a line without a service, and stops with a clear message when none is set", async () => {
    const inv = invoice({ items: [{ id: "a", description: "Avulso", quantity: 1, total: "3000", service: null }] });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TECHPLACE_NO_PRODUCT" });
    expect(techplace.issue).not.toHaveBeenCalled();

    config.resolveTechplace.mockResolvedValue({ ok: true, enabled: true, config: { ...TP, fallbackProductId: "prod-generic" } });
    await service.retry(inv.id);
    await service.process(sub.id);
    expect(techplace.issue.mock.calls[0][1].produtos[0].produto_id).toBe("prod-generic");
  });

  it("stops (not retryable) when the payment method has no Techplace id", async () => {
    const inv = invoice({ payments: [{ id: "p", amount: "3000", method: "health_plan", paidAt: new Date() }] });
    const sub = db.addSub({ invoiceId: inv.id });
    await expect(service.process(sub.id)).resolves.toBeUndefined();
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TECHPLACE_METHOD_UNMAPPED" });
    expect(techplace.issue).not.toHaveBeenCalled();
  });

  it("never sends a cancelled invoice", async () => {
    const inv = invoice({ status: "cancelled" });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("cancelled");
    expect(techplace.issue).not.toHaveBeenCalled();
  });

  it("does nothing while disabled, and explains what is missing when misconfigured", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    config.resolveTechplace.mockResolvedValue({ ok: false, enabled: false, missing: ["x"] });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "DISABLED" });

    config.resolveTechplace.mockResolvedValue({ ok: false, enabled: true, missing: ["ID da entidade no Techplace"] });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "NOT_CONFIGURED" });
    expect(db.subs.get(sub.id).errorMessage).toContain("ID da entidade");
    expect(techplace.issue).not.toHaveBeenCalled();
  });
});

describe("Techplace transport — what it cannot do yet is parked, never silently dropped", () => {
  it("parks an unpaid invoice with NIF (a Fatura) as TECHPLACE_UNSUPPORTED", async () => {
    const inv = invoice({ payments: [] });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "TECHPLACE_UNSUPPORTED" });
    expect(techplace.issue).not.toHaveBeenCalled();
    expect(techplace.registerProduct).not.toHaveBeenCalled();
  });

  it("keeps the existing waiting rules: no NIF and unpaid waits for payment", async () => {
    const inv = invoice({ payments: [] }, { nif: null });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "pending", errorCode: "AWAITING_PAYMENT" });
  });

  it("parks credit notes and void events", async () => {
    const inv = invoice();
    const primary = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 2, externalId: "f-1", externalCode: "FRAA-1" });
    for (const purpose of ["credit_note", "cancel"] as const) {
      const s = db.addSub({ invoiceId: inv.id, purpose, referencesId: primary.id });
      await service.process(s.id);
      expect(db.subs.get(s.id)).toMatchObject({ status: "pending", errorCode: "TECHPLACE_UNSUPPORTED" });
    }
    expect(techplace.issue).not.toHaveBeenCalled();
  });

  it("settles a receipt covered by a Fatura-Recibo, and parks one that is not", async () => {
    const inv = invoice();
    const fr = db.addSub({ invoiceId: inv.id, status: "accepted", documentTypeCode: 2 });
    const covered = db.addSub({ invoiceId: inv.id, purpose: "receipt", paymentId: `pay-${n}`, referencesId: fr.id });
    await service.process(covered.id);
    expect(db.subs.get(covered.id).status).toBe("not_required");

    const inv2 = invoice();
    const ft = db.addSub({ invoiceId: inv2.id, status: "pending" });
    const open = db.addSub({ invoiceId: inv2.id, purpose: "receipt", paymentId: `pay-${n}`, referencesId: ft.id });
    await service.process(open.id);
    expect(db.subs.get(open.id)).toMatchObject({ status: "pending", errorCode: "TECHPLACE_UNSUPPORTED" });
  });
});

describe("Techplace transport — refusals, lost answers and wrong totals", () => {
  it("records a refusal as rejected with Techplace's code and message, and a retry sends again", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    techplace.issue.mockResolvedValueOnce({ ok: false, code: "INSUFFICIENT_STOCK", message: "Estoque insuficiente" });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "rejected", errorCode: "INSUFFICIENT_STOCK", errorMessage: "Estoque insuficiente", externalId: null });

    await service.retry(inv.id);
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("accepted");
    expect(techplace.issue).toHaveBeenCalledTimes(2);
  });

  it("after an answer that never came, waits for a human: no sweep, no stray job, only 'Retentar' resends", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    techplace.issue.mockRejectedValueOnce(new EFaturaError(TECHPLACE_UNCERTAIN, "O Techplace não respondeu", false));

    await expect(service.process(sub.id)).resolves.toBeUndefined(); // not rethrown: Bull must not retry it
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: TECHPLACE_UNCERTAIN });

    db.subs.get(sub.id).updatedAt = new Date(Date.now() - 3 * 3_600_000);
    expect(await service.sweep()).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();

    await service.process(sub.id); // a stray job
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: TECHPLACE_UNCERTAIN });
    expect(techplace.issue).toHaveBeenCalledTimes(1);

    expect(await service.retry(inv.id)).toBe(1);
    await service.process(sub.id);
    expect(techplace.issue).toHaveBeenCalledTimes(2);
    expect(db.subs.get(sub.id).status).toBe("accepted");
  });

  it("a total Techplace recorded differently stops the sale for a human — and never POSTs it again", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    techplace.saleTotal.mockResolvedValueOnce(3450);

    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TECHPLACE_TOTAL_MISMATCH", externalId: "f-1", externalCode: "FRAA-1" });
    expect(db.subs.get(sub.id).errorMessage).toContain("3450");

    db.subs.get(sub.id).updatedAt = new Date(Date.now() - 3 * 3_600_000);
    expect(await service.sweep()).toBe(0);

    techplace.saleTotal.mockResolvedValueOnce(3000); // the admin fixed the sale in Techplace
    await service.retry(inv.id);
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "accepted", errorCode: null });
    expect(techplace.issue).toHaveBeenCalledTimes(1);
  });

  it("accepts the sale when Techplace's answer about the total cannot be read", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    techplace.saleTotal.mockResolvedValueOnce(null);
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("accepted");
  });

  it("rethrows a retryable network failure so the queue retries, and the retry finishes the job", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id });
    techplace.registerProduct.mockRejectedValueOnce(new EFaturaError("TP_NETWORK", "Sem ligação ao Techplace", true));
    await expect(service.process(sub.id)).rejects.toThrow("Sem ligação");
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TP_NETWORK" });
    await service.process(sub.id);
    expect(db.subs.get(sub.id).status).toBe("accepted");
  });

  it("refuses a sum of lines that is not the invoice total", async () => {
    const inv = invoice({ total: "3500" });
    const sub = db.addSub({ invoiceId: inv.id });
    await service.process(sub.id);
    expect(db.subs.get(sub.id)).toMatchObject({ status: "error", errorCode: "TOTAL_MISMATCH" });
    expect(techplace.issue).not.toHaveBeenCalled();
  });
});

describe("EFaturaService.planVoid with a sale that may exist in Techplace", () => {
  it("does not forget a sale whose answer was lost: it asks for a human instead of cancelling locally", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id, status: "error", errorCode: TECHPLACE_UNCERTAIN, submittedAt: new Date() });
    const ids = await service.planVoid(db as never, inv.id, "engano", false);
    expect(ids).toHaveLength(1);
    expect(db.subs.get(sub.id).status).toBe("error");
    expect(db.subs.get(ids[0])).toMatchObject({ purpose: "cancel", referencesId: sub.id });
  });

  it("a sale that was refused never reached Techplace and is cancelled locally", async () => {
    const inv = invoice();
    const sub = db.addSub({ invoiceId: inv.id, status: "rejected", submittedAt: new Date() });
    expect(await service.planVoid(db as never, inv.id, "engano", false)).toEqual([]);
    expect(db.subs.get(sub.id).status).toBe("cancelled");
  });
});
