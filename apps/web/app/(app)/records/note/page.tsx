"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInYears, format } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertTriangle, ArrowLeft, Lock, Trash2 } from "lucide-react";
import { NOTE_CHANGED_CODE, finalNoteIssues, type ClinicalNoteEntry, type ParametrizacaoEntry, type Patient, type RiskLevel } from "@cap/types";
import { Field } from "@/components/ui/field";
import { useMessage } from "@/components/ui/message-handler";
import { TagBadges } from "@/components/ui/tag-picker";
import { usePermissions } from "../../hooks/use-permissions";
import { FailedInvoicesBanner, useConcludeAppointment } from "../_use-conclude";
import {
  RISK_META, SESSION_TYPES, HttpError, NoteSections, RiskBadge, fetchJson, isDraft, isLocked, noteFromConflict, sendJson, sessionTypeLabel,
} from "../_note-shared";
import { PhraseToolbar } from "../_editor-controls";
import { formFromNote, type NoteForm } from "../_note-merge";
import { ConflictResolver, MergeNoticeBanner, type MergeNotice, type NoteConflict } from "../_conflict-panel";
import { DiscardDraftModal, DiscardError, deleteDraft } from "../_discard-draft";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)]";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans disabled:bg-dim-50 disabled:text-dim-600";
const btnPrimary = "bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-3 md:py-2.5 rounded-[10px] text-[13px] disabled:opacity-50 transition-colors";
const btnSecondary = "border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-3 md:py-2.5 rounded-[10px] text-[13px] disabled:opacity-50 transition-colors";

const TEXT_FIELDS = [
  { key: "presentingConcerns", label: "Motivo / Estado apresentado", placeholder: "O que o paciente relatou nesta sessão…" },
  { key: "observations", label: "Observações", placeholder: "Afeto, comportamento, apresentação…" },
  { key: "assessment", label: "Avaliação", placeholder: "Impressão clínica, progresso face aos objetivos…" },
  { key: "plan", label: "Plano", placeholder: "Intervenções planeadas, foco da próxima sessão…" },
] as const;
type TextField = (typeof TEXT_FIELDS)[number]["key"];
const TEXT_MAX = 3000;
const FIELD_LABEL: Record<string, string> = {
  presentingConcerns: "Motivo", observations: "Observações", assessment: "Avaliação", plan: "Plano", riskNotes: "Detalhe do risco",
};

// Quick phrases — one tap appends the text, then the clinician edits it. They are stems, not
// diagnoses. The clinic edits them in Parametrizações (the groups below); this is the suggested set
// shown until a group has entries — which is how every fresh production database starts, since the
// production seed creates no reference data.
const SUGGESTED_PHRASES: Record<TextField, string[]> = {
  presentingConcerns: ["Sem queixas novas desde a última sessão.", "Refere melhoria desde a última sessão.", "Refere agravamento dos sintomas.", "Relata alterações do sono ou do apetite."],
  observations: ["Colaborante e orientado.", "Discurso organizado.", "Afeto congruente com o discurso.", "Afeto embotado."],
  assessment: ["Evolução favorável face aos objetivos.", "Sem alterações significativas face à sessão anterior.", "Evolução desfavorável — rever estratégia."],
  plan: ["Manter acompanhamento semanal.", "Manter plano terapêutico.", "Reavaliar na próxima sessão."],
};
const PHRASE_GROUP: Record<TextField, string> = {
  presentingConcerns: "FRASE_MOTIVO",
  observations: "FRASE_OBSERVACOES",
  assessment: "FRASE_AVALIACAO",
  plan: "FRASE_PLANO",
};

/** Same query key as ParametroSelect, so the Parametrizações page's invalidation reaches it. A group
 * that is empty (or failed to load) falls back to the suggested set, so the editor is never bare. */
function usePhrases(enabled: boolean): Record<TextField, string[]> {
  const results = useQueries({
    queries: TEXT_FIELDS.map(({ key }) => ({
      queryKey: ["parametrizacao", PHRASE_GROUP[key]],
      queryFn: () => fetchJson<ParametrizacaoEntry[]>(`/api/parametrizacao/${PHRASE_GROUP[key]}`),
      staleTime: 120_000,
      enabled,
    })),
  });
  return Object.fromEntries(
    TEXT_FIELDS.map(({ key }, i) => [key, results[i].data?.length ? results[i].data.map((r) => r.valor) : SUGGESTED_PHRASES[key]]),
  ) as Record<TextField, string[]>;
}

type ApptDetail = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  patient: { id: string; fullName: string | null };
  service: { name: string };
  staff?: { id: string; fullName: string };
  checkedInByStaffId?: string | null;
  completedByStaffId?: string | null;
};

const LEAVE_PROMPT = "Há texto por guardar que o servidor ainda não tem. Sair mesmo assim?";

const hasContent = (f: NoteForm) => !![f.presentingConcerns, f.observations, f.assessment, f.plan, f.riskNotes].some((t) => t.trim());

