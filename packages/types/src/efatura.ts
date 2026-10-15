import { z } from "zod";

// Cabo Verde e-Fatura (DNRE) direct integration — shared config shapes. The patterns mirror the
// official XSD pack (CV_EFatura_Types_v1.0.xsd) so a value that passes here also passes the platform.

/** NIF of a Cabo Verde taxpayer: 9 digits, first digit 1–9 (stTaxIdCV). */
export const EFATURA_NIF_RE = /^[1-9]\d{8}$/;

export const EFaturaRepositoryCode = { PRINCIPAL: 1, HOMOLOGACAO: 2, TESTE: 3 } as const;
export type EFaturaRepositoryCode = (typeof EFaturaRepositoryCode)[keyof typeof EFaturaRepositoryCode];

/** Reason codes allowed on a Nota de Crédito (stIssueReasonCode). */
export const CREDIT_NOTE_REASON_CODES = ["2", "3", "6", "7", "8", "9", "DRP", "IN"] as const;

const emailRe = /^\w+((-|\.|_)\w+)*@\w+((-|\.|_)\w+)*\.\w+(\.\w+)*$/;

/** Non-secret integration settings. Every field is nullable/optional so an admin can fill the form
 * progressively — `ready`/`missing` in EFaturaConfigView say what is still needed. */
export const EFaturaConfigSchema = z.object({
  enabled: z.boolean(),
  /** Only invoices issued at/after this instant are reported to DNRE (never back-fills history). */
  goLiveAt: z.string().datetime({ offset: true }).nullable(),
  /** 1 Principal · 2 Homologação · 3 Teste. */
  repositoryCode: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Marks every document <IsSpecimen>: DNRE deletes them after 24h — a safe live smoke test. */
  isSpecimen: z.boolean(),
  ledCode: z.number().int().min(1).max(99999).nullable(),
  serie: z
    .string()
    .max(20)
    .regex(/^[A-Za-z0-9]+([_-][A-Za-z0-9]+)*$/, "Série: letras, dígitos, - e _")
    .nullable(),
  softwareCode: z
    .string()
    .regex(/^[A-Z0-9]{1,10}$/, "Código do software: até 10 letras maiúsculas/dígitos")
    .nullable(),
  softwareName: z.string().min(3).max(150).nullable(),
  softwareVersion: z.string().min(1).max(50).nullable(),
  transmitterTaxId: z.string().regex(EFATURA_NIF_RE, "NIF inválido").nullable(),
  emitterAddressDetail: z.string().min(1).max(100).nullable(),
  /** 20-char CV address code (e.g. CV774741741037410321) from DNRE's "Lugares CV" list. */
  emitterAddressCode: z
    .string()
    .regex(/^CV\d{18}$/, "Código de endereço: CV + 18 dígitos")
    .nullable(),
  emitterEmail: z.string().max(256).regex(emailRe, "Email inválido").nullable(),
  /** Digits only (the XSD rejects "+238 …"). */
  emitterPhone: z.string().regex(/^\d{7,20}$/, "Telefone: apenas dígitos (7–20)").nullable(),
  /** NA = exempt (needs a reason code); IVA = standard tax (needs a rate). CAP prices are treated
   * as tax-inclusive, so the amount a patient pays never changes. */
  taxTypeCode: z.enum(["NA", "IVA"]).nullable(),
  taxPercentage: z.number().gt(0).max(100).nullable(),
  taxExemptionReasonCode: z.number().int().min(1).max(21).nullable(),
  creditNoteReasonCode: z.enum(CREDIT_NOTE_REASON_CODES),
  oauthClientId: z.string().min(1).max(200).nullable(),
  /** Must equal, character for character, the Redirect URI registered in the PE. */
  oauthRedirectUri: z.string().url().max(500).nullable(),

  // ── Techplace (api.techplace.cv) — read only when the API runs with EFATURA_PROVIDER=techplace.
  // Ids come from the Techplace entity ("Testar ligação" lists them); none of these is a secret.
  techplaceEntityId: z.string().min(1).max(100).nullable(),
  /** The Techplace user ("utilizador") the sales are issued as. */
  techplaceUserId: z.string().min(1).max(100).nullable(),
  /** Only needed when Techplace asks for a JWT login instead of (or besides) an API key. */
  techplaceUsername: z.string().min(1).max(100).nullable(),
  /** `tipoFatura` codes (Fatura-Recibo / Talão de Venda). Fatura (FT) is not sent: see M6b. */
  techplaceTypeFR: z.string().min(1).max(20).nullable(),
  techplaceTypeTV: z.string().min(1).max(20).nullable(),
  techplaceConditionId: z.string().min(1).max(100).nullable(),
  /** CAP payment method (cash, vinti4, bank_transfer, health_plan) → Techplace payment-method id. */
  techplaceMethods: z.record(z.string().min(1).max(100)),
  /** Used when registering a Service as a Techplace product. */
  techplaceIvaId: z.string().min(1).max(100).nullable(),
  techplaceUnitId: z.string().min(1).max(100).nullable(),
  /** Product used for invoice lines that have no Service (their description cannot be sent). */
  techplaceProductId: z.string().min(1).max(100).nullable(),
});
export type EFaturaConfig = z.infer<typeof EFaturaConfigSchema>;

