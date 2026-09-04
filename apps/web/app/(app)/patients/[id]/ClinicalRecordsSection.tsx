"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { ClipboardList, Plus, Pill, Send, Lock } from "lucide-react";
import type { ClinicalNoteEntry, PrescriptionEntry, ReferralEntry, RiskLevel } from "@cap/types";
import { Modal } from "@/components/ui/modal";
import { useMessage } from "@/components/ui/message-handler";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";

const RISK_META: Record<RiskLevel, { label: string; cls: string }> = {
  none:     { label: "Sem risco identificado", cls: "bg-dim-100 text-dim-500" },
  low:      { label: "Risco baixo",            cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  moderate: { label: "Risco moderado",         cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  high:     { label: "Risco elevado",          cls: "bg-red-50 text-red-700 ring-1 ring-red-200/80" },
};

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-dim-700">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro ao carregar");
  return res.json();
}

async function postJson(url: string, data: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json(); throw new Error(Array.isArray(e.message) ? e.message.map((m: { message: string }) => m.message).join(", ") : e.message ?? "Erro"); }
  return res.json();
}

const EMPTY_NOTE_FORM = { sessionType: "individual", durationMinutes: 50, presentingConcerns: "", observations: "", assessment: "", plan: "", riskLevel: "none" as RiskLevel, riskNotes: "" };

