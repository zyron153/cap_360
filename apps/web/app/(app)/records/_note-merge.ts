import type { ClinicalNoteEntry, RiskLevel } from "@cap/types";

/**
 * Three-way merge of a clinical note, for the "saved in another tab" conflict (M7 §2.1).
 *
 *   base   — what this tab last synced with the server (the last save it made, or the note it opened)
 *   mine   — what is in the form now
 *   theirs — the note the server holds now (the 409 body)
 *
 * It works per *section* (a field the doctor thinks of as one thing): changed only here keeps mine, changed
 * only there takes theirs, changed to the same value on both sides is not a conflict, and changed differently
 * on both sides is a real conflict the doctor decides. Pure, no React — the editor and its end-to-end tests
 * share one definition of "what counts as a conflict".
 */

export type NoteForm = {
  sessionType: string;
  durationMinutes: number | "";
  presentingConcerns: string;
  observations: string;
  assessment: string;
  plan: string;
  riskLevel: RiskLevel;
  riskNotes: string;
};

export function formFromNote(n: ClinicalNoteEntry): NoteForm {
  return {
    sessionType: n.sessionType,
    durationMinutes: n.durationMinutes ?? "",
    presentingConcerns: n.presentingConcerns,
    observations: n.observations,
    assessment: n.assessment,
    plan: n.plan,
    riskLevel: n.riskLevel,
    riskNotes: n.riskNotes ?? "",
  };
}

/** The units that are merged. `risk` is the level together with its detail text: one clinical statement. */
export const MERGE_KEYS = ["presentingConcerns", "observations", "assessment", "plan", "risk", "sessionType", "durationMinutes"] as const;
export type MergeKey = (typeof MERGE_KEYS)[number];

export const MERGE_LABEL: Record<MergeKey, string> = {
  presentingConcerns: "Motivo / Estado apresentado",
  observations: "Observações",
  assessment: "Avaliação",
  plan: "Plano",
  risk: "Nível de risco",
  sessionType: "Tipo de sessão",
  durationMinutes: "Duração",
};

export type Choice = "mine" | "theirs";

export type MergeResult = {
  /** The form after the merge. A section that is still unresolved holds `mine` until it is chosen. */
  merged: NoteForm;
  /** Sections where the server's version replaced the form's (changed only in the other tab). */
  fromTheirs: MergeKey[];
  /** Sections where this tab's own edits were kept (changed only here). */
  keptMine: MergeKey[];
  /** Sections the doctor chose a side for. */
  chosen: MergeKey[];
  /** Sections changed differently on both sides that have no choice yet. */
  unresolved: MergeKey[];
};

const norm = (s: string) => s.replace(/\r\n/g, "\n");

/** The comparable value of a section (the risk detail only counts while a risk level is set, like the payload). */
function valueOf(f: NoteForm, k: MergeKey): string {
  switch (k) {
    case "risk": return `${f.riskLevel}\u0000${f.riskLevel === "none" ? "" : norm(f.riskNotes)}`;
    case "durationMinutes": return String(f.durationMinutes);
    case "sessionType": return f.sessionType;
    default: return norm(f[k]);
  }
}

function copySection(into: NoteForm, from: NoteForm, k: MergeKey) {
  if (k === "risk") { into.riskLevel = from.riskLevel; into.riskNotes = from.riskNotes; }
  else if (k === "durationMinutes") into.durationMinutes = from.durationMinutes;
  else if (k === "sessionType") into.sessionType = from.sessionType;
  else into[k] = from[k];
}

export function mergeNotes(base: NoteForm, mine: NoteForm, theirs: NoteForm, choices: Partial<Record<MergeKey, Choice>> = {}): MergeResult {
  const merged: NoteForm = { ...mine };
  const out: MergeResult = { merged, fromTheirs: [], keptMine: [], chosen: [], unresolved: [] };
  for (const k of MERGE_KEYS) {
    const b = valueOf(base, k);
    const m = valueOf(mine, k);
    const t = valueOf(theirs, k);
    if (m === t) continue; // identical (including "both made the same edit"): nothing to decide or report
    if (m === b) { copySection(merged, theirs, k); out.fromTheirs.push(k); continue; }
    if (t === b) { out.keptMine.push(k); continue; }
    const c = choices[k];
    if (!c) { out.unresolved.push(k); continue; }
    if (c === "theirs") copySection(merged, theirs, k);
    out.chosen.push(k);
  }
  return out;
}

/** The sections where the form differs from the server's note — what "load the saved version" would discard. */
export function differingSections(mine: NoteForm, theirs: NoteForm): MergeKey[] {
  return MERGE_KEYS.filter((k) => valueOf(mine, k) !== valueOf(theirs, k));
}

/** A human-readable value of a section, for the side-by-side choice (labels, not raw enum values). */
export function describeSection(f: NoteForm, k: MergeKey, labels: { session: (v: string) => string; risk: (v: RiskLevel) => string }): string {
  switch (k) {
    case "risk": {
      const head = labels.risk(f.riskLevel);
      return f.riskLevel !== "none" && f.riskNotes.trim() ? `${head}\n${f.riskNotes}` : head;
    }
    case "durationMinutes": return f.durationMinutes === "" ? "Sem duração" : `${f.durationMinutes} min`;
    case "sessionType": return labels.session(f.sessionType);
    default: return f[k].trim() ? f[k] : "(vazio)";
  }
}