export const DEFAULT_EFATURA_CONFIG: EFaturaConfig = {
  enabled: false,
  goLiveAt: null,
  repositoryCode: 2,
  isSpecimen: false,
  ledCode: null,
  serie: null,
  softwareCode: null,
  softwareName: null,
  softwareVersion: null,
  transmitterTaxId: null,
  emitterAddressDetail: null,
  emitterAddressCode: null,
  emitterEmail: null,
  emitterPhone: null,
  taxTypeCode: null,
  taxPercentage: null,
  taxExemptionReasonCode: null,
  creditNoteReasonCode: "2",
  oauthClientId: null,
  oauthRedirectUri: null,
  techplaceEntityId: null,
  techplaceUserId: null,
  techplaceUsername: null,
  techplaceTypeFR: null,
  techplaceTypeTV: null,
  techplaceConditionId: null,
  techplaceMethods: {},
  techplaceIvaId: null,
  techplaceUnitId: null,
  techplaceProductId: null,
};

/** PATCH body: any subset of the settings, plus the write-only secrets. */
export const UpdateEFaturaConfigSchema = EFaturaConfigSchema.partial().extend({
  oauthClientSecret: z.string().min(1).max(500).optional(),
  techplacePassword: z.string().min(1).max(500).optional(),
  techplaceApiKey: z.string().min(1).max(500).optional(),
});
export type UpdateEFaturaConfigDto = z.infer<typeof UpdateEFaturaConfigSchema>;

/** POST body for the signing certificate: a PKCS#12 (.p12/.pfx) as base64, or a PEM bundle as text. */
export const UploadEFaturaCertificateSchema = z.object({
  file: z.string().min(1).max(200_000),
  password: z.string().max(200).default(""),
});
export type UploadEFaturaCertificateDto = z.infer<typeof UploadEFaturaCertificateSchema>;

export interface EFaturaConfigView extends EFaturaConfig {
  /** Which transport the API runs with (EFATURA_PROVIDER); decides which settings matter. */
  provider: "dnre" | "techplace";
  hasTechplacePassword: boolean;
  hasTechplaceApiKey: boolean;
  hasClientSecret: boolean;
  /** An admin completed the PE consent (a refresh token is stored). */
  connected: boolean;
  connectedAt: string | null;
  hasCertificate: boolean;
  certificateSubject: string | null;
  certificateNotAfter: string | null;
  /** Clinic identity used as the emitter (Configurações → Clínica). */
  clinicName: string | null;
  clinicNif: string | null;
  /** True when enabled and nothing is missing — submissions are being sent. */
  ready: boolean;
  /** Human-readable list of what still blocks submissions (Portuguese). */
  missing: string[];
}