type NoteMeta = { id: string; finalizedAt: string | null; updatedAt: string; authorStaffId: string; authorName?: string };
const metaOf = (n: ClinicalNoteEntry): NoteMeta => ({
  id: n.id, finalizedAt: n.finalizedAt, updatedAt: n.updatedAt, authorStaffId: n.authorStaffId, authorName: n.author?.fullName,
});

/** First save created the note: pin it in the URL so a refresh resumes it instead of starting a second
 * one. (replaceState, not router.replace — no re-render of the page.) */
function pinNoteInUrl(id: string) {
  const u = new URL(window.location.href);
  u.searchParams.set("noteId", id);
  window.history.replaceState(null, "", u);
}

/** Smart defaults: the scheduled duration, and the session type that usually follows the last one.
 * For a colleague's patient (`foreign`) an empty history may just mean "not visible to me" (no note
 * of theirs is shared until the patient is in treatment), so don't guess an initial assessment. */
function defaultsFor(appt: ApptDetail | undefined, history: ClinicalNoteEntry[], foreign: boolean): NoteForm {
  const prev = history.find((n) => !isDraft(n))?.sessionType;
  return {
    sessionType: foreign ? "individual" : !prev ? "initial_assessment" : prev === "initial_assessment" ? "individual" : prev,
    durationMinutes: appt?.durationMinutes ?? 50,
    presentingConcerns: "", observations: "", assessment: "", plan: "",
    riskLevel: "none", riskNotes: "",
  };
}

/** The API takes a whole number of minutes from 1 to 600 (CreateClinicalNoteSchema). */
const validDuration = (d: number | "") => d === "" || (Number.isInteger(d) && d >= 1 && d <= 600);

const toPayload = (f: NoteForm, draft: boolean) => ({
  sessionType: f.sessionType,
  // A typo like 700 is left out of the save (the previous value stands) instead of failing the whole write — the text
  // must still reach the server; the form flags the field and won't finalize with it.
  durationMinutes: f.durationMinutes === "" || !validDuration(f.durationMinutes) ? undefined : f.durationMinutes,
  presentingConcerns: f.presentingConcerns,
  observations: f.observations,
  assessment: f.assessment,
  plan: f.plan,
  riskLevel: f.riskLevel,
  riskNotes: f.riskLevel === "none" ? "" : f.riskNotes,
  draft,
});

export default function NotePage() {
  return (
    <Suspense fallback={<div className="h-72 bg-dim-100 rounded-[16px] animate-pulse" />}>
      <NoteEditor />
    </Suspense>
  );
}

function NoteEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const sp = useSearchParams();
  const { isLoading: permLoading, isAdmin, me } = usePermissions();
  const canView = isAdmin || me?.role === "doctor";
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  const noteIdParam = sp.get("noteId");
  const appointmentIdParam = sp.get("appointmentId");
  const patientIdParam = sp.get("patientId");
  const returnToParam = sp.get("returnTo");
  const returnTo = returnToParam?.startsWith("/") && !returnToParam.startsWith("//") ? returnToParam : "/records";

  // Started from the patient's profile (no appointment in the URL) while that patient is checked in
  // with this doctor: link the note to that appointment, so the day queue and the completion step
  // see it. Otherwise the note would exist but the queue would still say "Sem nota".
  const linkLookup = !noteIdParam && !appointmentIdParam && !!patientIdParam && (isAdmin || !!me);
  const todayDay = format(new Date(), "yyyy-MM-dd");
  const autoLinkQ = useQuery({
    queryKey: ["appointments", "calendar", "records-autolink", todayDay, patientIdParam],
    queryFn: () => fetchJson<{ id: string; status: string; staff?: { id: string } }[]>(
      `/api/appointments?${new URLSearchParams({ from: todayDay, to: todayDay, patientId: patientIdParam ?? "" })}`,
    ),
    enabled: canView && linkLookup,
  });
  const linkedApptId = autoLinkQ.data?.find((a) => a.status === "checked_in" && (isAdmin || a.staff?.id === me?.id))?.id ?? null;
  const apptIdParam = appointmentIdParam ?? linkedApptId;

  // ── What already exists: the note being continued/edited, or the note already written for this
  // appointment (so "Registar" on a patient who has a draft resumes it instead of starting over).
  const noteQ = useQuery({
    queryKey: ["clinical-notes", "one", noteIdParam],
    queryFn: () => fetchJson<ClinicalNoteEntry>(`/api/clinical-notes/${noteIdParam}`),
    enabled: canView && !!noteIdParam,
  });
  const byApptQ = useQuery({
    queryKey: ["clinical-notes", "by-appointment", apptIdParam],
    queryFn: () => fetchJson<ClinicalNoteEntry[]>(`/api/clinical-notes?appointmentId=${apptIdParam}`),
    enabled: canView && !noteIdParam && !!apptIdParam,
  });
  const existing: ClinicalNoteEntry | null | undefined = noteIdParam
    ? noteQ.data
    : apptIdParam
      ? byApptQ.data && (byApptQ.data.find(isDraft) ?? byApptQ.data[0] ?? null)
      : null;

  const appointmentId = existing?.appointmentId ?? apptIdParam;
  const apptQ = useQuery({
    queryKey: ["appointments", "detail", appointmentId],
    queryFn: () => fetchJson<ApptDetail>(`/api/appointments/${appointmentId}`),
    enabled: canView && !!appointmentId,
  });
  const appt = apptQ.data;
  // A colleague's appointment (a doctor covering). Their finalized notes are readable while the patient is
  // in treatment today; before that — or for drafts — nothing of theirs is visible.
  const foreign = !isAdmin && !!appt?.staff && !!me && appt.staff.id !== me.id;
  // Other clinicians' finalized notes are shared only when someone *other than you* put the patient in treatment
  // (checked them in or completed the appointment). If every recorded actor is you, say so instead of showing nothing.
  const actors = [appt?.checkedInByStaffId, appt?.completedByStaffId].filter(Boolean);
  const aloneByMe = !isAdmin && !!me && actors.length > 0 && actors.every((a) => a === me.id);
  const patientId = existing?.patientId ?? appt?.patient.id ?? patientIdParam;

  const patientQ = useQuery({
    queryKey: ["patients", "detail", patientId],
    queryFn: () => fetchJson<Patient>(`/api/patients/${patientId}`),
    enabled: canView && !!patientId,
  });
  const historyQ = useQuery({
    queryKey: ["clinical-notes", patientId],
    queryFn: () => fetchJson<ClinicalNoteEntry[]>(`/api/patients/${patientId}/clinical-notes`),
    enabled: canView && !!patientId,
  });
  const history = useMemo(() => historyQ.data ?? [], [historyQ.data]);
  const phrases = usePhrases(canView);

  const settled = (q: { isSuccess: boolean; isError: boolean }, needed: boolean) => !needed || q.isSuccess || q.isError;
  const ready =
    !permLoading &&
    canView &&
    existing !== undefined &&
    settled(autoLinkQ, linkLookup) &&
    settled(apptQ, !!appointmentId) &&
    settled(historyQ, !!patientId) &&
    !!patientId;

  // ── Form state. Initialised once; later URL changes (the ?noteId= swap after the first autosave)
  // must not reset what the doctor is typing.
  const [form, setForm] = useState<NoteForm | null>(null);
  const [meta, setMeta] = useState<NoteMeta | null>(null);
  // Set when a save lost to a newer one made elsewhere (another tab/device): saving stops until the two versions are
  // joined. Carries the note as it is now and this tab's last synced copy (the merge's common ancestor).
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [mergeNotice, setMergeNotice] = useState<MergeNotice | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // The draft this tab is editing was discarded in another tab/device (a save answered 404): saving stops, the text stays.
  const [noteGone, setNoteGone] = useState(false);
  const [savedSnap, setSavedSnap] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict" | "gone">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const formRef = useRef<NoteForm | null>(null);
  const snapRef = useRef("");
  const noteIdRef = useRef<string | null>(null);
  const updatedAtRef = useRef<string | null>(null); // the version of the note this tab last saw — sent with every save
  const ctxRef = useRef<{ patientId: string | null; appointmentId: string | null }>({ patientId: null, appointmentId: null });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const finalizingRef = useRef(false);
  const editableDraftRef = useRef(false);
  const discardingRef = useRef(false); // a discard is under way or done: nothing may save this note any more
  const noteGoneRef = useRef(false);

  useEffect(() => {
    ctxRef.current = { patientId, appointmentId };
  }, [patientId, appointmentId]);

  useEffect(() => {
    if (form || !ready) return;
    const f = existing ? formFromNote(existing) : defaultsFor(appt, history, foreign);
    const snap = JSON.stringify(f);
    formRef.current = f;
    snapRef.current = snap;
    noteIdRef.current = existing?.id ?? null;
    updatedAtRef.current = existing?.updatedAt ?? null;
    setForm(f);
    setSavedSnap(snap);
    setMeta(existing ? metaOf(existing) : null);
  }, [form, ready, existing, appt, history, foreign]);

  const isFinal = !!meta?.finalizedAt;
  const locked = meta?.finalizedAt ? isLocked({ finalizedAt: meta.finalizedAt }, isAdmin) : false;
  // Someone else's finalized note, opened read-only (shared while the patient is in treatment today).
  const notMine = !isAdmin && !!meta && !!me && meta.authorStaffId !== me.id;
  const readOnly = locked || notMine;
  const dirty = !!form && JSON.stringify(form) !== savedSnap;

  useEffect(() => {
    formRef.current = form;
    editableDraftRef.current = !!form && !isFinal;
  }, [form, isFinal]);

  const setField = <K extends keyof NoteForm>(key: K, value: NoteForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const addSnippet = (key: TextField, text: string) => {
    const cur = formRef.current?.[key] ?? "";
    const next = cur.trim() ? `${cur.replace(/\s+$/, "")}\n${text}` : text;
    // maxLength only stops typing: a phrase added in code can pass it, and the API would then refuse every save.
    if (next.length > TEXT_MAX) { addMessage("Warning", `Não cabe: o campo tem o limite de ${TEXT_MAX} caracteres.`); return; }
    setForm((f) => (f ? { ...f, [key]: next } : f));
  };

  // ── Persistence. One chain, so "create the draft" always lands before "update the draft" and a
  // finalize can never be overtaken by a late autosave.
  const persist = useCallback(
    (f: NoteForm, draft: boolean): Promise<ClinicalNoteEntry> => {
      const run = async () => {
        const { patientId: pid, appointmentId: aid } = ctxRef.current;
        const body = toPayload(f, draft);
        let saved: ClinicalNoteEntry;
        try {
          saved = noteIdRef.current
            ? await sendJson<ClinicalNoteEntry>(`/api/clinical-notes/${noteIdRef.current}`, "PATCH", { ...body, ...(updatedAtRef.current ? { expectedUpdatedAt: updatedAtRef.current } : {}) })
            : await sendJson<ClinicalNoteEntry>(`/api/patients/${pid}/clinical-notes`, "POST", { ...body, ...(aid ? { appointmentId: aid } : {}) });
        } catch (e) {
          // A PATCH that finds no note: someone discarded the draft. (A 404 on the first save — a POST — is a missing patient.)
          if (e instanceof HttpError && e.status === 404 && noteIdRef.current) {
            noteGoneRef.current = true;
            setNoteGone(true);
            throw e;
          }
          let err: unknown = e;
          // The version check comes after the business rules, so some refusals are really "the note changed first": a
          // draft autosave onto a note the other tab finalized is answered 400 "can't go back to draft", not 409. Before
          // blaming the doctor's text, look at the note: if it moved on, it is the same conflict.
          if (!noteFromConflict(e) && e instanceof HttpError && e.status >= 400 && e.status < 500 && noteIdRef.current) {
            const now = await fetchJson<ClinicalNoteEntry>(`/api/clinical-notes/${noteIdRef.current}`).catch(() => null);
            if (now && now.updatedAt !== updatedAtRef.current) err = new HttpError("This note was changed elsewhere", 409, { code: NOTE_CHANGED_CODE, note: now });
          }
          // Saved elsewhere since this tab last looked (or the note already exists): stop and let the doctor choose.
          const current = noteFromConflict(err);
          if (current) setConflict({ note: current, base: JSON.parse(snapRef.current) as NoteForm });
          throw err;
        }
        if (!noteIdRef.current) pinNoteInUrl(saved.id);
        noteIdRef.current = saved.id;
        updatedAtRef.current = saved.updatedAt;
        snapRef.current = JSON.stringify(f);
        setSavedSnap(snapRef.current);
        setMeta(metaOf(saved));
        // Mark lists stale (so the next visit refetches past the 30s cache) without refetching now.
        queryClient.invalidateQueries({ queryKey: ["clinical-notes"], refetchType: "none" });
        return saved;
      };
      const p = chain.current.catch(() => undefined).then(run);
      chain.current = p;
      return p;
    },
    [queryClient],
  );

  const saveDraft = useCallback(
    (f: NoteForm) => {
      setSaveState("saving");
      return persist(f, true).then(
        () => { setSaveState("saved"); setSavedAt(new Date()); },
        (e) => setSaveState(noteFromConflict(e) ? "conflict" : noteGoneRef.current ? "gone" : "error"),
      );
    },
    [persist],
  );

  // Autosave once typing pauses — only for drafts, and never for a form that is still untouched
  // (opening the page must not create an empty draft).
  useEffect(() => {
    if (!form || isFinal || readOnly || conflict || noteGone || discarding || !dirty || !hasContent(form)) return;
    const t = setTimeout(() => { if (!finalizingRef.current && !discardingRef.current) void saveDraft(form); }, 1500);
    return () => clearTimeout(t);
  }, [form, isFinal, readOnly, conflict, noteGone, discarding, dirty, saveDraft]);

  // The draft was discarded elsewhere and the doctor wants the text kept: start a new draft from it (an appointment's
  // note slot was freed by the discard, so the create is accepted).
  const saveAsNewDraft = useCallback(() => {
    const f = formRef.current;
    if (!f) return;
    noteIdRef.current = null;
    updatedAtRef.current = null;
    snapRef.current = "";
    noteGoneRef.current = false;
    setSavedSnap("");
    setMeta(null);
    setNoteGone(false);
    void saveDraft(f);
  }, [saveDraft]);

  // A failed autosave (offline, or the API restarting) is tried again as soon as the browser is back online.
  useEffect(() => {
    if (saveState !== "error") return;
    const retry = () => { const f = formRef.current; if (f && !discardingRef.current) void saveDraft(f); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [saveState, saveDraft]);

  // The conflict is resolved (joined automatically, or the doctor chose): the server's note becomes this tab's base, and
  // the joined form is shown — it is unsaved (dirty) when it still differs from the server's note, so autosave resumes.
  const resolveConflict = useCallback((note: ClinicalNoteEntry, merged: NoteForm, notice: MergeNotice) => {
    noteIdRef.current = note.id;
    updatedAtRef.current = note.updatedAt;
    pinNoteInUrl(note.id);
    const server = JSON.stringify(formFromNote(note));
    snapRef.current = server;
    formRef.current = merged;
    setSavedSnap(server);
    setForm(merged);
    setMeta(metaOf(note));
    setConflict(null);
    setSaveState("idle");
    setMergeNotice(notice);
  }, []);

  // Leaving the page (SPA navigation) with unsaved draft text: save it on the way out.
  useEffect(
    () => () => {
      const f = formRef.current;
      if (f && editableDraftRef.current && hasContent(f) && JSON.stringify(f) !== snapRef.current && !finalizingRef.current && !discardingRef.current) {
        void persist(f, true).catch(() => undefined); // nowhere left to show a failure: the next visit resumes the last saved draft
      }
    },
    [persist],
  );
  // Text the server doesn't have and nothing is about to save: a final note being edited (no autosave), or a draft whose
  // save failed or is waiting on a conflict. Leaving through any link then asks first — the one-shot save on the way out
  // can't succeed in those states, so without the question the doctor's text would just be gone.
  const atRiskRef = useRef(false);
  useEffect(() => {
    atRiskRef.current = !!form && dirty && !readOnly && (isFinal || saveState === "error" || !!conflict || noteGone);
  }, [form, dirty, readOnly, isFinal, saveState, conflict, noteGone]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!atRiskRef.current || discardingRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin === window.location.origin && to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (!window.confirm(LEAVE_PROMPT)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("click", onClick, true); // capture: before Next's Link navigates
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  // Closing/refreshing the tab with anything unsaved (an in-flight autosave counts as unsaved).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const f = formRef.current;
      if (f && !discardingRef.current && JSON.stringify(f) !== snapRef.current && (hasContent(f) || !editableDraftRef.current)) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const { conclude, retryInvoice, failedInvoices } = useConcludeAppointment();
  const patientName = patientQ.data?.fullName ?? appt?.patient.fullName ?? "Paciente";
  const canConclude = appt?.status === "checked_in";

  const issues = form ? finalNoteIssues(form) : [];
  const durationBad = !!form && !validDuration(form.durationMinutes);
  const durationOk = !!form && form.durationMinutes !== "" && !durationBad;

  async function submit(andConclude: boolean) {
    if (!form || busy) return;
    finalizingRef.current = true;
    setBusy(true);
    try {
      if (!isFinal || dirty) {
        try {
          await persist(form, false);
        } catch (e) {
          if (!noteFromConflict(e) && !noteGoneRef.current) addMessage("Error", (e as Error).message); // a conflict / a vanished draft show their own banner
          return;
        }
      }
      if (andConclude && appt) {
        try {
          const r = await conclude.mutateAsync({ id: appt.id, durationMinutes: Number(form.durationMinutes), patientName });
          if (r?.invoiceWarning) return; // stay: the retry-invoice banner is showing
        } catch {
          return; // the hook already toasted; the note itself is saved
        }
      } else {
        addMessage("Success", isFinal ? "Nota atualizada." : "Nota guardada.");
        if (isFinal) return;
      }
      router.push(returnTo);
    } finally {
      finalizingRef.current = false;
      setBusy(false);
    }
  }

  // Throwing the draft away. Saving stops first, and whatever save is in flight is awaited — it may be the one that
  // creates the note, and a delete issued before it would miss it. With nothing saved yet there is nothing to delete.
  async function discardDraft() {
    discardingRef.current = true;
    setDiscarding(true);
    try {
      await chain.current.catch(() => undefined);
      const id = noteIdRef.current;
      if (id) {
        try {
          await deleteDraft(id);
        } catch (e) {
          if (e instanceof DiscardError && e.kind === "gone") addMessage("Warning", e.message); // nothing left to keep: leave
          else throw e;
        }
        queryClient.removeQueries({ queryKey: ["clinical-notes", "one", id] });
      }
      queryClient.invalidateQueries({ queryKey: ["clinical-notes"] });
      if (id) addMessage("Success", "Rascunho descartado.");
      setDiscardOpen(false);
      router.push(returnTo); // discardingRef stays set: the unmount must not save the text again
    } catch (e) {
      discardingRef.current = false;
      setDiscarding(false);
      throw e;
    }
  }

  const primaryAction = canConclude ? () => submit(true) : () => submit(false);
  const primaryDisabled = readOnly || !!conflict || noteGone || busy || issues.length > 0 || durationBad || (canConclude && !durationOk) || (isFinal && !dirty && !canConclude);

  // A draft can be thrown away: saved on the server, or typed here and not saved yet. Not once finalized, and not
  // while two versions are waiting to be joined (which note would it be?).
  const canDiscard = !readOnly && !isFinal && !conflict && !noteGone && (!!meta?.id || (!!form && hasContent(form)));

  const sessionCount = history.filter((n) => !isDraft(n)).length;
  const byOther = (n: ClinicalNoteEntry) => (!!me && n.authorStaffId !== me.id ? n.author?.fullName ?? "outro clínico" : null);
  const lastFinal = history.find((n) => !isDraft(n) && n.id !== meta?.id);
  const previous = history.filter((n) => !isDraft(n) && n.id !== meta?.id).slice(0, 10);
  const riskAlert = lastFinal && (lastFinal.riskLevel === "moderate" || lastFinal.riskLevel === "high") ? lastFinal : null;

  const backLink = (
    <Link
      href={returnTo}
      className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium self-start"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Voltar
    </Link>
  );

  if (!permLoading && !canView) return null;
  if (!form) {
    // Nothing to open: the note/appointment failed to load, or there is no patient to write about.
    const failed = noteQ.isError || byApptQ.isError || (existing !== undefined && !patientId && !apptQ.isFetching);
    return (
      <div className="flex flex-col gap-5">
        {backLink}
        {failed ? (
          <p className="py-16 text-center text-[13px] font-medium text-red-600">Não foi possível abrir este registo.</p>
        ) : (
          <div className="h-72 bg-dim-100 rounded-[16px] animate-pulse" />
        )}
      </div>
    );
  }

  const age = patientQ.data?.dateOfBirth ? differenceInYears(new Date(), new Date(patientQ.data.dateOfBirth)) : null;

  return (
    <div className="flex flex-col gap-5">
      {backLink}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold text-dim-900 break-words">Registo clínico — {patientName}</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">
            {appt ? `${appt.service.name} · ${format(new Date(appt.scheduledAt), "d MMM, HH:mm", { locale: pt })}` : "Contacto sem marcação"}
          </p>
        </div>
        <SaveStatus locked={readOnly} isFinal={isFinal} dirty={dirty} state={saveState} savedAt={savedAt} onRetry={() => form && saveDraft(form)} />
      </div>

      <FailedInvoicesBanner failed={failedInvoices} onRetry={(id) => retryInvoice.mutate(id)} pending={retryInvoice.isPending} />

      {conflict && (
        <ConflictResolver key={conflict.note.updatedAt} conflict={conflict} form={form} localIsFinal={isFinal} onResolve={resolveConflict} />
      )}
      {noteGone && (
        <div role="alert" className="rounded-[14px] border border-amber-200 bg-amber-50 px-5 py-3.5 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-amber-900">Este rascunho foi descartado noutro separador ou dispositivo.</p>
              <p className="text-[12px] text-dim-700 mt-0.5">O que escreveu aqui continua neste ecrã mas já não está guardado em lado nenhum.</p>
            </div>
          </div>
          <button type="button" onClick={saveAsNewDraft} className="text-[12px] font-semibold px-3.5 py-2 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white transition-colors shrink-0">
            Guardar como novo rascunho
          </button>
        </div>
      )}
      {!conflict && mergeNotice && <MergeNoticeBanner notice={mergeNotice} draft={!isFinal} onDismiss={() => setMergeNotice(null)} />}

      {riskAlert && (
        <div role="alert" className={`flex gap-3 rounded-[14px] px-5 py-3.5 border ${riskAlert.riskLevel === "high" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${riskAlert.riskLevel === "high" ? "text-red-600" : "text-amber-600"}`} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-dim-900">
              Última sessão ({format(new Date(riskAlert.finalizedAt ?? riskAlert.createdAt), "d MMM yyyy", { locale: pt })}) com {RISK_META[riskAlert.riskLevel].label.toLowerCase()}
            </p>
            {riskAlert.riskNotes && <p className="text-[12px] text-dim-700 mt-0.5 whitespace-pre-wrap">{riskAlert.riskNotes}</p>}
          </div>
        </div>
      )}

      {/* Two columns only from xl: the app shell's fixed sidebar means a 1024px viewport leaves ~740px of content. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <div
          className={`${CARD} overflow-clip`}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !primaryDisabled) { e.preventDefault(); void primaryAction(); }
          }}
        >
          <div className="px-5 sm:px-6 py-5 flex flex-col gap-5">
            {notMine ? (
              <p className="flex items-center gap-2 text-[12px] text-dim-600 bg-dim-50 rounded-[10px] px-3.5 py-2.5">
                <Lock className="w-3.5 h-3.5 shrink-0" /> Nota de {meta?.authorName ?? "outro clínico"} — só leitura. Fica visível enquanto o paciente estiver em consulta hoje.
              </p>
            ) : locked && (
              <p className="flex items-center gap-2 text-[12px] text-dim-600 bg-dim-50 rounded-[10px] px-3.5 py-2.5">
                <Lock className="w-3.5 h-3.5 shrink-0" /> Esta nota foi bloqueada 24h após ser finalizada e já não pode ser editada.
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Field label="Tipo de sessão">
                <select value={form.sessionType} disabled={readOnly} onChange={(e) => setField("sessionType", e.target.value)} className={inputCls}>
                  {SESSION_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  {!SESSION_TYPES.some(([k]) => k === form.sessionType) && <option value={form.sessionType}>{sessionTypeLabel(form.sessionType)}</option>}
                </select>
              </Field>
              <Field
                label="Duração (minutos)" hint={canConclude ? "Usada para calcular a fatura" : undefined}
                error={durationBad ? "Use um número inteiro de minutos, entre 1 e 600." : undefined}
              >
                <input
                  type="number" min={1} max={600} step={1} inputMode="numeric" disabled={readOnly} aria-invalid={durationBad}
                  value={form.durationMinutes}
                  onChange={(e) => setField("durationMinutes", e.target.value === "" ? "" : Number(e.target.value))}
                  className={`${inputCls} ${durationBad ? "border-red-300" : ""}`}
                />
              </Field>
            </div>

            {TEXT_FIELDS.map(({ key, label, placeholder }) => {
              const chips = [
                ...(key === "plan" && lastFinal?.plan.trim() ? [{ label: "Repetir plano anterior", text: lastFinal.plan }] : []),
                ...phrases[key].map((s) => ({ label: s, text: s })),
              ];
              return (
                <div key={key}>
                  <label htmlFor={`f-${key}`} className="block text-[12px] font-semibold text-dim-700 mb-1.5">
                    {label}<span className="text-red-500 ml-0.5" aria-hidden>*</span>
                  </label>
                  <textarea
                    id={`f-${key}`} rows={4} disabled={readOnly}
                    value={form[key]} onChange={(e) => setField(key, e.target.value)}
                    placeholder={placeholder} maxLength={TEXT_MAX}
                    className={`${inputCls} min-h-[104px] [field-sizing:content]`}
                  />
                  {!readOnly && <PhraseToolbar label={`Frases rápidas — ${label}`} chips={chips} onPick={(text) => addSnippet(key, text)} />}
                </div>
              );
            })}

            <div>
              <p id="risk-label" className="text-[12px] font-semibold text-dim-700 mb-1.5">Nível de risco</p>
              <div
                role="radiogroup" aria-labelledby="risk-label" className="grid grid-cols-2 lg:grid-cols-4 gap-2"
                onKeyDown={(e) => {
                  // The radio-group pattern: the selected one is the tab stop, arrows move the selection (and the focus).
                  if (readOnly || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
                  e.preventDefault();
                  const order = Object.keys(RISK_META) as RiskLevel[];
                  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : order.length - 1;
                  const next = order[(order.indexOf(form.riskLevel) + step) % order.length];
                  setField("riskLevel", next);
                  requestAnimationFrame(() => document.getElementById(`risk-${next}`)?.focus());
                }}
              >
                {(Object.keys(RISK_META) as RiskLevel[]).map((k) => {
                  const on = form.riskLevel === k;
                  return (
                    <button
                      key={k} id={`risk-${k}`} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={readOnly}
                      onClick={() => setField("riskLevel", k)}
                      className={`text-[12px] font-semibold rounded-[10px] px-3 py-2.5 border transition-colors disabled:opacity-60 ${on ? `${RISK_META[k].cls} border-transparent` : "bg-white text-dim-600 border-dim-200 hover:bg-dim-50"}`}
                    >
                      {RISK_META[k].short}
                    </button>
                  );
                })}
              </div>
              {form.riskLevel !== "none" && (
                <div className="mt-3">
                  <Field label="Detalhe do risco" required>
                    <textarea
                      rows={2} disabled={readOnly} maxLength={1000}
                      value={form.riskNotes} onChange={(e) => setField("riskNotes", e.target.value)}
                      placeholder="Descreva o risco identificado e as medidas tomadas…"
                      className={`${inputCls} [field-sizing:content]`}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>

          {!readOnly && (
            <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-dim-100 px-5 sm:px-6 py-3.5 flex flex-col gap-2">
              {(issues.length > 0 || (canConclude && !durationOk)) && (
                <p className="text-[11px] text-dim-500">
                  Para guardar falta: {[...issues.map((i) => FIELD_LABEL[i.path] ?? i.path), ...(canConclude && !durationOk ? ["Duração"] : [])].join(", ")}.
                  {!isFinal && " O rascunho é guardado automaticamente."}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={primaryAction} disabled={primaryDisabled} className={btnPrimary}>
                  {busy ? "A guardar…" : canConclude ? "Guardar e concluir consulta" : isFinal ? "Guardar alterações" : "Guardar nota"}
                </button>
                {canConclude && (
                  <button onClick={() => submit(false)} disabled={busy || issues.length > 0 || durationBad || (isFinal && !dirty)} className={btnSecondary}>
                    Só guardar nota
                  </button>
                )}
                <span className="hidden md:inline text-[11px] text-dim-400 ml-auto">Ctrl + Enter</span>
                {canDiscard && (
                  <button
                    type="button" onClick={() => setDiscardOpen(true)} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-[8px] px-2.5 py-2 transition-colors disabled:opacity-50 md:ml-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden /> Descartar rascunho
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Context ──────────────────────────────────────────────────────── */}
        <aside className="order-first xl:order-none flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          {(foreign || aloneByMe) && appt && (
            <div role="note" className="rounded-[14px] border border-dim-200 bg-white px-4 py-3 text-[12px] text-dim-600">
              {foreign && appt.staff && <p className="font-semibold text-dim-800">Consulta de {appt.staff.fullName}</p>}
              <p className="mt-0.5">Enquanto o paciente estiver em consulta hoje, vê também as notas finalizadas de outros clínicos (só leitura), desde que o check-in tenha sido feito por outra pessoa. Rascunhos nunca são partilhados.</p>
              {aloneByMe && (
                <p className="mt-1.5 font-medium text-amber-800">
                  Foi só você a pôr este paciente em consulta, por isso as notas de outros clínicos não aparecem. Peça à receção ou a um colega para fazer o check-in.
                </p>
              )}
            </div>
          )}
          <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-800 font-semibold text-[14px] flex items-center justify-center shrink-0">
                {patientName[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                {patientId ? (
                  <Link href={`/patients/${patientId}`} className="text-[13px] font-semibold text-dim-900 hover:text-brand-700 truncate block">{patientName}</Link>
                ) : <p className="text-[13px] font-semibold text-dim-900 truncate">{patientName}</p>}
                <p className="text-[11px] text-dim-500">{age !== null ? `${age} anos` : "—"}{sessionCount > 0 && ` · ${sessionCount} ${sessionCount === 1 ? "sessão registada" : "sessões registadas"}`}</p>
              </div>
            </div>
            {!!patientQ.data?.tags?.length && <div className="mt-3"><TagBadges nome="TAG_PACIENTE" codes={patientQ.data.tags} /></div>}
          </div>

          {lastFinal?.plan.trim() && (
            <div className={`${CARD} p-4`}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-dim-400 mb-1">
                Plano da sessão anterior · {format(new Date(lastFinal.finalizedAt ?? lastFinal.createdAt), "d MMM", { locale: pt })}{byOther(lastFinal) && ` · ${byOther(lastFinal)}`}
              </p>
              <p className="text-[13px] text-dim-800 whitespace-pre-wrap">{lastFinal.plan}</p>
            </div>
          )}

          {previous.length > 0 && (
            <div className={`${CARD} overflow-hidden`}>
              <p className="px-4 py-3 text-[12px] font-semibold text-dim-900 border-b border-dim-100">Sessões anteriores</p>
              {previous.map((n) => (
                <details key={n.id} className="group border-b border-dim-100 last:border-0">
                  <summary className="flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer list-none hover:bg-dim-50 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium text-dim-900">{format(new Date(n.finalizedAt ?? n.createdAt), "d MMM yyyy", { locale: pt })}</span>
                      <span className="block text-[11px] text-dim-500 truncate">{sessionTypeLabel(n.sessionType)}{byOther(n) && ` · ${byOther(n)}`}</span>
                    </span>
                    <RiskBadge level={n.riskLevel} />
                  </summary>
                  <div className="px-4 pb-3"><NoteSections note={n} /></div>
                </details>
              ))}
            </div>
          )}
        </aside>
      </div>

      <DiscardDraftModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={discardDraft}
        what={`o rascunho de ${patientName}`}
      />
    </div>
  );
}

function SaveStatus({ locked, isFinal, dirty, state, savedAt, onRetry }: {
  locked: boolean; isFinal: boolean; dirty: boolean; state: "idle" | "saving" | "saved" | "error" | "conflict" | "gone"; savedAt: Date | null; onRetry: () => void;
}) {
  if (locked) return null;
  // One live region that is always in the page (a region that appears together with its text is not announced),
  // whose content changes. "A guardar…" is left out of the announcements: one per pause in typing would be noise.
  let cls = "text-dim-400";
  let content: ReactNode = null;
  if (state === "conflict") {
    cls = "text-amber-700";
    content = "Há uma versão mais recente noutro separador — junte as versões";
  } else if (state === "gone") {
    cls = "text-amber-700";
    content = "Este rascunho foi descartado noutro separador — o texto não está guardado";
  } else if (isFinal) {
    if (dirty) { content = "Alterações por guardar"; cls = "text-amber-700"; }
  } else if (state === "saving") content = <span aria-hidden>A guardar rascunho…</span>;
  else if (state === "saved" && savedAt) content = `Rascunho guardado às ${format(savedAt, "HH:mm")}`;
  else if (state === "error") {
    cls = "text-red-600";
    content = (
      <span role="alert">
        Não foi possível guardar o rascunho — o texto continua aqui.{" "}
        <button type="button" onClick={onRetry} className="underline font-semibold">Tentar novamente</button>
      </span>
    );
  } else content = "O rascunho é guardado automaticamente";
  return <div role="status" aria-live="polite" className={`text-[12px] ${cls}`}>{content}</div>;
}
