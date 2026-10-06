"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, GitMerge, X } from "lucide-react";
import type { ClinicalNoteEntry } from "@cap/types";
import { Modal } from "@/components/ui/modal";
import { RISK_META, sessionTypeLabel } from "./_note-shared";
import {
  MERGE_LABEL, describeSection, formFromNote, mergeNotes,
  type Choice, type MergeKey, type NoteForm,
} from "./_note-merge";

/** What the page remembers about a lost save: the note the server holds now and the tab's last synced copy. */
export type NoteConflict = { note: ClinicalNoteEntry; base: NoteForm };

/** What happened when the conflict was resolved — shown for a moment so nothing changes on screen silently. */
export type MergeNotice = {
  fromTheirs: MergeKey[];
  keptMine: MergeKey[];
  chosen: MergeKey[];
  /** The other tab finalized the note and nothing here was unsaved: the saved version was simply loaded. */
  loadedFinal?: boolean;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const names = (keys: MergeKey[]) => keys.map((k) => MERGE_LABEL[k]).join(", ");
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-CV", { timeZone: "Atlantic/Cape_Verde", hour: "2-digit", minute: "2-digit" });
const labels = { session: sessionTypeLabel, risk: (v: keyof typeof RISK_META) => RISK_META[v].label };

/**
 * The lost-save resolver. Sections that only one side changed are joined without asking; sections both sides
 * changed differently are shown side by side with an explicit choice each. A note the other tab already
 * finalized can only be loaded (never merged into), and what the doctor typed here is shown first so it can be copied.
 */
export function ConflictResolver({ conflict, form, localIsFinal, onResolve }: {
  conflict: NoteConflict;
  form: NoteForm;
  localIsFinal: boolean;
  onResolve: (note: ClinicalNoteEntry, merged: NoteForm, notice: MergeNotice) => void;
}) {
  const { note, base } = conflict;
  const theirs = useMemo(() => formFromNote(note), [note]);
  const remoteFinalized = !!note.finalizedAt && !localIsFinal;
  const [choices, setChoices] = useState<Partial<Record<MergeKey, Choice>>>({});
  const [modalOpen, setModalOpen] = useState(true);
  // Two views of the same merge: `raw` (no choices yet) decides whether anything has to be asked at all; `result` adds
  // the doctor's choices and is what "Aplicar" applies. (Resolving off `result` would apply the moment the last radio is clicked.)
  const raw = useMemo(() => mergeNotes(base, form, theirs), [base, form, theirs]);
  const result = useMemo(() => mergeNotes(base, form, theirs, choices), [base, form, theirs, choices]);
  // What loading the saved version would throw away: my edits that the server does not have.
  const lost = useMemo(() => [...raw.keptMine, ...raw.unresolved], [raw]);

  // Nothing to decide → resolve at once. (Once: a Strict-Mode double effect must not apply it twice.)
  const done = useRef(false);
  const loadBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done.current) return;
    if (remoteFinalized) {
      if (lost.length === 0) { done.current = true; onResolve(note, theirs, { fromTheirs: [], keptMine: [], chosen: [], loadedFinal: true }); }
    } else if (raw.unresolved.length === 0) {
      done.current = true;
      onResolve(note, raw.merged, { fromTheirs: raw.fromTheirs, keptMine: raw.keptMine, chosen: [] });
    }
  }, [remoteFinalized, lost.length, raw, note, theirs, onResolve]);
  // The alert asks for a decision: put the keyboard on its one action, once (not again on every keystroke).
  useEffect(() => { loadBtn.current?.focus(); }, []);

  const when = timeOf(note.updatedAt);
  const apply = () => {
    done.current = true;
    onResolve(note, result.merged, { fromTheirs: result.fromTheirs, keptMine: result.keptMine, chosen: result.chosen });
  };

  if (remoteFinalized) {
    if (lost.length === 0) return null; // resolving on its own (effect above)
    const loadSaved = () => { done.current = true; onResolve(note, theirs, { fromTheirs: [], keptMine: [], chosen: [] }); };
    return (
      <div role="alert" className="rounded-[14px] border border-amber-200 bg-amber-50 px-5 py-3.5 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-amber-900">Esta nota foi finalizada noutro separador ou dispositivo ({when}).</p>
            <p className="text-[12px] text-dim-700 mt-0.5">
              Uma nota finalizada não pode ser juntada com o rascunho daqui: carregue a versão guardada. O que escreveu aqui ainda não foi guardado e será substituído — copie-o antes, se precisar.
            </p>
          </div>
        </div>
        <details className="pl-6 text-[12px] text-dim-700">
          <summary className="cursor-pointer font-semibold text-amber-900">O que escreveu aqui ({names(lost)})</summary>
          <dl className="mt-2 flex flex-col gap-2">
            {lost.map((k) => (
              <div key={k}>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-500">{MERGE_LABEL[k]}</dt>
                <dd className="whitespace-pre-wrap rounded-[8px] bg-white border border-amber-100 px-3 py-2 select-text">{describeSection(form, k, labels)}</dd>
              </div>
            ))}
          </dl>
        </details>
        <div className="pl-6">
          <button ref={loadBtn} type="button" onClick={loadSaved} className="text-[12px] font-semibold px-3.5 py-2 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white transition-colors">
            Carregar a versão guardada
          </button>
        </div>
      </div>
    );
  }

  if (raw.unresolved.length === 0) return null; // joined without asking (effect above)

  const pending = raw.unresolved;
  const autoCount = raw.fromTheirs.length + raw.keptMine.length;
  const setAll = (c: Choice) => setChoices(Object.fromEntries(pending.map((k) => [k, c])));
  const missing = pending.filter((k) => !choices[k]);

  return (
    <>
      <div role="alert" className="rounded-[14px] border border-amber-200 bg-amber-50 px-5 py-3.5 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-amber-900">Esta nota foi alterada noutro separador ou dispositivo ({when}).</p>
            <p className="text-[12px] text-dim-700 mt-0.5">
              {pending.length} {plural(pending.length, "secção mudou", "secções mudaram")} nas duas versões ({names(pending)}) — escolha qual manter. O que escreveu aqui ainda não foi guardado.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white transition-colors shrink-0">
          <GitMerge className="w-3.5 h-3.5" aria-hidden /> Juntar versões
        </button>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        role="alertdialog"
        size="xl"
        title="Juntar as duas versões da nota"
        description={`A nota foi guardada noutro separador às ${when}. O que não se sobrepõe junta-se sozinho; nas secções abaixo as duas versões mudaram — escolha uma para cada.`}
      >
        <div className="px-6 py-5 flex flex-col gap-5">
          {autoCount > 0 && (
            <p className="text-[12px] text-dim-600 bg-dim-50 rounded-[10px] px-3.5 py-2.5">
              {autoCount} {plural(autoCount, "secção juntada", "secções juntadas")} automaticamente
              {raw.fromTheirs.length > 0 && <> · da versão guardada: {names(raw.fromTheirs)}</>}
              {raw.keptMine.length > 0 && <> · mantidas as suas: {names(raw.keptMine)}</>}
            </p>
          )}
          {pending.map((k) => {
            const opts: { value: Choice; title: string; text: string }[] = [
              { value: "mine", title: "A minha versão (este separador)", text: describeSection(form, k, labels) },
              { value: "theirs", title: `Versão guardada às ${when} (outro separador)`, text: describeSection(theirs, k, labels) },
            ];
            return (
              <fieldset key={k} className="min-w-0">
                <legend className="text-[13px] font-semibold text-dim-900 mb-2">{MERGE_LABEL[k]}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {opts.map((o) => {
                    const on = choices[k] === o.value;
                    return (
                      <label
                        key={o.value}
                        className={`flex flex-col gap-2 rounded-[12px] border px-4 py-3 cursor-pointer transition-colors min-w-0 ${on ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20" : "border-dim-200 bg-white hover:bg-dim-50"}`}
                      >
                        <span className="flex items-center gap-2 text-[12px] font-semibold text-dim-800">
                          <input
                            type="radio" name={`merge-${k}`} value={o.value} checked={on}
                            onChange={() => setChoices((c) => ({ ...c, [k]: o.value }))}
                            className="accent-brand-700"
                          />
                          {o.title}
                        </span>
                        <span className="whitespace-pre-wrap break-words text-[13px] text-dim-800">{o.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex flex-wrap items-center gap-3">
          <button
            type="button" onClick={apply} disabled={missing.length > 0}
            className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-50 transition-colors"
          >
            Aplicar escolhas
          </button>
          <button type="button" onClick={() => setModalOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Decidir depois
          </button>
          {pending.length > 1 && (
            <span className="flex gap-2 sm:ml-auto">
              <button type="button" onClick={() => setAll("mine")} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800">Escolher a minha em todas</button>
              <button type="button" onClick={() => setAll("theirs")} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800">Escolher a guardada em todas</button>
            </span>
          )}
          {missing.length > 0 && <p className="basis-full text-[11px] text-dim-500">Falta escolher: {names(missing)}.</p>}
        </div>
      </Modal>
    </>
  );
}

/** The short, visible summary of what a resolution did (a polite live region: it is announced, never grabs focus). */
export function MergeNoticeBanner({ notice, draft, onDismiss }: { notice: MergeNotice; draft: boolean; onDismiss: () => void }) {
  const auto = notice.fromTheirs.length + notice.keptMine.length;
  const parts: string[] = [];
  if (notice.loadedFinal) parts.push("A nota foi finalizada noutro separador: carregámos a versão guardada.");
  if (auto > 0) {
    parts.push(`${auto} ${plural(auto, "secção juntada", "secções juntadas")} automaticamente`);
    const detail = [
      notice.fromTheirs.length > 0 && `da versão guardada: ${names(notice.fromTheirs)}`,
      notice.keptMine.length > 0 && `mantidas as suas: ${names(notice.keptMine)}`,
    ].filter(Boolean).join("; ");
    if (detail) parts[parts.length - 1] += ` (${detail})`;
    parts[parts.length - 1] += ".";
  }
  if (notice.chosen.length > 0) parts.push(`Escolhidas por si: ${names(notice.chosen)}.`);
  if (parts.length === 0) parts.push("A versão guardada noutro separador foi carregada.");
  return (
    <div role="status" className="rounded-[14px] border border-brand-200 bg-brand-50 px-5 py-3 flex items-start gap-2">
      <GitMerge className="w-4 h-4 mt-0.5 shrink-0 text-brand-700" aria-hidden />
      <p className="flex-1 min-w-0 text-[12px] text-brand-900">
        {parts.join(" ")}
        {/* Only when something of the doctor's is still unsaved: a plain "load the saved version" leaves nothing to keep. */}
        {(auto > 0 || notice.chosen.length > 0) && (draft ? " O rascunho volta a ser guardado automaticamente." : " Guarde as alterações para as manter.")}
      </p>
      <button type="button" onClick={onDismiss} aria-label="Fechar aviso" className="shrink-0 text-brand-700 hover:text-brand-900">
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );
}
