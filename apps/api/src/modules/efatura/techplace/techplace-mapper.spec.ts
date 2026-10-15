import { pickMethod, toIssueBody } from "./techplace-mapper";
import { EFaturaError } from "../efatura.errors";

const CFG = { entityId: "ent-1", userId: "usr-1", types: { invoice_receipt: "FR", sales_receipt: "TV" }, conditionId: "cond-1" };

describe("toIssueBody", () => {
  it("maps a paid Fatura-Recibo to the sync body, linking the customer by NIF", () => {
    const body = toIssueBody(
      { kind: "invoice_receipt", codigoExt: "sub-1", customerExt: "987654321", lines: [{ productId: "p1", quantity: 1, totalCents: 300_000 }], discountCents: 0, totalCents: 300_000, methodId: "m-cash" },
      CFG
    );
    expect(body).toEqual({
      entidadeID: "ent-1",
      utilizador: "usr-1",
      estadoPagamento: 2,
      valorPagamento: 3000,
      tipoFatura: "FR",
      condicaoPagamento: "cond-1",
      metodoPagamento: "m-cash",
      cliente_externo: "987654321",
      produtos: [{ produto_id: "p1", qttd: 1, preco_unid: 3000 }],
      desconto_financeiro: 0,
      CODIGO_EXT: "sub-1",
    });
  });

  it("leaves the customer out of a Talão de Venda", () => {
    const body = toIssueBody(
      { kind: "sales_receipt", codigoExt: "sub-2", lines: [{ productId: "p1", quantity: 1, totalCents: 150_050 }], discountCents: 0, totalCents: 150_050, methodId: "m-card" },
      CFG
    );
    expect(body.tipoFatura).toBe("TV");
    expect(body).not.toHaveProperty("cliente_externo");
    expect(body.valorPagamento).toBe(1500.5);
  });

  it("sends the unit price of a multi-unit line, and the health-plan discount as desconto_financeiro", () => {
    const body = toIssueBody(
      { kind: "invoice_receipt", codigoExt: "sub-3", customerExt: "987654321", lines: [{ productId: "p1", quantity: 3, totalCents: 10_000 }], discountCents: 2_500, totalCents: 7_500, methodId: "m" },
      CFG
    );
    expect(body.produtos).toEqual([{ produto_id: "p1", qttd: 3, preco_unid: 33.33333 }]);
    expect(body.desconto_financeiro).toBe(25);
    expect(body.valorPagamento).toBe(75);
  });
});

describe("pickMethod", () => {
  const map = { cash: "m-cash", vinti4: "m-card" };

  it("names the sale after the largest payment", () => {
    expect(pickMethod([{ amountCents: 1_000, method: "cash" }, { amountCents: 2_000, method: "vinti4" }], map)).toBe("m-card");
  });

  it("stops (not retryable) on a method nobody mapped, naming it", () => {
    try {
      pickMethod([{ amountCents: 1_000, method: "health_plan" }], map);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EFaturaError);
      expect((e as EFaturaError).code).toBe("TECHPLACE_METHOD_UNMAPPED");
      expect((e as EFaturaError).retryable).toBe(false);
      expect((e as EFaturaError).message).toContain("health_plan");
    }
  });

  it("stops when there is no payment to name a method", () => {
    expect(() => pickMethod([], map)).toThrow(EFaturaError);
  });
});
