"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus } from "lucide-react";
import { REFERRAL_STATUS_TRANSITIONS, type ClinicalNoteEntry, type ReferralEntry } from "@cap/types";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useMessage } from "@/components/ui/message-handler";
import { HttpError, sendJson } from "../../records/_note-shared";
import { useStaffList } from "../../records/_staff-list";
import { ListState, NoteLink, type PagedList, NoteLinkSelect, btnNew, btnPrimary, btnSecondary, inputCls, inputErrCls } from "./_clinical-forms";

type Status = ReferralEntry["status"];

export const REFERRAL_STATUS_META: Record<Status, { label: string; cls: string }> = {
  pending:   { label: "Pendente",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  scheduled: { label: "Agendada",  cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80" },
  completed: { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  declined:  { label: "Recusada",  cls: "bg-dim-100 text-dim-500" },
};

/** The button for moving a referral to `to`, worded for where it is coming from. */
const ACTION_LABEL = (from: Status, to: Status) =>
  to === "pending" ? (from === "scheduled" ? "Desfazer agendamento" : "Reabrir como pendente")
  : to === "scheduled" ? "Marcar como agendada"
  : to === "completed" ? "Marcar como concluída"
  : "Marcar como recusada";

/** The moves the API allows (REFERRAL_STATUS_TRANSITIONS, enforced in the service); an admin may correct any status. */
const nextStatuses = (from: Status, admin: boolean): Status[] =>
  admin ? (Object.keys(REFERRAL_STATUS_META) as Status[]).filter((s) => s !== from) : REFERRAL_STATUS_TRANSITIONS[from];

export function ReferralsTab({ patientId, query, notes, linkable, meId, isAdmin, formOpen, presetNoteId, onOpenForm, onCloseForm }: {
  patientId: string;
  query: PagedList<ReferralEntry>;
  notes: ClinicalNoteEntry[];
  linkable: ClinicalNoteEntry[];
  meId?: string;
  isAdmin: boolean;
  formOpen: boolean;
  presetNoteId: string | null;
  onOpenForm: () => void;
  onCloseForm: () => void;
}) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => sendJson(`/api/referrals/${id}/status`, "PATCH", { status }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["referrals", patientId] });
      addMessage("Success", `Referenciação marcada como ${REFERRAL_STATUS_META[v.status].label.toLowerCase()}.`);
    },
    onError: (err: Error) => {
      // Someone else moved it first (409): say so and show it as it is now.
      queryClient.invalidateQueries({ queryKey: ["referrals", patientId] });
      addMessage("Error", err instanceof HttpError && err.status === 409
        ? "Esta referenciação foi alterada por outra pessoa — a lista foi atualizada."
        : `Não foi possível atualizar a referenciação: ${err.message}`);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onOpenForm} className={btnNew}>
        <Plus className="w-3.5 h-3.5" aria-hidden /> Nova Referenciação
      </button>
      <ListState query={query} empty="Sem referenciações registadas.">
        {query.data?.map((r) => {
          const meta = REFERRAL_STATUS_META[r.status];
          // The referrer, the clinician it was sent to, and an admin may move it forward.
          const canAct = isAdmin || (!!meId && (r.referredByStaffId === meId || r.targetStaffId === meId));
          const actions = canAct ? nextStatuses(r.status, isAdmin) : [];
          const target = r.type === "internal" ? r.targetStaff?.fullName ?? "Clínico removido" : r.externalProviderName;
          return (
            <article key={r.id} className="px-4 py-3 rounded-[10px] border border-dim-100 flex flex-col gap-2" aria-label={`Referenciação para ${target}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-dim-900 break-words">
                    {target}
                    <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-dim-100 text-dim-600 align-middle">{r.type === "internal" ? "Interna" : "Externa"}</span>
                  </p>
                  {r.type === "external" && r.externalSpecialty && <p className="text-[11px] text-dim-500 mt-0.5">{r.externalSpecialty}</p>}
                </div>
                <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta?.cls ?? ""}`}>{meta?.label ?? r.status}</span>
              </div>
              <p className="text-[12px] text-dim-700 whitespace-pre-wrap break-words">{r.reason}</p>
              <p className="text-[11px] text-dim-500">
                {r.referredBy?.fullName ?? "—"} · {format(new Date(r.createdAt), "d MMM yyyy", { locale: pt })}
                {r.clinicalNoteId && <> · <NoteLink noteId={r.clinicalNoteId} notes={notes} patientId={patientId} /></>}
              </p>
              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {actions.map((to) => {
                    const busy = setStatus.isPending && setStatus.variables?.id === r.id && setStatus.variables.status === to;
                    return (
                      <button
                        key={to} type="button" disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: r.id, status: to })}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-[8px] border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 disabled:opacity-50 transition-colors"
                      >
                        {busy ? "A atualizar…" : ACTION_LABEL(r.status, to)}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </ListState>
      {formOpen && <ReferralModal patientId={patientId} linkable={linkable} presetNoteId={presetNoteId} meId={meId} onClose={onCloseForm} />}
    </div>
  );
}

type Errors = Partial<Record<"target" | "provider" | "reason", string>>;

function ReferralModal({ patientId, linkable, presetNoteId, meId, onClose }: {
  patientId: string; linkable: ClinicalNoteEntry[]; presetNoteId: string | null; meId?: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [type, setType] = useState<"internal" | "external">("external");
  const [targetStaffId, setTargetStaffId] = useState("");
  const [provider, setProvider] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [reason, setReason] = useState("");
  const [noteId, setNoteId] = useState(presetNoteId && linkable.some((n) => n.id === presetNoteId) ? presetNoteId : "");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [failTick, setFailTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The clinicians a referral can be addressed to: the other doctors and admins — the API's REFERRAL_TARGET_ROLES,
  // the roles that can open the clinical module (GET /staff is open to doctors).
  const staffQ = useStaffList(type === "internal");
  const clinicians = (staffQ.data ?? []).filter((s) => (s.role === "doctor" || s.role === "admin") && s.id !== meId);

  const dirty = !!(reason.trim() || provider.trim() || specialty.trim() || targetStaffId);

  const create = useMutation({
    mutationFn: () =>
      sendJson(`/api/patients/${patientId}/referrals`, "POST", {
        type,
        reason: reason.trim(),
        ...(noteId && { clinicalNoteId: noteId }),
        ...(type === "internal"
          ? { targetStaffId }
          : { externalProviderName: provider.trim(), ...(specialty.trim() && { externalSpecialty: specialty.trim() }) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referrals", patientId] });
      addMessage("Success", "Referenciação criada.");
      onClose();
    },
    onError: (err: Error) => setServerError(err.message),
  });

  useEffect(() => {
    if (failTick) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [failTick]);

  const clear = (k: keyof Errors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  function submit() {
    if (create.isPending) return;
    setServerError(null);
    const e: Errors = {};
    if (type === "internal" && !targetStaffId) e.target = "Escolha o clínico de destino.";
    if (type === "external" && provider.trim().length < 2) e.provider = "Indique o nome do prestador (pelo menos 2 letras).";
    if (reason.trim().length < 3) e.reason = "Indique o motivo (pelo menos 3 letras).";
    setErrors(e);
    if (Object.keys(e).length) { setFailTick((t) => t + 1); return; }
    create.mutate();
  }
  const close = () => {
    if (create.isPending) return;
    if (dirty && !window.confirm("Descartar a referenciação que está a escrever?")) return;
    onClose();
  };

  return (
    <Modal open onClose={close} dismissOnBackdrop={false} title="Nova Referenciação" size="md">
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div ref={bodyRef} className="px-6 py-5 flex flex-col gap-4">
          <Field label="Tipo">
            <select value={type} onChange={(e) => { setType(e.target.value as "internal" | "external"); setErrors({}); }} className={inputCls}>
              <option value="external">Externa (outro prestador)</option>
              <option value="internal">Interna (colega CAP)</option>
            </select>
          </Field>

          {type === "internal" ? (
            staffQ.isLoading ? (
              <p className="text-[12px] text-dim-500">A carregar clínicos…</p>
            ) : staffQ.isError ? (
              <p role="alert" className="text-[12px] text-red-600">
                Não foi possível carregar a lista de clínicos.{" "}
                <button type="button" onClick={() => staffQ.refetch()} className="underline font-semibold">Tentar novamente</button>
              </p>
            ) : clinicians.length === 0 ? (
              <p className="text-[12px] text-dim-600 bg-dim-50 rounded-[10px] px-3.5 py-2.5">Não há outros clínicos ativos para onde referenciar. Use uma referenciação externa.</p>
            ) : (
              <Field label="Clínico de destino" required error={errors.target}>
                <select
                  value={targetStaffId} aria-invalid={!!errors.target}
                  onChange={(e) => { setTargetStaffId(e.target.value); clear("target"); }}
                  className={`${inputCls} ${errors.target ? inputErrCls : ""}`}
                >
                  <option value="">Escolher…</option>
                  {clinicians.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </Field>
            )
          ) : (
            <>
              <Field label="Prestador Externo" required error={errors.provider}>
                <input
                  value={provider} maxLength={150} placeholder="Nome do médico/clínica" aria-invalid={!!errors.provider}
                  onChange={(e) => { setProvider(e.target.value); clear("provider"); }}
                  className={`${inputCls} ${errors.provider ? inputErrCls : ""}`}
                />
              </Field>
              <Field label="Especialidade" hint="Opcional">
                <input value={specialty} maxLength={100} placeholder="Ex: Psiquiatria" onChange={(e) => setSpecialty(e.target.value)} className={inputCls} />
              </Field>
            </>
          )}

          <Field label="Motivo" required error={errors.reason}>
            <textarea
              rows={3} value={reason} maxLength={1000} aria-invalid={!!errors.reason}
              onChange={(e) => { setReason(e.target.value); clear("reason"); }}
              className={`${inputCls} ${errors.reason ? inputErrCls : ""}`}
            />
          </Field>
          <NoteLinkSelect notes={linkable} value={noteId} onChange={setNoteId} />
          {serverError && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">Não foi possível criar a referenciação: {serverError}</p>}
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button type="submit" disabled={create.isPending} className={btnPrimary}>
            {create.isPending ? "A guardar…" : "Criar Referenciação"}
          </button>
          <button type="button" onClick={close} disabled={create.isPending} className={btnSecondary}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
