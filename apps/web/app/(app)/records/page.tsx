"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { pt } from "date-fns/locale";
import { ChevronRight, CheckCircle2, ClipboardList, Search } from "lucide-react";
import type { RiskLevel } from "@cap/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { TabList, TabPanel } from "@/components/ui/tabs";
import { usePermissions } from "../hooks/use-permissions";
import { FailedInvoicesBanner, useConcludeAppointment } from "./_use-conclude";
import { AccessLogTab } from "./_access-log";
import {
  NoteStateBadges, RISK_META, RiskBadge, fetchJson, isDraft, notePreview, sessionTypeLabel, type NoteWithPatient,
} from "./_note-shared";

type QueueAppointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  patient: { fullName: string | null };
  service: { name: string };
  staff?: { id: string; fullName: string };
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const selectCls = "border border-dim-200 rounded-[10px] px-3 py-2 text-[12px] text-dim-700 bg-white focus:outline-none focus:border-brand-500 hover:border-dim-300";
const REFRESH_MS = 30_000;

export default function RecordsPage() {
  const { isLoading: permLoading, isAdmin, me, can } = usePermissions();
  const router = useRouter();
  const canView = isAdmin || me?.role === "doctor";
  const canConclude = can("appointments");
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  // The day queue is the doctor's working view, so it's the default whenever it's available.
  const [tabChoice, setTab] = useState<"today" | "history" | "access" | null>(null);

  // A doctor sees their own queue by default; "Todos" lets one cover for a colleague. Remembered per
  // browser — a per-viewer convenience, so a failed read/write of storage just means "Só os meus".
  const [scope, setScope] = useState<"mine" | "all">("mine");
  useEffect(() => {
    try { if (localStorage.getItem("cap:records-queue-scope") === "all") setScope("all"); } catch { /* storage unavailable */ }
  }, []);
  function changeScope(v: "mine" | "all") {
    setScope(v);
    try { localStorage.setItem("cap:records-queue-scope", v); } catch { /* storage unavailable */ }
  }
  // "Acessos entre clínicos" is the admin's review of the cross-author read exception — nobody else sees it.
  const tab = tabChoice === "access" && !isAdmin ? "history" : tabChoice ?? (canConclude ? "today" : "history");

  // ── Day queue: today's appointments (the doctor's own — admin sees everyone's) + today's notes.
  // Polled, so a patient the receptionist just checked in shows up without a reload.
  const today = format(new Date(), "yyyy-MM-dd");
  const staffScope = isAdmin || scope === "all" ? "" : me?.id ?? "";
  const queueEnabled = canView && canConclude && (isAdmin || !!me);
  const apptsQ = useQuery({
    queryKey: ["appointments", "calendar", "records-queue", today, staffScope],
    queryFn: () => fetchJson<QueueAppointment[]>(`/api/appointments?${new URLSearchParams({ from: today, to: today, ...(staffScope && { staffId: staffScope }) })}`),
    enabled: queueEnabled,
    refetchInterval: REFRESH_MS,
  });
  const todayNotesQ = useQuery({
    queryKey: ["clinical-notes", "today", today],
    queryFn: () => fetchJson<NoteWithPatient[]>(`/api/clinical-notes?from=${today}`),
    enabled: queueEnabled,
    refetchInterval: REFRESH_MS,
  });
  const appts = apptsQ.data ?? [];
  const inConsult = appts.filter((a) => a.status === "checked_in");
  const done = appts.filter((a) => a.status === "completed");

  // Best note per appointment: a finalized one beats a draft.
  const noteByAppt = new Map<string, NoteWithPatient>();
  for (const n of todayNotesQ.data ?? []) {
    if (!n.appointmentId) continue;
    const cur = noteByAppt.get(n.appointmentId);
    if (!cur || (isDraft(cur) && !isDraft(n))) noteByAppt.set(n.appointmentId, n);
  }

  const { conclude, retryInvoice, failedInvoices } = useConcludeAppointment();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900">Registos Clínicos</h1>
        <p className="text-[13px] text-dim-500 mt-0.5">
          {tab === "today"
            ? "Pacientes em consulta hoje — registe a nota e conclua sem sair daqui"
            : tab === "access" ? "Quem leu notas de outros clínicos"
            : isAdmin ? "Todas as notas clínicas recentes" : "As suas notas clínicas recentes, em todos os pacientes"}
        </p>
      </div>

      <FailedInvoicesBanner failed={failedInvoices} onRetry={(id) => retryInvoice.mutate(id)} pending={retryInvoice.isPending} />

      {canConclude && (
        <TabList
          idPrefix="records"
          label="Registos clínicos"
          value={tab}
          onChange={setTab}
          className="flex gap-1.5 border-b border-dim-200 overflow-x-auto"
          tabClassName={(on) => `text-[13px] font-semibold px-4 py-2.5 -mb-px border-b-2 transition-colors whitespace-nowrap ${
            on ? "border-brand-700 text-brand-800" : "border-transparent text-dim-500 hover:text-dim-700"
          }`}
          tabs={[
            {
              key: "today" as const,
              label: (
                <>
                  Em consulta
                  {inConsult.length > 0 && (
                    <span className="ml-1.5 text-[10px] font-mono bg-violet-100 text-violet-700 rounded-full px-1.5 py-0.5">{inConsult.length}</span>
                  )}
                </>
              ),
            },
            { key: "history" as const, label: "Histórico" },
            ...(isAdmin ? [{ key: "access" as const, label: "Acessos entre clínicos" }] : []),
          ]}
        />
      )}

      <TabPanel idPrefix="records" tabKey={canConclude ? tab : undefined}>
      {tab === "today" && canConclude ? (
        <div className="flex flex-col gap-5">
          <QueueSection
            title="Em consulta"
            appts={inConsult}
            noteByAppt={noteByAppt}
            loading={apptsQ.isLoading}
            error={apptsQ.isError}
            conclude={conclude}
            empty="Sem pacientes com check-in feito neste momento."
            meId={me?.id}
            isAdmin={isAdmin}
            scopeToggle={!isAdmin ? { value: scope, onChange: changeScope } : undefined}
          />
          {done.length > 0 && (
            <QueueSection title="Concluídas hoje" appts={done} noteByAppt={noteByAppt} conclude={conclude} meId={me?.id} isAdmin={isAdmin} />
          )}
        </div>
      ) : tab === "access" ? (
        <AccessLogTab enabled={canView && isAdmin} />
      ) : (
        <HistoryTab enabled={canView} isAdmin={isAdmin} />
      )}
      </TabPanel>
    </div>
  );
}

