import { createHash, createPrivateKey, createPublicKey, createSign, X509Certificate } from "crypto";
import { DOMParser } from "@xmldom/xmldom";
import { C14nCanonicalization, findAncestorNs } from "xml-crypto";
import forge from "node-forge";
import { esc } from "./dfe-xml";

// XAdES-BES enveloped signature, laid out exactly like the sample in DNRE's XSD pack
// (samples/sample-2-invoice-receipt.xml): two References (the document by Id, and the XAdES
// SignedProperties), RSA-SHA256, C14N 1.0, the signer's certificate in KeyInfo.

const DS = "http://www.w3.org/2000/09/xmldsig#";
const XADES = "http://uri.etsi.org/01903/v1.3.2#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const SHA256_ALG = "http://www.w3.org/2001/04/xmlenc#sha256";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SIG_ID = "EmitterPartySignatureId";
const SP_ID = "SignedPropertiesId";
const DATA_REF_ID = "DataReferenceId";

export interface SigningKey {
  /** PKCS#8 PEM, unencrypted. */
  privateKeyPem: string;
  /** Leaf certificate, PEM. */
  certPem: string;
  subject: string;
  notAfter: Date;
}

const b64sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("base64");
const parse = (xml: string) => new DOMParser().parseFromString(xml, "text/xml");

function pemBlocks(text: string, label: string): string[] {
  const re = new RegExp(`-----BEGIN ${label}-----[\\s\\S]*?-----END ${label}-----`, "g");
  return text.match(re) ?? [];
}

/** Accepts a PKCS#12 (.p12/.pfx, base64) or a PEM bundle (private key + certificate chain). */
export function loadSigningKey(file: string, password: string): SigningKey {
  let keyPem: string;
  let certPems: string[];

  if (file.includes("-----BEGIN")) {
    const key = pemBlocks(file, "(?:RSA |ENCRYPTED )?PRIVATE KEY")[0];
    certPems = pemBlocks(file, "CERTIFICATE");
    if (!key) throw new Error("O ficheiro PEM não contém uma chave privada");
    keyPem = key;
  } else {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const der = forge.util.decode64(file.replace(/\s+/g, ""));
      p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password);
    } catch (e) {
      throw new Error(
        `Não foi possível abrir o ficheiro .p12 (palavra-passe errada ou algoritmo não suportado — ` +
          `reexporte com "openssl pkcs12 -legacy"): ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
    ];
    const key = keyBags[0]?.key;
    if (!key) throw new Error("O ficheiro .p12 não contém uma chave privada");
    keyPem = forge.pki.privateKeyToPem(key);
    certPems = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
      .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : ""))
      .filter(Boolean);
  }

  let privateKey;
  try {
    privateKey = createPrivateKey({ key: keyPem, passphrase: password || undefined });
  } catch {
    throw new Error("Não foi possível ler a chave privada (palavra-passe errada?)");
  }
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("A chave privada tem de ser RSA");

  // The leaf is the certificate whose public key matches the private key (the file may carry the chain).
  const wanted = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const leafPem = certPems.find((pem) =>
    new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" }).equals(wanted)
  );
  if (!leafPem) throw new Error("Nenhum certificado do ficheiro corresponde à chave privada");

  const x509 = new X509Certificate(leafPem);
  const notAfter = new Date(x509.validTo);
  if (notAfter.getTime() <= Date.now()) throw new Error(`O certificado expirou em ${notAfter.toISOString().slice(0, 10)}`);

  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certPem: leafPem,
    subject: x509.subject.split("\n").join(", "),
    notAfter,
  };
}

/** Canonicalizes `localName` (an element of `xml`) the way a verifier does: in its document context. */
function c14nInContext(xml: string, localName: string): string {
  const doc = parse(xml);
  const xp = `//*[local-name()='${localName}']`;
  const node = (doc as unknown as { getElementsByTagNameNS(ns: string, n: string): ArrayLike<Node> }).getElementsByTagNameNS(
    localName === "SignedProperties" ? XADES : DS,
    localName
  )[0];
  return new C14nCanonicalization().process(node, { ancestorNamespaces: findAncestorNs(doc, xp) } as never);
}

/** Signs `xml` (a Dfe or Event whose root carries `Id="rootId"`) and returns it with the
 * <ds:Signature> appended inside the root. `signingTime` is "YYYY-MM-DDTHH:MM:SS" (Cabo Verde time). */
export function signXml(xml: string, rootId: string, key: SigningKey, signingTime: string): string {
  const x509 = new X509Certificate(key.certPem);
  const certDer = x509.raw;
  const issuer = x509.issuer.split("\n").reverse().join(","); // RFC 2253: most specific first
  const serial = BigInt(`0x${x509.serialNumber}`).toString(10);

  // 1. Digest of the document itself. No signature exists yet, so the enveloped-signature transform
  //    is the identity; a verifier removes the signature again and gets these exact bytes.
  const dataDigest = b64sha256(new C14nCanonicalization().process(parse(xml).documentElement, {} as never));

  const signedProps =
    `<xades:SignedProperties Id="${SP_ID}"><xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${esc(signingTime)}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert><xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="${SHA256_ALG}"/><ds:DigestValue>${b64sha256(certDer)}</ds:DigestValue></xades:CertDigest>` +
    `<xades:IssuerSerial><ds:X509IssuerName>${esc(issuer)}</ds:X509IssuerName><ds:X509SerialNumber>${serial}</ds:X509SerialNumber></xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties>` +
    `<xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference="#${DATA_REF_ID}">` +
    `<xades:MimeType>text/xml</xades:MimeType></xades:DataObjectFormat></xades:SignedDataObjectProperties></xades:SignedProperties>`;

  const reference = (attrs: string, transform: string, digest: string) =>
    `<ds:Reference ${attrs}><ds:Transforms><ds:Transform Algorithm="${transform}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256_ALG}"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>`;

  const sigXml = (spDigest: string, sigValue: string) =>
    `<ds:Signature xmlns:ds="${DS}" Id="${SIG_ID}"><ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${C14N}"/><ds:SignatureMethod Algorithm="${RSA_SHA256}"/>` +
    reference(`Id="${DATA_REF_ID}" URI="#${esc(rootId)}"`, `${DS}enveloped-signature`, dataDigest) +
    reference(`URI="#${SP_ID}" Type="http://uri.etsi.org/01903#SignedProperties"`, C14N, spDigest) +
    `</ds:SignedInfo><ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certDer.toString("base64")}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${XADES}" Target="#${SIG_ID}">${signedProps}</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`;

  const at = xml.lastIndexOf("</");
  const place = (sig: string) => `${xml.slice(0, at)}${sig}${xml.slice(at)}`;

  // 2. Digest of SignedProperties and signature over SignedInfo, both canonicalized in context
  //    (inclusive C14N pulls in the namespaces inherited from the document root).
  const spDigest = b64sha256(c14nInContext(place(sigXml("", "")), "SignedProperties"));
  const signedInfoC14n = c14nInContext(place(sigXml(spDigest, "")), "SignedInfo");
  const sigValue = createSign("RSA-SHA256").update(signedInfoC14n).sign(key.privateKeyPem, "base64");
  return place(sigXml(spDigest, sigValue));
}
