"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";
import type { ClinicalNoteEntry, PrescriptionEntry } from "@cap/types";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useMessage } from "@/components/ui/message-handler";
import { sendJson } from "../../records/_note-shared";
import { ListState, NoteLink, type PagedList, NoteLinkSelect, btnNew, btnPrimary, btnSecondary, inputCls, inputErrCls } from "./_clinical-forms";

const MAX_ITEMS = 50; // the API's limit per prescription

type ItemDraft = { key: number; drugName: string; dosage: string; frequency: string; durationDays: string; instructions: string };
type ItemErrors = Partial<Record<"drugName" | "dosage" | "frequency" | "durationDays", string>>;
const emptyItem = (key: number): ItemDraft => ({ key, drugName: "", dosage: "", frequency: "", durationDays: "", instructions: "" });

/** Same bounds as CreatePrescriptionSchema (packages/types): the messages say it in the doctor's language, before the API has to. */
function validateItem(it: ItemDraft): ItemErrors {
  const e: ItemErrors = {};
  if (!it.drugName.trim()) e.drugName = "Indique o medicamento.";
  if (!it.dosage.trim()) e.dosage = "Indique a dosagem.";
  if (!it.frequency.trim()) e.frequency = "Indique a frequência.";
  if (it.durationDays.trim()) {
    const n = Number(it.durationDays);
    if (!Number.isInteger(n) || n < 1 || n > 3650) e.durationDays = "Use um número inteiro de dias, entre 1 e 3650.";
  }
  return e;
}

export function PrescriptionsTab({ patientId, query, notes, linkable, formOpen, presetNoteId, onOpenForm, onCloseForm }: {
  patientId: string;
  query: PagedList<PrescriptionEntry>;
  notes: ClinicalNoteEntry[];
  linkable: ClinicalNoteEntry[];
  formOpen: boolean;
  presetNoteId: string | null;
  onOpenForm: () => void;
  onCloseForm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onOpenForm} className={btnNew}>
        <Plus className="w-3.5 h-3.5" aria-hidden /> Nova Prescrição
      </button>
      <ListState query={query} empty="Sem prescrições registadas.">
        {query.data?.map((rx) => (
          <article key={rx.id} className="px-4 py-3 rounded-[10px] border border-dim-100" aria-label={`Prescrição de ${format(new Date(rx.issuedAt), "d MMM yyyy", { locale: pt })}`}>
            <p className="text-[11px] text-dim-500 mb-1.5">
              {rx.prescribedBy?.fullName ?? "—"} · {format(new Date(rx.issuedAt), "d MMM yyyy", { locale: pt })}
              {rx.clinicalNoteId && <> · <NoteLink noteId={rx.clinicalNoteId} notes={notes} patientId={patientId} /></>}
            </p>
            <ul className="flex flex-col gap-1">
              {rx.items.map((it) => (
                <li key={it.id} className="text-[13px] text-dim-900">
                  <span className="font-semibold">{it.drugName}</span> — {it.dosage}, {it.frequency}
                  {it.durationDays != null && <span className="text-dim-600"> · durante {it.durationDays} {it.durationDays === 1 ? "dia" : "dias"}</span>}
                  {it.instructions && <span className="block text-[12px] text-dim-600 whitespace-pre-wrap">{it.instructions}</span>}
                </li>
              ))}
            </ul>
            {rx.notes && <p className="text-[12px] text-dim-600 mt-2 whitespace-pre-wrap">{rx.notes}</p>}
          </article>
        ))}
      </ListState>
      {formOpen && <PrescriptionModal patientId={patientId} linkable={linkable} presetNoteId={presetNoteId} onClose={onCloseForm} />}
    </div>
  );
}

