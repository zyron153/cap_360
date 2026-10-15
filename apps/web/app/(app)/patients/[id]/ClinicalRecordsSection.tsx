"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { ClipboardList, Pill, Plus, Send, Trash2 } from "lucide-react";
import type { ClinicalNoteEntry, PrescriptionEntry, ReferralEntry } from "@cap/types";
import { useMessage } from "@/components/ui/message-handler";
import { TabList, TabPanel } from "@/components/ui/tabs";
import { usePermissions } from "../../hooks/use-permissions";
import {
  NoteSections, NoteStateBadges, RiskBadge, isDraft, isLocked, notePreview, sessionTypeLabel,
} from "../../records/_note-shared";
import { DiscardDraftModal, DiscardError, deleteDraft } from "../../records/_discard-draft";
import { LoadMore, usePagedList } from "./_clinical-forms";
import { PrescriptionsTab } from "./_PrescriptionsTab";
import { ReferralsTab } from "./_ReferralsTab";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

type Tab = "notes" | "prescriptions" | "referrals";
/** A form opened from a note ("Prescrever" / "Referenciar"): it starts linked to that note. */
export type FormIntent = { kind: "prescription" | "referral"; noteId: string | null };

/** Section/tab-list state for the clinician's notes, prescriptions and referrals on a patient profile. */
export function ClinicalRecordsSection({ patientId }: { patientId: string }) {
  const { isAdmin, me } = usePermissions();
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [tab, setTab] = useState<Tab>("notes");
  const [intent, setIntent] = useState<FormIntent | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ClinicalNoteEntry | null>(null);

  // Each list is paged by the API (100 at a time, newest first). The key is not the editor's ["clinical-notes", patientId]:
  // that one holds a plain array, this one pages.
  const notesQ = usePagedList<ClinicalNoteEntry>(["clinical-notes", "profile", patientId], `/api/patients/${patientId}/clinical-notes`);
  const prescriptionsQ = usePagedList<PrescriptionEntry>(["prescriptions", patientId], `/api/patients/${patientId}/prescriptions`, tab === "prescriptions");
  const referralsQ = usePagedList<ReferralEntry>(["referrals", patientId], `/api/patients/${patientId}/referrals`, tab === "referrals");

  const notes = notesQ.data ?? [];
  // A prescription/referral can be tied to a note this clinician wrote (a colleague's note is read-only here).
  const linkable = notes.filter((n) => isAdmin || n.authorStaffId === me?.id);

  function openForm(kind: FormIntent["kind"], noteId: string | null) {
    setTab(kind === "prescription" ? "prescriptions" : "referrals");
    setIntent({ kind, noteId });
  }

  async function discard(n: ClinicalNoteEntry) {
    try {
      await deleteDraft(n.id);
      addMessage("Success", "Rascunho descartado.");
    } catch (e) {
      if (!(e instanceof DiscardError && e.kind === "gone")) throw e; // refused (finalized, linked records…): the dialog says why
      addMessage("Warning", e.message); // already gone: the list below is refreshed either way
    }
    queryClient.removeQueries({ queryKey: ["clinical-notes", "one", n.id] });
    queryClient.invalidateQueries({ queryKey: ["clinical-notes"] });
    setDiscardTarget(null);
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-dim-100">
        <TabList
          idPrefix="patient-clinical"
          label="Registos clínicos do paciente"
          value={tab}
          onChange={(t) => { setTab(t); setIntent(null); }}
          className="flex items-center gap-1.5 bg-dim-100 rounded-[10px] p-1 max-w-full overflow-x-auto"
          tabClassName={(on) => `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors whitespace-nowrap ${on ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"}`}
          tabs={[
            { key: "notes" as const, label: "Notas Clínicas", icon: <ClipboardList className="w-3.5 h-3.5" aria-hidden /> },
            { key: "prescriptions" as const, label: "Prescrições", icon: <Pill className="w-3.5 h-3.5" aria-hidden /> },
            { key: "referrals" as const, label: "Referenciações", icon: <Send className="w-3.5 h-3.5" aria-hidden /> },
          ]}
        />
        {tab === "notes" && (
          <Link
            href={`/records/note?patientId=${patientId}&returnTo=/patients/${patientId}`}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> Nova Nota
          </Link>
        )}
      </div>

      <TabPanel idPrefix="patient-clinical" tabKey={tab} className="px-4 sm:px-6 py-5">
        {tab === "notes" && (
          notesQ.isLoading ? (
            <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
          ) : notesQ.isError ? (
            <div className="text-center py-6">
              <p role="alert" className="text-[13px] text-red-600">Não foi possível carregar as notas clínicas.</p>
              <button type="button" onClick={() => notesQ.refetch()} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 mt-1.5">Tentar novamente</button>
            </div>
          ) : notes.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Ainda sem notas clínicas — apenas as suas notas aparecem aqui, salvo se for administrador.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((n) => (
                <NoteRow
                  key={n.id} note={n} patientId={patientId} isAdmin={isAdmin} meId={me?.id}
                  onDiscard={() => setDiscardTarget(n)}
                  onPrescribe={() => openForm("prescription", n.id)}
                  onRefer={() => openForm("referral", n.id)}
                />
              ))}
              <LoadMore list={notesQ} />
            </div>
          )
        )}

        {tab === "prescriptions" && (
          <PrescriptionsTab
            patientId={patientId} query={prescriptionsQ} notes={notes} linkable={linkable}
            formOpen={intent?.kind === "prescription"} presetNoteId={intent?.noteId ?? null}
            onOpenForm={() => setIntent({ kind: "prescription", noteId: null })} onCloseForm={() => setIntent(null)}
          />
        )}

        {tab === "referrals" && (
          <ReferralsTab
            patientId={patientId} query={referralsQ} notes={notes} linkable={linkable} meId={me?.id} isAdmin={isAdmin}
            formOpen={intent?.kind === "referral"} presetNoteId={intent?.noteId ?? null}
            onOpenForm={() => setIntent({ kind: "referral", noteId: null })} onCloseForm={() => setIntent(null)}
          />
        )}
      </TabPanel>

      <DiscardDraftModal
        open={!!discardTarget}
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => (discardTarget ? discard(discardTarget) : Promise.resolve())}
        what={discardTarget ? `o rascunho de ${format(new Date(discardTarget.createdAt), "d MMM yyyy", { locale: pt })} (${sessionTypeLabel(discardTarget.sessionType)})` : "o rascunho"}
      />
    </div>
  );
}

