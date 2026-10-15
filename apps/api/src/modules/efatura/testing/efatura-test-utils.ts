// Test-only helpers (excluded from the production build via tsconfig): an XSD validator wired to
// DNRE's official schema pack, and throw-away signing identities.
import fs from "fs";
import path from "path";
import { createPrivateKey, generateKeyPairSync } from "crypto";
import forge from "node-forge";
import { validateXML } from "xmllint-wasm";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

export const XSD_DIR = path.resolve(__dirname, "../../../../test/fixtures/efatura-xsd");
const read = (f: string) => fs.readFileSync(path.join(XSD_DIR, f), "utf8");

/** Validates `xml` against EnvelopedSignature.xsd (the pack's entry point). Returns the error list. */
export async function xsdErrors(xml: string): Promise<string[]> {
  const preload = fs.readdirSync(path.join(XSD_DIR, "common")).map((f) => ({
    fileName: `common/${f}`,
    contents: read(`common/${f}`),
  }));
  const r = await validateXML({
    xml: [{ fileName: "doc.xml", contents: xml }],
    schema: [read("EnvelopedSignature.xsd")],
    preload,
  });
  return r.valid ? [] : r.errors.map((e) => e.message);
}

export interface TestIdentity {
  /** PKCS#8 PEM */
  keyPem: string;
  certPem: string;
  p12Base64: string;
  password: string;
}

/** A self-signed RSA identity (valid `days` from `startOffsetDays`) plus its PKCS#12 packaging. */
export function makeIdentity(opts: { cn?: string; days?: number; startOffsetDays?: number; password?: string } = {}): TestIdentity {
  const { cn = "Clinica Teste, Lda", days = 365, startOffsetDays = -1, password = "secret" } = opts;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(createPrivateKey(keyPem).export({ type: "pkcs1", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = "01a2b3c4d5";
  const day = 86_400_000;
  cert.validity.notBefore = new Date(Date.now() + startOffsetDays * day);
  cert.validity.notAfter = new Date(Date.now() + (startOffsetDays + days) * day);
  const attrs = [
    { name: "commonName", value: cn },
    { name: "organizationName", value: "CAP" },
    { name: "countryName", value: "CV" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgeKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const p12 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], password, { algorithm: "3des" });
  return {
    keyPem,
    certPem,
    p12Base64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    password,
  };
}

/** Verifies the enveloped signature with xml-crypto (independent of the signing code path). */
export function signatureIsValid(signedXml: string, certPem: string): boolean {
  const doc = new DOMParser().parseFromString(signedXml, "text/xml");
  const sigs = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (sigs.length !== 1) return false;
  const verifier = new SignedXml({ publicCert: certPem });
  verifier.loadSignature(sigs[0] as unknown as Node);
  return verifier.checkSignature(signedXml);
}
