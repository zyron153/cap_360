import { buildLines, chooseDocument, itemCode, toDfePayment, PAYMENT_MEANS, TVE_RECEIVER_THRESHOLD_CENTS } from "./invoice-mapper";

const NA = { typeCode: "NA" as const, exemptionReasonCode: 3 };
const IVA15 = { typeCode: "IVA" as const, percentage: 15 };

describe("buildLines — exempt (NA)", () => {
  it("passes amounts through untouched; payable equals the invoice total", () => {
    const r = buildLines([{ description: "Consulta", quantity: 2, totalCents: 600_000, serviceCode: "CONS 1", serviceName: "Consulta de Psicologia" }], NA);

    expect(r.payableCents).toBe(600_000);
    expect(r.totals).toEqual({ priceExtension: "6000", discount: undefined, net: "6000", tax: "0", payable: "6000" });
    expect(r.lines[0]).toMatchObject({
      id: 1, type: "N", quantity: "2", unitCode: "EA", price: "3000", priceExtension: "6000", netTotal: "6000",
      code: "CONS1", description: "Consulta de Psicologia", tax: { typeCode: "NA", exemptionReasonCode: 3 },
    });
  });

  it("derives the unit price from the line total (no float drift) to 5 decimals", () => {
    const r = buildLines([{ description: "x", quantity: 3, totalCents: 1000 }], NA); // 10.00 / 3
    expect(r.lines[0].price).toBe("3.33333");
    expect(r.lines[0].priceExtension).toBe("10");
  });

  it("turns a negative (health-plan) item into a positive deduction line", () => {
    const r = buildLines(
      [
        { description: "Consulta", quantity: 1, totalCents: 300_000 },
        { description: "Desconto Plano de Saúde (30%)", quantity: 1, totalCents: -90_000 },
      ],
      NA
    );
    expect(r.lines[1]).toMatchObject({ type: "D", quantity: "1", price: "900", priceExtension: "900", netTotal: "900", code: "DESCONTO" });
    expect(r.totals).toEqual({ priceExtension: "2100", discount: "900", net: "2100", tax: "0", payable: "2100" });
    expect(r.payableCents).toBe(210_000);
  });

  it("falls back to the item text and a generic code when there is no catalogue service", () => {
    const r = buildLines([{ description: "  Sessão   extra  ", quantity: 1, totalCents: 5000 }], NA);
    expect(r.lines[0]).toMatchObject({ code: "SERVICO", description: "Sessão extra" });
  });

  it("prefers the catalogue service name over free text (controlled wording goes to DNRE)", () => {
    const r = buildLines([{ description: "Terapia de casal — caso X", quantity: 1, totalCents: 5000, serviceName: "Consulta de Psicologia" }], NA);
    expect(r.lines[0].description).toBe("Consulta de Psicologia");
  });
});

describe("buildLines — IVA on tax-inclusive prices", () => {
  it("extracts the tax so net + tax is exactly the amount the patient pays", () => {
    const r = buildLines([{ description: "Consulta", quantity: 1, totalCents: 10_000 }], IVA15); // 100.00 gross
    expect(r.lines[0]).toMatchObject({ priceExtension: "86.96", netTotal: "86.96", price: "86.96", tax: { typeCode: "IVA", percentage: "15", taxTotal: "13.04" } });
    expect(r.totals).toMatchObject({ net: "86.96", tax: "13.04", payable: "100" });
    expect(r.payableCents).toBe(10_000);
  });

  it("keeps the invoice total exact across many lines despite per-line rounding", () => {
    const items = [333, 777, 1999, 12_345, 99_999].map((c, i) => ({ description: `i${i}`, quantity: 1, totalCents: c }));
    const r = buildLines(items, IVA15);
    expect(r.payableCents).toBe(333 + 777 + 1999 + 12_345 + 99_999);
  });

  it("subtracts the tax of a deduction line", () => {
    const r = buildLines(
      [
        { description: "Consulta", quantity: 1, totalCents: 10_000 },
        { description: "Desconto", quantity: 1, totalCents: -3000 },
      ],
      IVA15
    );
    expect(r.payableCents).toBe(7000);
    expect(r.lines[1].type).toBe("D");
  });

  it("formats a fractional rate without trailing zeros", () => {
    expect(buildLines([{ description: "x", quantity: 1, totalCents: 1000 }], { typeCode: "IVA", percentage: 7.5 }).lines[0].tax.percentage).toBe("7.5");
  });
});

describe("chooseDocument", () => {
  const d = (totalCents: number, paidSameDayCents: number, hasNif: boolean) => chooseDocument({ totalCents, paidSameDayCents, hasNif });

  it("paid in full the same day with a NIF → FRE", () => expect(d(300_000, 300_000, true)).toEqual({ kind: "invoice_receipt" }));
  it("not (fully) paid with a NIF → FTE", () => {
    expect(d(300_000, 0, true)).toEqual({ kind: "invoice" });
    expect(d(300_000, 100_000, true)).toEqual({ kind: "invoice" }); // partial payment can never be an FRE
  });
  it("paid in full, no NIF, below 20 000 CVE → TVE", () => expect(d(1_999_900, 1_999_900, false)).toEqual({ kind: "sales_receipt" }));
  it("no NIF at 20 000 CVE or more → needs the NIF, even if paid", () => {
    expect(d(TVE_RECEIVER_THRESHOLD_CENTS, TVE_RECEIVER_THRESHOLD_CENTS, false)).toMatchObject({ wait: "NEEDS_NIF" });
  });
  it("no NIF and not paid → waits for payment", () => expect(d(300_000, 0, false)).toMatchObject({ wait: "AWAITING_PAYMENT" }));
  it("zero-value invoices are not reported", () => expect(d(0, 0, true)).toMatchObject({ wait: "NOTHING_TO_REPORT" }));
});

describe("payments", () => {
  it("maps CAP payment methods to UNECE means codes", () => {
    expect(PAYMENT_MEANS).toEqual({ cash: "10", bank_transfer: "30", vinti4: "48", health_plan: "97" });
  });

  it("strips spaces from the reference and uses the CV payment date", () => {
    expect(toDfePayment({ amountCents: 150_050, method: "bank_transfer", reference: "TRF 123 456", paidAtCvDate: "2026-10-03" })).toEqual({
      meansCode: "30", reference: "TRF123456", date: "2026-10-03", amount: "1500.5",
    });
  });

  it("omits an empty reference and defaults an unknown method to 'instrument not defined'", () => {
    const p = toDfePayment({ amountCents: 100, method: "mystery", reference: "   ", paidAtCvDate: "2026-10-03" });
    expect(p.reference).toBeUndefined();
    expect(p.meansCode).toBe("1");
  });
});

describe("itemCode", () => {
  it("removes spaces, caps at 50 chars and falls back when empty", () => {
    expect(itemCode("A B C", "X")).toBe("ABC");
    expect(itemCode("x".repeat(80), "X")).toHaveLength(50);
    expect(itemCode(null, "X")).toBe("X");
    expect(itemCode("   ", "X")).toBe("X");
  });
});