export function ClinicalRecordsSection({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [tab, setTab] = useState<"notes" | "prescriptions" | "referrals">("notes");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [viewingNoteId, setViewingNoteId] = useState<string | null>(null);
  const [noteForm, setNoteForm] = useState(EMPTY_NOTE_FORM);

  const notesQ = useQuery({
    queryKey: ["clinical-notes", patientId],
    queryFn: () => fetchJson<ClinicalNoteEntry[]>(`/api/patients/${patientId}/clinical-notes`),
  });
  const prescriptionsQ = useQuery({
    queryKey: ["prescriptions", patientId],
    queryFn: () => fetchJson<PrescriptionEntry[]>(`/api/patients/${patientId}/prescriptions`),
    enabled: tab === "prescriptions",
  });
  const referralsQ = useQuery({
    queryKey: ["referrals", patientId],
    queryFn: () => fetchJson<ReferralEntry[]>(`/api/patients/${patientId}/referrals`),
    enabled: tab === "referrals",
  });

  const createNote = useMutation({
    mutationFn: () => postJson(`/api/patients/${patientId}/clinical-notes`, noteForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinical-notes", patientId] });
      addMessage("Success", "Nota clínica criada.");
      setNoteForm(EMPTY_NOTE_FORM);
      setNewNoteOpen(false);
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  const notes = notesQ.data ?? [];
  const viewingNote = notes.find((n) => n.id === viewingNoteId);

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-dim-100">
        <div className="flex items-center gap-1.5 bg-dim-100 rounded-[10px] p-1">
          {([
            ["notes", "Notas Clínicas", ClipboardList],
            ["prescriptions", "Prescrições", Pill],
            ["referrals", "Referenciações", Send],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${tab === key ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {tab === "notes" && (
          <button
            onClick={() => setNewNoteOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nova Nota
          </button>
        )}
      </div>

      <div className="px-6 py-5">
        {tab === "notes" && (
          notesQ.isLoading ? (
            <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
          ) : notes.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Ainda sem notas clínicas — apenas as suas notas aparecem aqui, salvo se for administrador.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((n) => {
                const locked = Date.now() - new Date(n.createdAt).getTime() > EDIT_WINDOW_MS;
                return (
                  <button
                    key={n.id}
                    onClick={() => setViewingNoteId(n.id)}
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-[10px] border border-dim-100 hover:border-brand-300 hover:bg-dim-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-dim-900 capitalize truncate">{n.sessionType} {locked && <Lock className="inline w-3 h-3 text-dim-400 ml-1" />}</p>
                      <p className="text-[11px] text-dim-500 mt-0.5">{n.author?.fullName ?? "—"} · {format(new Date(n.createdAt), "d MMM yyyy, HH:mm", { locale: pt })}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${RISK_META[n.riskLevel].cls}`}>{RISK_META[n.riskLevel].label}</span>
                  </button>
                );
              })}
            </div>
          )
        )}

        {tab === "prescriptions" && (
          <PrescriptionsTab patientId={patientId} data={prescriptionsQ.data} isLoading={prescriptionsQ.isLoading} />
        )}

        {tab === "referrals" && (
          <ReferralsTab patientId={patientId} data={referralsQ.data} isLoading={referralsQ.isLoading} />
        )}
      </div>

      {/* New note modal */}
      <Modal open={newNoteOpen} onClose={() => setNewNoteOpen(false)} title="Nova Nota Clínica" size="lg">
        <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo de Sessão">
              <select value={noteForm.sessionType} onChange={(e) => setNoteForm((f) => ({ ...f, sessionType: e.target.value }))} className={inputCls}>
                <option value="individual">Individual</option>
                <option value="couples">Casal</option>
                <option value="group">Grupo</option>
                <option value="initial_assessment">Avaliação Inicial</option>
              </select>
            </Field>
            <Field label="Duração (minutos)">
              <input type="number" value={noteForm.durationMinutes} onChange={(e) => setNoteForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))} className={inputCls} />
            </Field>
          </div>
          <Field label="Motivo / Estado Apresentado" required>
            <textarea rows={3} value={noteForm.presentingConcerns} onChange={(e) => setNoteForm((f) => ({ ...f, presentingConcerns: e.target.value }))} className={inputCls} placeholder="O que o paciente relatou nesta sessão…" />
          </Field>
          <Field label="Observações" required>
            <textarea rows={3} value={noteForm.observations} onChange={(e) => setNoteForm((f) => ({ ...f, observations: e.target.value }))} className={inputCls} placeholder="Observações clínicas — afeto, comportamento, apresentação…" />
          </Field>
          <Field label="Avaliação" required>
            <textarea rows={3} value={noteForm.assessment} onChange={(e) => setNoteForm((f) => ({ ...f, assessment: e.target.value }))} className={inputCls} placeholder="Impressão clínica, progresso face aos objetivos…" />
          </Field>
          <Field label="Plano" required>
            <textarea rows={3} value={noteForm.plan} onChange={(e) => setNoteForm((f) => ({ ...f, plan: e.target.value }))} className={inputCls} placeholder="Intervenções planeadas, foco da próxima sessão…" />
          </Field>
          <Field label="Nível de Risco">
            <select value={noteForm.riskLevel} onChange={(e) => setNoteForm((f) => ({ ...f, riskLevel: e.target.value as RiskLevel }))} className={inputCls}>
              <option value="none">Sem risco identificado</option>
              <option value="low">Risco baixo</option>
              <option value="moderate">Risco moderado</option>
              <option value="high">Risco elevado</option>
            </select>
          </Field>
          {noteForm.riskLevel !== "none" && (
            <Field label="Detalhe do Risco" required>
              <textarea rows={2} value={noteForm.riskNotes} onChange={(e) => setNoteForm((f) => ({ ...f, riskNotes: e.target.value }))} className={inputCls} placeholder="Descreva o risco identificado e as medidas tomadas…" />
            </Field>
          )}
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button
            onClick={() => createNote.mutate()}
            disabled={createNote.isPending}
            className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors"
          >
            {createNote.isPending ? "A guardar…" : "Guardar Nota"}
          </button>
          <button onClick={() => setNewNoteOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Cancelar
          </button>
        </div>
      </Modal>

      {/* View note modal */}
      <Modal open={!!viewingNote} onClose={() => setViewingNoteId(null)} title={viewingNote ? `Nota — ${format(new Date(viewingNote.createdAt), "d MMM yyyy", { locale: pt })}` : ""} size="lg">
        {viewingNote && (
          <div className="px-6 py-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
            <span className={`self-start text-[10px] font-semibold px-2 py-0.5 rounded-full ${RISK_META[viewingNote.riskLevel].cls}`}>{RISK_META[viewingNote.riskLevel].label}</span>
            {viewingNote.riskNotes && <p className="text-[12px] text-dim-700 bg-dim-50 rounded-[10px] px-3.5 py-2.5">{viewingNote.riskNotes}</p>}
            {([
              ["Motivo / Estado Apresentado", viewingNote.presentingConcerns],
              ["Observações", viewingNote.observations],
              ["Avaliação", viewingNote.assessment],
              ["Plano", viewingNote.plan],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400 mb-1">{label}</dt>
                <dd className="text-[13px] text-dim-800 whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
            <p className="text-[11px] text-dim-400 pt-2 border-t border-dim-100">
              {viewingNote.author?.fullName ?? "—"} · {viewingNote.sessionType} · {viewingNote.durationMinutes ?? "—"} min
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrescriptionsTab({ patientId, data, isLoading }: { patientId: string; data?: PrescriptionEntry[]; isLoading: boolean }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [open, setOpen] = useState(false);
  const [drugName, setDrugName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");

  const create = useMutation({
    mutationFn: () => postJson(`/api/patients/${patientId}/prescriptions`, { items: [{ drugName, dosage, frequency }] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prescriptions", patientId] });
      addMessage("Success", "Prescrição criada.");
      setDrugName(""); setDosage(""); setFrequency(""); setOpen(false);
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => setOpen(true)} className="self-end flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors">
        <Plus className="w-3.5 h-3.5" /> Nova Prescrição
      </button>
      {isLoading ? (
        <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
      ) : !data?.length ? (
        <p className="text-[13px] text-dim-400 text-center py-6">Sem prescrições registadas.</p>
      ) : (
        data.map((rx) => (
          <div key={rx.id} className="px-4 py-3 rounded-[10px] border border-dim-100">
            <p className="text-[11px] text-dim-500 mb-1.5">{rx.prescribedBy?.fullName ?? "—"} · {format(new Date(rx.issuedAt), "d MMM yyyy", { locale: pt })}</p>
            {rx.items.map((it) => (
              <p key={it.id} className="text-[13px] text-dim-900"><span className="font-semibold">{it.drugName}</span> — {it.dosage}, {it.frequency}</p>
            ))}
          </div>
        ))
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nova Prescrição" size="md">
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Medicamento" required><input value={drugName} onChange={(e) => setDrugName(e.target.value)} className={inputCls} /></Field>
          <Field label="Dosagem" required><input value={dosage} onChange={(e) => setDosage(e.target.value)} className={inputCls} placeholder="Ex: 20mg" /></Field>
          <Field label="Frequência" required><input value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputCls} placeholder="Ex: 1x ao dia" /></Field>
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button onClick={() => create.mutate()} disabled={create.isPending || !drugName || !dosage || !frequency} className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors">
            {create.isPending ? "A guardar…" : "Criar Prescrição"}
          </button>
          <button onClick={() => setOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">Cancelar</button>
        </div>
      </Modal>
    </div>
  );
}

const REFERRAL_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pendente",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  scheduled: { label: "Agendada",  cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80" },
  completed: { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  declined:  { label: "Recusada",  cls: "bg-dim-100 text-dim-500" },
};

function ReferralsTab({ patientId, data, isLoading }: { patientId: string; data?: ReferralEntry[]; isLoading: boolean }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"internal" | "external">("external");
  const [externalProviderName, setExternalProviderName] = useState("");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () => postJson(`/api/patients/${patientId}/referrals`, { type, externalProviderName, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referrals", patientId] });
      addMessage("Success", "Referenciação criada.");
      setExternalProviderName(""); setReason(""); setOpen(false);
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => setOpen(true)} className="self-end flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors">
        <Plus className="w-3.5 h-3.5" /> Nova Referenciação
      </button>
      {isLoading ? (
        <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
      ) : !data?.length ? (
        <p className="text-[13px] text-dim-400 text-center py-6">Sem referenciações registadas.</p>
      ) : (
        data.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-[10px] border border-dim-100">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-dim-900 truncate">{r.type === "internal" ? r.targetStaff?.fullName ?? "—" : r.externalProviderName}</p>
              <p className="text-[11px] text-dim-500 mt-0.5 truncate">{r.reason}</p>
            </div>
            <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${REFERRAL_STATUS_META[r.status]?.cls ?? ""}`}>{REFERRAL_STATUS_META[r.status]?.label ?? r.status}</span>
          </div>
        ))
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nova Referenciação" size="md">
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Tipo">
            <select value={type} onChange={(e) => setType(e.target.value as "internal" | "external")} className={inputCls}>
              <option value="external">Externa (outro prestador)</option>
              <option value="internal">Interna (colega CAP)</option>
            </select>
          </Field>
          {type === "external" && (
            <Field label="Prestador Externo" required><input value={externalProviderName} onChange={(e) => setExternalProviderName(e.target.value)} className={inputCls} placeholder="Nome do médico/clínica" /></Field>
          )}
          <Field label="Motivo" required><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button onClick={() => create.mutate()} disabled={create.isPending || !reason || (type === "external" && !externalProviderName)} className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors">
            {create.isPending ? "A guardar…" : "Criar Referenciação"}
          </button>
          <button onClick={() => setOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">Cancelar</button>
        </div>
      </Modal>
    </div>
  );
}