// ─── Day queue ────────────────────────────────────────────────────────────────

function QueueSection({ title, appts, noteByAppt, conclude, loading, error, empty, meId, isAdmin, scopeToggle }: {
  title: string;
  appts: QueueAppointment[];
  noteByAppt: Map<string, NoteWithPatient>;
  conclude: ReturnType<typeof useConcludeAppointment>["conclude"];
  loading?: boolean;
  error?: boolean;
  empty?: string;
  meId?: string;
  isAdmin: boolean;
  scopeToggle?: { value: "mine" | "all"; onChange: (v: "mine" | "all") => void };
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [duration, setDuration] = useState("");

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
        <h2 className="font-display text-[14px] font-semibold text-dim-900">{title}</h2>
        <div className="flex items-center gap-3">
          {scopeToggle && (
            <div role="group" aria-label="Âmbito da fila" className="flex bg-dim-100 rounded-[8px] p-0.5">
              {([["mine", "Só os meus"], ["all", "Todos"]] as const).map(([k, label]) => (
                <button
                  key={k} type="button" aria-pressed={scopeToggle.value === k} onClick={() => scopeToggle.onChange(k)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-[6px] transition-colors ${scopeToggle.value === k ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="font-mono text-[11px] text-dim-400">{appts.length} consultas</span>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-dim-400 text-center py-10">A carregar…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600 text-center py-10">Erro ao carregar as marcações.</p>
      ) : !appts.length ? (
        <div className="py-12 text-center">
          <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-5 h-5 text-dim-400" />
          </div>
          <p className="text-[13px] text-dim-500">{empty}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {appts.map((a) => {
            const note = noteByAppt.get(a.id);
            const open = a.status === "checked_in";
            const finalNote = !!note && !isDraft(note);
            const name = a.patient.fullName ?? "Paciente";
            // Another clinician's patient (a doctor covering with "Todos"): notes are author-scoped, so
            // "Sem nota" would only mean "none *visible to you*" — say nothing until they write their own.
            const foreign = !!a.staff && !!meId && a.staff.id !== meId;
            const chipMeaningful = !!note || isAdmin || !foreign;
            return (
              <div key={a.id} className="px-5 py-3.5 border-b border-dim-100 last:border-0">
                <div className="flex items-center justify-between gap-x-4 gap-y-3 flex-wrap">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className="font-mono text-[12px] text-dim-500 w-11 shrink-0">{format(new Date(a.scheduledAt), "HH:mm", { locale: pt })}</span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-dim-900 truncate">{name}</p>
                      <p className="text-[11px] text-dim-500 mt-0.5 truncate">{a.service.name}{foreign && a.staff ? ` · ${a.staff.fullName}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {chipMeaningful && <NoteStateChip note={note} warn={!open} />}
                    <Link
                      href={`/records/note?appointmentId=${a.id}`}
                      className={`text-[12px] font-semibold px-3.5 py-2 rounded-[8px] transition-colors shrink-0 ${
                        open && !finalNote ? "bg-brand-700 hover:bg-brand-800 text-white" : "border border-dim-200 text-dim-700 hover:bg-dim-50"
                      }`}
                    >
                      {!note ? "Registar" : isDraft(note) ? "Continuar rascunho" : "Ver nota"}
                    </Link>
                    {open && completingId !== a.id && (
                      <button
                        onClick={() => { setCompletingId(a.id); setDuration(String(a.durationMinutes)); }}
                        className={`text-[12px] font-semibold px-3.5 py-2 rounded-[8px] transition-colors shrink-0 ${
                          finalNote ? "bg-brand-700 hover:bg-brand-800 text-white" : "border border-dim-200 text-dim-700 hover:bg-dim-50"
                        }`}
                      >
                        Concluir
                      </button>
                    )}
                  </div>
                </div>

                {open && completingId === a.id && (
                  <div className="mt-3 p-4 bg-emerald-50 border border-emerald-200 rounded-[14px] flex flex-col gap-3">
                    <p className="text-[12px] font-semibold text-emerald-800">Confirmar duração da consulta</p>
                    {!finalNote && (
                      <p className="text-[11px] text-amber-700 -mt-1.5">Esta consulta ainda não tem nota clínica finalizada.</p>
                    )}
                    <p className="text-[11px] text-dim-500 -mt-1.5">Gera automaticamente um rascunho de fatura com o valor calculado a partir da duração confirmada.</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={1} max={480} inputMode="numeric"
                        value={duration} onChange={(e) => setDuration(e.target.value)}
                        aria-label="Duração em minutos"
                        className="w-full max-w-[110px] border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all"
                      />
                      <span className="text-[12px] text-dim-500">minutos</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={conclude.isPending || !duration || Number(duration) <= 0}
                        onClick={() => conclude.mutate({ id: a.id, durationMinutes: Number(duration), patientName: name }, { onSuccess: () => setCompletingId(null) })}
                        className="flex-1 text-[12px] font-semibold py-2.5 rounded-[8px] bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
                      >
                        {conclude.isPending ? "A concluir…" : "Confirmar Conclusão"}
                      </button>
                      <button
                        onClick={() => setCompletingId(null)}
                        className="flex-1 text-[12px] font-semibold py-2.5 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NoteStateChip({ note, warn }: { note?: NoteWithPatient; warn: boolean }) {
  if (note && isDraft(note)) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/80">Rascunho</span>;
  if (note) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">Nota guardada</span>;
  // Once the consulta is completed, a missing note is something to catch; while it's open, it's just not written yet.
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${warn ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" : "bg-dim-100 text-dim-500"}`}>Sem nota</span>;
}

// ─── History ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const RANGES = [
  ["", "Todo o período"],
  ["today", "Hoje"],
  ["7", "Últimos 7 dias"],
  ["30", "Últimos 30 dias"],
] as const;

function HistoryTab({ enabled, isAdmin }: { enabled: boolean; isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<"" | RiskLevel>("");
  const [status, setStatus] = useState<"" | "draft" | "final">("");
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("");
  const dq = useDebouncedValue(q.trim(), 300);

  const from = range === "" ? "" : format(range === "today" ? new Date() : subDays(new Date(), Number(range) - 1), "yyyy-MM-dd");
  const params = new URLSearchParams({ ...(dq && { q: dq }), ...(risk && { riskLevel: risk }), ...(status && { status }), ...(from && { from }) });
  const filtered = params.size > 0;

  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["clinical-notes", "mine", params.toString()],
    queryFn: ({ pageParam }) =>
      fetchJson<NoteWithPatient[]>(`/api/clinical-notes?${new URLSearchParams({ ...Object.fromEntries(params), page: String(pageParam), limit: String(PAGE_SIZE) })}`),
    initialPageParam: 1,
    // A short page means there is nothing more (the API returns a plain array).
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length + 1 : undefined),
    enabled,
  });
  // Offset paging can repeat a row at a page boundary if a note lands while browsing.
  const notes = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flat() ?? []).filter((n) => !seen.has(n.id) && seen.add(n.id));
  }, [data]);

  return (
    <div className={CARD}>
      <div className="flex flex-col gap-3 px-5 py-4 border-b border-dim-100">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[14px] font-semibold text-dim-900">Notas</h2>
          <span className="font-mono text-[11px] text-dim-400">{notes.length}{hasNextPage ? "+" : ""} notas</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-dim-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar paciente…" aria-label="Pesquisar paciente"
              className="w-full border border-dim-200 rounded-[10px] pl-9 pr-3 py-2 text-[12px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 hover:border-dim-300"
            />
          </div>
          <select value={risk} onChange={(e) => setRisk(e.target.value as "" | RiskLevel)} aria-label="Filtrar por risco" className={selectCls}>
            <option value="">Todos os riscos</option>
            {(Object.keys(RISK_META) as RiskLevel[]).map((k) => <option key={k} value={k}>{RISK_META[k].label}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | "draft" | "final")} aria-label="Filtrar por estado" className={selectCls}>
            <option value="">Todos os estados</option>
            <option value="draft">Rascunhos</option>
            <option value="final">Finalizadas</option>
          </select>
          <select value={range} onChange={(e) => setRange(e.target.value as typeof range)} aria-label="Filtrar por período" className={selectCls}>
            {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-dim-400 text-center py-10">A carregar…</p>
      ) : isError ? (
        <p className="text-[13px] text-red-600 text-center py-10">Erro ao carregar as notas.</p>
      ) : !notes.length ? (
        <div className="py-12 text-center">
          <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
            <ClipboardList className="w-5 h-5 text-dim-400" />
          </div>
          {filtered ? (
            <>
              <p className="text-[13px] text-dim-500">Nenhuma nota com estes filtros.</p>
              <button onClick={() => { setQ(""); setRisk(""); setStatus(""); setRange(""); }} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 mt-1.5">
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              <p className="text-[13px] text-dim-500">Ainda sem notas clínicas.</p>
              <p className="text-[12px] text-dim-400 mt-1">Registe a primeira a partir de «Em consulta» ou da página de um paciente.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {notes.map((n) => {
            const preview = notePreview(n);
            return (
              <Link
                key={n.id}
                href={`/records/note?noteId=${n.id}`}
                className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-dim-100 last:border-0 hover:bg-dim-50 transition-colors group"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-800 font-semibold text-[11px] flex items-center justify-center shrink-0">
                    {n.patient?.fullName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-dim-900 truncate flex items-center gap-2">
                      <span className="truncate">{n.patient?.fullName ?? "Paciente"}</span>
                      <NoteStateBadges note={n} isAdmin={isAdmin} />
                    </p>
                    <p className="text-[11px] text-dim-500 mt-0.5">
                      {sessionTypeLabel(n.sessionType)} · {format(new Date(n.finalizedAt ?? n.createdAt), "d MMM yyyy, HH:mm", { locale: pt })}
                    </p>
                    {preview && <p className="text-[12px] text-dim-500 mt-1 truncate">{preview}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <RiskBadge level={n.riskLevel} />
                  <ChevronRight className="w-3.5 h-3.5 text-dim-300 group-hover:text-dim-500 transition-colors" />
                </div>
              </Link>
            );
          })}
          {hasNextPage && (
            <div className="px-5 py-3 border-t border-dim-100 text-center">
              <button
                onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
                className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50 transition-colors"
              >
                {isFetchingNextPage ? "A carregar…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