/** One note, collapsed to a preview line and expandable in place — no modal to open and close. */
function NoteRow({ note: n, patientId, isAdmin, meId, onDiscard, onPrescribe, onRefer }: {
  note: ClinicalNoteEntry; patientId: string; isAdmin: boolean; meId?: string;
  onDiscard: () => void; onPrescribe: () => void; onRefer: () => void;
}) {
  const preview = notePreview(n);
  // Another clinician's finalized note is visible here while the patient is in treatment today — read-only.
  const mine = isAdmin || n.authorStaffId === meId;
  const canEdit = mine && (isDraft(n) || !isLocked(n, isAdmin));
  const actionCls = "text-[12px] font-semibold text-brand-700 hover:text-brand-800 transition-colors";
  return (
    <details className="group rounded-[10px] border border-dim-100 hover:border-brand-300 transition-colors open:bg-dim-50/50">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-dim-900 truncate flex items-center gap-2">
            <span className="truncate">{sessionTypeLabel(n.sessionType)}</span>
            <NoteStateBadges note={n} isAdmin={isAdmin} />
          </p>
          <p className="text-[11px] text-dim-500 mt-0.5">{n.author?.fullName ?? "—"} · {format(new Date(n.finalizedAt ?? n.createdAt), "d MMM yyyy, HH:mm", { locale: pt })}</p>
          {preview && <p className="text-[12px] text-dim-500 mt-1 truncate group-open:hidden">{preview}</p>}
        </div>
        <RiskBadge level={n.riskLevel} />
      </summary>
      <div className="px-4 pb-4 flex flex-col gap-3">
        <NoteSections note={n} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2 border-t border-dim-100">
          <p className="text-[11px] text-dim-400">{n.durationMinutes ?? "—"} min</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {mine && !isDraft(n) && (
              <>
                <button type="button" onClick={onPrescribe} className={actionCls}>Prescrever</button>
                <button type="button" onClick={onRefer} className={actionCls}>Referenciar</button>
              </>
            )}
            {mine && isDraft(n) && (
              <button type="button" onClick={onDiscard} className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 hover:text-red-700 transition-colors">
                <Trash2 className="w-3 h-3" aria-hidden /> Descartar rascunho
              </button>
            )}
            {canEdit && (
              <Link href={`/records/note?noteId=${n.id}&returnTo=/patients/${patientId}`} className={actionCls}>
                {isDraft(n) ? "Continuar rascunho" : "Editar"}
              </Link>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