function PrescriptionModal({ patientId, linkable, presetNoteId, onClose }: {
  patientId: string; linkable: ClinicalNoteEntry[]; presetNoteId: string | null; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const nextKey = useRef(1);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem(0)]);
  const [errors, setErrors] = useState<Record<number, ItemErrors>>({});
  const [noteId, setNoteId] = useState(presetNoteId && linkable.some((n) => n.id === presetNoteId) ? presetNoteId : "");
  const [notesText, setNotesText] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [failTick, setFailTick] = useState(0);

  const dirty = notesText.trim() !== "" || items.some((i) => i.drugName || i.dosage || i.frequency || i.durationDays || i.instructions);

  const create = useMutation({
    mutationFn: () =>
      sendJson(`/api/patients/${patientId}/prescriptions`, "POST", {
        ...(noteId && { clinicalNoteId: noteId }),
        ...(notesText.trim() && { notes: notesText.trim() }),
        items: items.map((i) => ({
          drugName: i.drugName.trim(),
          dosage: i.dosage.trim(),
          frequency: i.frequency.trim(),
          ...(i.durationDays.trim() && { durationDays: Number(i.durationDays) }),
          ...(i.instructions.trim() && { instructions: i.instructions.trim() }),
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prescriptions", patientId] });
      addMessage("Success", "Prescrição criada.");
      onClose();
    },
    onError: (err: Error) => setServerError(err.message),
  });

  // After a failed submit, put the keyboard on the first field that needs attention.
  useEffect(() => {
    if (failTick) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [failTick]);

  const setItem = (key: number, patch: Partial<ItemDraft>) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setErrors((e) => (e[key] ? { ...e, [key]: Object.fromEntries(Object.entries(e[key]).filter(([f]) => !(f in patch))) } : e));
  };

  function submit() {
    if (create.isPending) return;
    setServerError(null);
    const found = Object.fromEntries(items.map((i) => [i.key, validateItem(i)]));
    setErrors(found);
    if (Object.values(found).some((e) => Object.keys(e).length)) { setFailTick((t) => t + 1); return; }
    create.mutate();
  }
  const close = () => {
    if (create.isPending) return;
    if (dirty && !window.confirm("Descartar a prescrição que está a escrever?")) return;
    onClose();
  };

  return (
    <Modal open onClose={close} dismissOnBackdrop={false} title="Nova Prescrição" size="lg">
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <div ref={bodyRef} className="px-6 py-5 flex flex-col gap-5">
          {items.map((it, idx) => {
            const err = errors[it.key] ?? {};
            return (
              <fieldset key={it.key} className="flex flex-col gap-3 min-w-0 rounded-[12px] border border-dim-100 p-4">
                <legend className="px-1 text-[12px] font-bold text-dim-700">Medicamento {idx + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <Field label="Medicamento" required error={err.drugName}>
                      <input value={it.drugName} maxLength={150} aria-invalid={!!err.drugName} onChange={(e) => setItem(it.key, { drugName: e.target.value })} className={`${inputCls} ${err.drugName ? inputErrCls : ""}`} />
                    </Field>
                  </div>
                  <Field label="Dosagem" required error={err.dosage}>
                    <input value={it.dosage} maxLength={100} placeholder="Ex: 20mg" aria-invalid={!!err.dosage} onChange={(e) => setItem(it.key, { dosage: e.target.value })} className={`${inputCls} ${err.dosage ? inputErrCls : ""}`} />
                  </Field>
                  <Field label="Frequência" required error={err.frequency}>
                    <input value={it.frequency} maxLength={100} placeholder="Ex: 1x ao dia" aria-invalid={!!err.frequency} onChange={(e) => setItem(it.key, { frequency: e.target.value })} className={`${inputCls} ${err.frequency ? inputErrCls : ""}`} />
                  </Field>
                  <Field label="Duração (dias)" hint="Opcional" error={err.durationDays}>
                    <input value={it.durationDays} inputMode="numeric" placeholder="Ex: 30" aria-invalid={!!err.durationDays} onChange={(e) => setItem(it.key, { durationDays: e.target.value })} className={`${inputCls} ${err.durationDays ? inputErrCls : ""}`} />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Instruções" hint="Opcional">
                      <input value={it.instructions} maxLength={300} placeholder="Ex: Tomar à noite, com água" onChange={(e) => setItem(it.key, { instructions: e.target.value })} className={inputCls} />
                    </Field>
                  </div>
                </div>
                {items.length > 1 && (
                  <button
                    type="button" onClick={() => setItems((all) => all.filter((i) => i.key !== it.key))}
                    className="self-start inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden /> Remover medicamento {idx + 1}
                  </button>
                )}
              </fieldset>
            );
          })}

          <button
            type="button" disabled={items.length >= MAX_ITEMS}
            onClick={() => { const key = nextKey.current++; setItems((all) => [...all, emptyItem(key)]); }}
            className="self-start inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> {items.length >= MAX_ITEMS ? `Máximo de ${MAX_ITEMS} medicamentos` : "Adicionar medicamento"}
          </button>

          <NoteLinkSelect notes={linkable} value={noteId} onChange={setNoteId} />
          <Field label="Observações" hint="Opcional">
            <textarea rows={2} value={notesText} maxLength={500} onChange={(e) => setNotesText(e.target.value)} className={inputCls} />
          </Field>
          {serverError && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">Não foi possível criar a prescrição: {serverError}</p>}
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button type="submit" disabled={create.isPending} className={btnPrimary}>
            {create.isPending ? "A guardar…" : "Criar Prescrição"}
          </button>
          <button type="button" onClick={close} disabled={create.isPending} className={btnSecondary}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
