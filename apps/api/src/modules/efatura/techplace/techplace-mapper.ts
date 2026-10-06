import { EFaturaError } from "../efatura.errors";
import { fmtCents } from "../dfe/money";

// Pure: turns a fully-paid CAP invoice into the body of POST /fatura/sincronizador.
// ASSUMPTIONS, each one a question for Techplace (Docs/modules/M6b-efatura-techplace.md, Q5–Q8, Q13):
//  - `preco_unid` is the TAX-INCLUSIVE unit price (CAP prices are). The service checks the total
//    Techplace recorded afterwards, so a wrong guess shows up on the first sale, not in the books.
//  - `desconto_financeiro` is an amount, not a percentage.
//  - `cliente_externo` is the CODIGO_EXT of the customer registered with /cliente/sincronizador;
//    we use the patient's NIF as that code (a customer is its NIF, and a corrected NIF is a new one).
//  - one payment method per sale; with several, the largest payment names it.

export interface TpLine {
  productId: string;
  quantity: number;
  /** Line total in cents (positive: negative lines are summed into `discountCents`). */
  totalCents: number;
}

export interface TpIssueInput {
  kind: "invoice_receipt" | "sales_receipt";
  /** The submission id: Techplace's CODIGO_EXT for the sale. */
  codigoExt: string;
  /** The customer's CODIGO_EXT (the NIF) when a fiscal customer was registered for this sale. */
  customerExt?: string;
  lines: TpLine[];
  discountCents: number;
  totalCents: number;
  methodId: string;
}

export interface TpIssueConfig {
  entityId: string;
  userId: string;
  types: { invoice_receipt: string; sales_receipt: string };
  conditionId: string;
}

const money = (cents: number) => Number(fmtCents(cents));

export function toIssueBody(i: TpIssueInput, c: TpIssueConfig) {
  return {
    entidadeID: c.entityId,
    utilizador: c.userId,
    estadoPagamento: 2, // the sync route records one full payment: only FR/TV go through it
    valorPagamento: money(i.totalCents),
    tipoFatura: c.types[i.kind],
    condicaoPagamento: c.conditionId,
    metodoPagamento: i.methodId,
    ...(i.customerExt ? { cliente_externo: i.customerExt } : {}),
    produtos: i.lines.map((l) => {
      const qty = Math.max(1, l.quantity);
      return { produto_id: l.productId, qttd: qty, preco_unid: Number((l.totalCents / qty / 100).toFixed(5)) };
    }),
    desconto_financeiro: money(i.discountCents),
    CODIGO_EXT: i.codigoExt,
  };
}

/** The Techplace payment-method id of the largest payment; a method nobody mapped stops the sale. */
export function pickMethod(payments: { amountCents: number; method: string }[], map: Record<string, string>): string {
  const biggest = [...payments].sort((a, b) => b.amountCents - a.amountCents)[0];
  if (!biggest) throw new EFaturaError("TECHPLACE_NO_PAYMENT", "A fatura não tem pagamentos para comunicar ao Techplace", false);
  const id = map[biggest.method];
  if (!id) throw new EFaturaError("TECHPLACE_METHOD_UNMAPPED", `Sem método de pagamento do Techplace para "${biggest.method}" (Configurações → e-Fatura)`, false);
  return id;
}
