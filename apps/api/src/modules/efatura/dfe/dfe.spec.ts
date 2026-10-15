import { unzipSync, strFromU8 } from "fflate";
import { buildDfeXml, buildEventXml } from "./dfe-xml";
import { loadSigningKey, signXml } from "./dfe-signer";
import { buildEventId, buildIud, luhnDv } from "./iud";
import { divRound, fmtCents, fmtScaled, rateToMilli, splitInclusive, toCents } from "./money";
import { zipXml } from "./zip";
import { DOC_TYPE_CODE, type DfeInput, type DocKind } from "./dfe.types";
import { makeIdentity, signatureIsValid, xsdErrors } from "../testing/efatura-test-utils";
import { cvParts } from "../../../common/cabo-verde-time";

describe("money", () => {
  it("rounds half away from zero on integers", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
  });

  it("formats without insignificant zeros", () => {
    expect(fmtCents(3000000)).toBe("30000");
    expect(fmtCents(1250)).toBe("12.5");
    expect(fmtCents(5)).toBe("0.05");
    expect(fmtScaled(869565, 5)).toBe("8.69565");
  });

  it("splits a tax-inclusive amount so net + tax equals the gross exactly", () => {
    const { net, tax } = splitInclusive(10000, rateToMilli(15)); // 100.00 gross @ 15%
    expect(net).toBe(8696); // 86.96
    expect(net + tax).toBe(10000);
    expect(tax).toBe(1304);
    expect(toCents("12.34")).toBe(1234);
  });
});

