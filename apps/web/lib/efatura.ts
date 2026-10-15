import type { EFaturaPurpose, EFaturaStatus, EFaturaSubmission } from "@cap/types";

// Labels and colours for the fiscal documents CAP 360 sends to DNRE (e-Fatura), shared by the
// invoice list, the preview and the invoice detail panel.

export const EFATURA_META: Record<EFaturaStatus, { label: string; cls: string; dot: string }> = {
  pending:      { label: "Pendente",     cls: "bg-dim-100 text-dim-500",                                    dot: "bg-dim-400" },
  submitting:   { label: "A enviar…",    cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80",        dot: "bg-brand-500 animate-pulse" },
  accepted:     { label: "Autorizada",   cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",  dot: "bg-emerald-500" },
  rejected:     { label: "Rejeitada",    cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80",              dot: "bg-red-500" },
  cancelled:    { label: "Anulada",      cls: "bg-dim-100 text-dim-400",                                    dot: "bg-dim-300" },
  error:        { label: "Erro",         cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",        dot: "bg-amber-500" },
  not_required: { label: "Não aplicável", cls: "bg-dim-100 text-dim-400",                                   dot: "bg-dim-300" },
};

const DOC_LABEL: Record<number, string> = {
  1: "Fatura Eletrónica (FTE)",
  2: "Fatura-Recibo (FRE)",
  3: "Talão de Venda (TVE)",
  4: "Recibo (RCE)",
  5: "Nota de Crédito (NCE)",
};

const PURPOSE_LABEL: Record<EFaturaPurpose, string> = {
  issue: "Fatura",
  receipt: "Recibo",
  credit_note: "Nota de crédito",
  cancel: "Anulação (evento)",
};

/** "Fatura-Recibo (FRE)" once prepared; the generic purpose before that. */
export function docLabel(s: Pick<EFaturaSubmission, "purpose" | "documentTypeCode">): string {
  if (s.purpose === "cancel") return PURPOSE_LABEL.cancel;
  return (s.documentTypeCode != null ? DOC_LABEL[s.documentTypeCode] : undefined) ?? PURPOSE_LABEL[s.purpose];
}

/** "A2026 · 12/2026" style number as DNRE shows it — or Techplace's own number (e.g. "FRAA-123")
 * when that transport issued the sale — or null before it is assigned. */
export function docNumber(s: Pick<EFaturaSubmission, "serie" | "documentNumber" | "year" | "externalCode">): string | null {
  if (s.externalCode) return s.externalCode;
  return s.documentNumber != null ? `${s.serie ?? ""} ${s.documentNumber}/${s.year ?? ""}`.trim() : null;
}

/** Techplace confirms the sale exists; whether DNRE authorized it is not something we can see
 * yet (no IUD comes back), so "Autorizada" would overstate it. */
export const issuedByTechplace = (s: Pick<EFaturaSubmission, "status" | "iud" | "externalCode">): boolean =>
  s.status === "accepted" && !!s.externalCode && !s.iud;

export const statusLabel = (s: Pick<EFaturaSubmission, "status" | "iud" | "externalCode">): string =>
  issuedByTechplace(s) ? "Emitida" : EFATURA_META[s.status]?.label ?? EFATURA_META.pending.label;

/** Codes under which a pending document is waiting for something, not failing. */
export const WAITING_REASON: Record<string, string> = {
  TECHPLACE_UNSUPPORTED: "O Techplace ainda não suporta este documento — trate-o no Techplace",
  AWAITING_PAYMENT: "A aguardar o pagamento total (paciente sem NIF)",
  AWAITING_PRIMARY: "A aguardar a autorização da fatura",
  NEEDS_NIF: "Falta o NIF do paciente",
  DISABLED: "Integração e-Fatura desativada",
};
