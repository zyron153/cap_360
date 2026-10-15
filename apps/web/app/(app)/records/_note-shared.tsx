"use client";

import { Lock, PencilLine } from "lucide-react";
import { NOTE_CHANGED_CODE, type ClinicalNoteEntry, type RiskLevel } from "@cap/types";

export type NoteWithPatient = ClinicalNoteEntry & { patient?: { fullName: string } };

export const RISK_META: Record<RiskLevel, { label: string; short: string; cls: string }> = {
  none:     { label: "Sem risco identificado", short: "Sem risco", cls: "bg-dim-100 text-dim-500" },
  low:      { label: "Risco baixo",            short: "Baixo",     cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  moderate: { label: "Risco moderado",         short: "Moderado",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  high:     { label: "Risco elevado",          short: "Elevado",   cls: "bg-red-50 text-red-700 ring-1 ring-red-200/80" },
};

export const SESSION_TYPES = [
  ["individual", "Individual"],
  ["couples", "Casal"],
  ["group", "Grupo"],
  ["initial_assessment", "Avaliação inicial"],
] as const;
export const sessionTypeLabel = (v: string) => SESSION_TYPES.find(([k]) => k === v)?.[1] ?? v;

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const isDraft = (n: Pick<ClinicalNoteEntry, "finalizedAt">) => n.finalizedAt === null;
/** Mirrors the API's rule (ClinicalRecordsService.updateNote): finalized + >24h old + not admin. */
export const isLocked = (n: Pick<ClinicalNoteEntry, "finalizedAt">, isAdmin: boolean) =>
  !isAdmin && !!n.finalizedAt && Date.now() - new Date(n.finalizedAt).getTime() > EDIT_WINDOW_MS;

/** One line of what the note says, for list rows — the assessment if there is one. */
export function notePreview(n: ClinicalNoteEntry, max = 120): string {
  const text = (n.assessment || n.plan || n.presentingConcerns || n.observations || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro ao carregar");
  return res.json();
}

/** Pt-CV wall clock for an instant (Cabo Verde is UTC-1 all year, whatever the viewer's PC is set to). */
export const formatCvDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-CV", {
    timeZone: "Atlantic/Cape_Verde", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

/** A non-2xx response: still an `Error` (callers that only read `.message` are unaffected), plus the status and body. */
export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
  }
}

export async function sendJson<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(data !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new HttpError(Array.isArray(e.message) ? e.message.map((m: { message: string }) => m.message).join(", ") : e.message ?? "Erro", res.status, e);
  }
  if (res.status === 204) return undefined as T; // DELETE answers with no body
  return res.json();
}

/** The note as it is now, when `e` is the API's "this note was saved elsewhere" 409 (else null). */
export const noteFromConflict = (e: unknown): ClinicalNoteEntry | null =>
  e instanceof HttpError && e.status === 409 && (e.body as { code?: string } | null)?.code === NOTE_CHANGED_CODE
    ? ((e.body as { note?: ClinicalNoteEntry }).note ?? null)
    : null;

/** Rascunho / Bloqueada markers — the risk badge is separate since list rows place it differently. */
export function NoteStateBadges({ note, isAdmin }: { note: ClinicalNoteEntry; isAdmin: boolean }) {
  if (isDraft(note)) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/80">
        <PencilLine className="w-3 h-3" /> Rascunho
      </span>
    );
  }
  if (isLocked(note, isAdmin)) {
    return (
      <span title="Bloqueada 24h após ser finalizada" className="inline-flex items-center text-dim-400">
        <Lock className="w-3 h-3" aria-label="Nota bloqueada" />
      </span>
    );
  }
  return null;
}

export const RiskBadge = ({ level, long }: { level: RiskLevel; long?: boolean }) => (
  <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${RISK_META[level]?.cls ?? ""}`}>
    {long ? RISK_META[level]?.label : RISK_META[level]?.short}
  </span>
);

/** The four structured sections (+ risk detail), read-only. Empty sections are skipped. */
export function NoteSections({ note }: { note: ClinicalNoteEntry }) {
  const sections = [
    ["Motivo / Estado apresentado", note.presentingConcerns],
    ["Observações", note.observations],
    ["Avaliação", note.assessment],
    ["Plano", note.plan],
  ].filter(([, v]) => v?.trim());
  return (
    <dl className="flex flex-col gap-3">
      {note.riskNotes?.trim() && (
        <div className="text-[12px] text-dim-700 bg-dim-50 rounded-[10px] px-3.5 py-2.5 whitespace-pre-wrap">
          <span className="font-semibold">Risco: </span>{note.riskNotes}
        </div>
      )}
      {sections.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400 mb-0.5">{label}</dt>
          <dd className="text-[13px] text-dim-800 whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