describe("IUD", () => {
  it("reproduces the check digit of the official sample ids", () => {
    // From DNRE's XSD samples: the DV is the last character.
    for (const id of ["CV1200520123456789000112345678901112345678904", "CV2211004999999999000010500000000194937284751"]) {
      expect(luhnDv(id.slice(2, -1))).toBe(Number(id.slice(-1)));
    }
  });

  it("matches the standard Luhn vector", () => {
    expect(luhnDv("7992739871")).toBe(3);
  });

  it("builds a 45-char id that matches the XSD pattern", () => {
    const iud = buildIud({
      repositoryCode: 2,
      yymmdd: "261003",
      nif: "123456789",
      ledCode: 7,
      documentTypeCode: 2,
      documentNumber: 12,
      random: "0000000042",
    });
    expect(iud).toHaveLength(45);
    expect(iud).toMatch(/^CV\d\d{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[1-9]\d{8}\d{27}$/);
    expect(iud.slice(2, 3)).toBe("2"); // repository
    expect(iud.slice(3, 9)).toBe("261003");
    expect(iud.slice(18, 23)).toBe("00007"); // LED
    expect(iud.slice(23, 25)).toBe("02"); // type
    expect(iud.slice(25, 34)).toBe("000000012"); // number
    expect(luhnDv(iud.slice(2, -1))).toBe(Number(iud.slice(-1)));
  });

  it("builds 24-char event ids", () => {
    expect(buildEventId(1, "261003101530", "123456789")).toBe("CV1261003101530123456789");
  });
});

describe("cvParts", () => {
  it("shifts UTC to Cabo Verde time (UTC-1) across midnight", () => {
    const p = cvParts(new Date("2026-01-01T00:30:00Z")); // 23:30 on 31 Dec in CV
    expect(p.date).toBe("2025-12-31");
    expect(p.time).toBe("23:30:00");
    expect(p.yymmddhhmmss).toBe("251231233000");
  });
});

// ── Documents ────────────────────────────────────────────────────────────────

const EMITTER = {
  taxId: "123456789",
  name: "Clinica Teste Lda",
  address: { detail: "Rua de Teste 1, Praia", code: "CV774741741037410321" },
  phone: "2611234",
  email: "geral@clinica.cv",
};
const TRANSMISSION = {
  issueMode: 1 as const,
  transmitterTaxId: "123456789",
  software: { code: "CAP360", name: "CAP 360", version: "1.0.0" },
};
const LINE = {
  id: 1,
  type: "N" as const,
  quantity: "1",
  unitCode: "UN",
  price: "30000",
  priceExtension: "30000",
  netTotal: "30000",
  tax: { typeCode: "NA" as const, exemptionReasonCode: 3 },
  code: "CONSULTA",
  description: "Consulta de Psicologia",
};
const TOTALS = { priceExtension: "30000", net: "30000", tax: "0", payable: "30000" };

function sample(kind: DocKind): DfeInput {
  const documentTypeCode = DOC_TYPE_CODE[kind];
  const base: DfeInput = {
    kind,
    iud: buildIud({
      repositoryCode: 2,
      yymmdd: "261003",
      nif: "123456789",
      ledCode: 1,
      documentTypeCode,
      documentNumber: 1,
      random: "0123456789",
    }),
    ledCode: 1,
    serie: "A2026",
    documentNumber: 1,
    innerNumber: "INV-2026-0001",
    issueDate: "2026-10-03",
    issueTime: "11:01:02",
    emitter: EMITTER,
    receiver: { taxId: "987654321", name: "Maria Paciente" },
    lines: [LINE],
    totals: TOTALS,
    transmission: TRANSMISSION,
    repositoryCode: 2,
  };
  const payments = [{ meansCode: "10", date: "2026-10-03", amount: "30000" }];
  const refIud = buildIud({
    repositoryCode: 2, yymmdd: "261003", nif: "123456789", ledCode: 1, documentTypeCode: 1, documentNumber: 5, random: "0000000001",
  });
  switch (kind) {
    case "invoice":
      return base;
    case "invoice_receipt":
      return { ...base, payments };
    case "sales_receipt":
      return { ...base, receiver: undefined, payments };
    case "receipt":
      return {
        ...base,
        lines: undefined,
        totals: undefined,
        receiptTypeCode: 2,
        references: [{ iud: refIud, paymentAmount: "30000", tax: { typeCode: "NA", exemptionReasonCode: 3 } }],
        payments,
      };
    case "credit_note":
      return { ...base, issueReasonCode: "2", references: [{ iud: refIud }], note: "Serviço não prestado ao paciente" };
  }
}

describe("DFE XML + XAdES signature", () => {
  const id = makeIdentity();
  const key = loadSigningKey(id.p12Base64, id.password);
  const kinds: DocKind[] = ["invoice", "invoice_receipt", "sales_receipt", "receipt", "credit_note"];

  it.each(kinds)("%s: unsigned XML validates against DNRE's XSD", async (kind) => {
    const xml = buildDfeXml(sample(kind));
    // The XSD keeps <Signature> optional, so an unsigned document is schema-valid too.
    expect(await xsdErrors(xml)).toEqual([]);
  });

  it.each(kinds)("%s: signed XML validates against the XSD and the signature verifies", async (kind) => {
    const input = sample(kind);
    const signed = signXml(buildDfeXml(input), input.iud, key, "2026-10-03T11:01:03");
    expect(await xsdErrors(signed)).toEqual([]);
    expect(signatureIsValid(signed, id.certPem)).toBe(true);
  });

  it("detects tampering after signing", () => {
    const input = sample("invoice_receipt");
    const signed = signXml(buildDfeXml(input), input.iud, key, "2026-10-03T11:01:03");
    expect(signatureIsValid(signed.replace("<PayableAmount>30000<", "<PayableAmount>1<"), id.certPem)).toBe(false);
  });

  it("marks specimens and keeps a deduction line valid (positive amounts, LineTypeCode D)", async () => {
    const input = sample("invoice_receipt");
    input.isSpecimen = true;
    input.lines = [
      LINE,
      { ...LINE, id: 2, type: "D", price: "9000", priceExtension: "9000", netTotal: "9000", code: "DESC-PLANO", description: "Desconto Plano de Saúde (30%)" },
    ];
    input.totals = { priceExtension: "21000", discount: "9000", net: "21000", tax: "0", payable: "21000" };
    input.payments = [{ meansCode: "48", date: "2026-10-03", amount: "21000", reference: "REF123" }];
    const xml = buildDfeXml(input);
    expect(xml).toContain("<IsSpecimen>true</IsSpecimen>");
    expect(await xsdErrors(xml)).toEqual([]);
  });

  it("emits IVA with an explicit line tax total", async () => {
    const input = sample("invoice");
    input.lines = [{ ...LINE, price: "86.96", priceExtension: "86.96", netTotal: "86.96", tax: { typeCode: "IVA", percentage: "15", taxTotal: "13.04" } }];
    input.totals = { priceExtension: "86.96", net: "86.96", tax: "13.04", payable: "100" };
    expect(await xsdErrors(buildDfeXml(input))).toEqual([]);
  });

  it("rejects structurally impossible input before anything is signed", () => {
    expect(() => buildDfeXml({ ...sample("invoice"), receiver: undefined })).toThrow(/receiver/);
    expect(() => buildDfeXml({ ...sample("invoice"), lines: [] })).toThrow(/lines/);
  });

  it("builds a valid, signed FDC cancellation event", async () => {
    const eventId = buildEventId(2, "261003110200", "123456789");
    const xml = buildEventXml({
      type: "FDC",
      id: eventId,
      emitterTaxId: "123456789",
      issueDateTime: "2026-10-03T11:02:00",
      reason: "Fatura emitida por engano",
      iuds: [sample("invoice").iud],
      transmission: TRANSMISSION,
      repositoryCode: 2,
    });
    const signed = signXml(xml, eventId, key, "2026-10-03T11:02:01");
    expect(await xsdErrors(signed)).toEqual([]);
    expect(signatureIsValid(signed, id.certPem)).toBe(true);
  });

  it("escapes XML special characters in free text", () => {
    const input = sample("invoice");
    input.lines = [{ ...LINE, description: "Consulta <A&B> \"x\"" }];
    expect(buildDfeXml(input)).toContain("Consulta &lt;A&amp;B&gt; &quot;x&quot;");
  });
});

describe("zipXml", () => {
  it("packs one Deflate entry named after the document", () => {
    const zip = zipXml("CV123.xml", "<a/>");
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files)).toEqual(["CV123.xml"]);
    expect(strFromU8(files["CV123.xml"])).toBe("<a/>");
  });
});

describe("loadSigningKey", () => {
  it("opens a PKCS#12 and a PEM bundle for the same identity", () => {
    const id = makeIdentity({ cn: "Emissor Teste" });
    const fromP12 = loadSigningKey(id.p12Base64, id.password);
    const fromPem = loadSigningKey(`${id.keyPem}\n${id.certPem}`, "");
    expect(fromP12.subject).toContain("CN=Emissor Teste");
    expect(fromPem.certPem.trim()).toBe(fromP12.certPem.trim());
  });

  it("explains a wrong password", () => {
    const id = makeIdentity();
    expect(() => loadSigningKey(id.p12Base64, "wrong")).toThrow(/palavra-passe/);
  });

  it("refuses an expired certificate", () => {
    const id = makeIdentity({ days: 2, startOffsetDays: -10 });
    expect(() => loadSigningKey(id.p12Base64, id.password)).toThrow(/expirou/);
  });

  it("refuses a bundle whose certificate does not match the key", () => {
    const a = makeIdentity();
    const b = makeIdentity();
    expect(() => loadSigningKey(`${a.keyPem}\n${b.certPem}`, "")).toThrow(/corresponde/);
  });
});
