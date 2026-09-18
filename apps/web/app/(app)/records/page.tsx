"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import { ClipboardList, ChevronRight, CheckCircle2 } from "lucide-react";
import type { ClinicalNoteEntry } from "@cap/types";
import { usePermissions } from "../hooks/use-permissions";
import { useMessage } from "../../../components/ui/message-handler";

type NoteWithPatient = ClinicalNoteEntry & { patient?: { fullName: string } };

type ToConcludeAppointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  patient: { fullName: string };
  service: { name: string };
};

async function fetchTodayAppointments(): Promise<ToConcludeAppointment[]> {
  const today = format(new Date(), "yyyy-MM-dd");
  const params = new URLSearchParams({ from: today, to: today });
  const res = await fetch(`/api/appointments?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar marcações");
  return res.json();
}

const RISK_META: Record<string, { label: string; cls: string }> = {
  none:     { label: "Sem risco",  cls: "bg-dim-100 text-dim-500" },
  low:      { label: "Baixo",      cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  moderate: { label: "Moderado",   cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80" },
  high:     { label: "Elevado",    cls: "bg-red-50 text-red-700 ring-1 ring-red-200/80" },
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

async function fetchNotes(): Promise<NoteWithPatient[]> {
  const res = await fetch("/api/clinical-notes");
  if (!res.ok) throw new Error("Erro ao carregar notas");
  return res.json();
}

export default function RecordsPage() {
  const { isLoading: permLoading, isAdmin, me, can } = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const canView = isAdmin || me?.role === "doctor";
  const canConclude = can("appointments");
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  const [tab, setTab] = useState<"notes" | "toconclude">("notes");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeDuration, setCompleteDuration] = useState("");

  const { data: notes, isLoading } = useQuery({
    queryKey: ["clinical-notes", "mine"],
    queryFn: fetchNotes,
    enabled: canView,
  });

  const { data: todayAppointments, isLoading: apptsLoading } = useQuery({
    queryKey: ["appointments", "calendar", "today-checked-in"],
    queryFn: fetchTodayAppointments,
    enabled: canView && canConclude && tab === "toconclude",
  });
  const toConclude = (todayAppointments ?? []).filter((a) => a.status === "checked_in");

  const completeMutation = useMutation({
    mutationFn: ({ id, durationMinutes }: { id: string; durationMinutes: number }) =>
      fetch(`/api/appointments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", durationMinutes }),
      }).then(async (r) => {
        if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro"); }
        return r.json();
      }),
    onSuccess: (data: { invoiceWarning?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setCompletingId(null);
      addMessage(data?.invoiceWarning ? "Warning" : "Success", data?.invoiceWarning ?? "Consulta concluída e fatura gerada com sucesso!");
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900">Registos Clínicos</h1>
        <p className="text-[13px] text-dim-500 mt-0.5">
          {isAdmin ? "Todas as notas clínicas recentes" : "As suas notas clínicas recentes, em todos os pacientes"}
        </p>
      </div>

      {canConclude && (
        <div className="flex gap-1.5 border-b border-dim-200">
          {([
            { key: "notes", label: "Notas Recentes" },
            { key: "toconclude", label: "Check-in Feito" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-[13px] font-semibold px-4 py-2.5 -mb-px border-b-2 transition-colors ${
                tab === key ? "border-brand-700 text-brand-800" : "border-transparent text-dim-500 hover:text-dim-700"
              }`}
            >
              {label}
              {key === "toconclude" && toConclude.length > 0 && (
                <span className="ml-1.5 text-[10px] font-mono bg-violet-100 text-violet-700 rounded-full px-1.5 py-0.5">{toConclude.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === "toconclude" && canConclude ? (
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Prontas a Concluir Hoje</h2>
            <span className="font-mono text-[11px] text-dim-400">{toConclude.length} consultas</span>
          </div>

          {apptsLoading ? (
            <p className="text-[13px] text-dim-400 text-center py-10">A carregar…</p>
          ) : !toConclude.length ? (
            <div className="py-12 text-center">
              <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-5 h-5 text-dim-400" />
              </div>
              <p className="text-[13px] text-dim-500">Sem consultas com check-in feito hoje.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {toConclude.map((a) => (
                <div key={a.id} className="px-5 py-3.5 border-b border-dim-100 last:border-0">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-dim-900 truncate">{a.patient.fullName}</p>
                      <p className="text-[11px] text-dim-500 mt-0.5">{a.service.name} · {format(new Date(a.scheduledAt), "HH:mm", { locale: pt })}</p>
                    </div>
                    {completingId !== a.id && (
                      <button
                        onClick={() => { setCompletingId(a.id); setCompleteDuration(String(a.durationMinutes)); }}
                        className="text-[12px] font-semibold px-3 py-1.5 rounded-[8px] bg-brand-700 hover:bg-brand-800 text-white transition-colors shrink-0"
                      >
                        Concluir
                      </button>
                    )}
                  </div>

                  {completingId === a.id && (
                    <div className="mt-3 p-4 bg-emerald-50 border border-emerald-200 rounded-[14px] flex flex-col gap-3">
                      <p className="text-[12px] font-semibold text-emerald-800">Confirmar duração da consulta</p>
                      <p className="text-[11px] text-dim-500 -mt-1.5">Gera automaticamente um rascunho de fatura com o valor calculado a partir da duração confirmada.</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={480}
                          value={completeDuration}
                          onChange={(e) => setCompleteDuration(e.target.value)}
                          className="w-full max-w-[110px] border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all"
                        />
                        <span className="text-[12px] text-dim-500">minutos</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={completeMutation.isPending || !completeDuration || Number(completeDuration) <= 0}
                          onClick={() => completeMutation.mutate({ id: a.id, durationMinutes: Number(completeDuration) })}
                          className="flex-1 text-[12px] font-semibold py-2 rounded-[8px] bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
                        >
                          {completeMutation.isPending ? "A concluir…" : "Confirmar Conclusão"}
                        </button>
                        <button
                          onClick={() => setCompletingId(null)}
                          className="flex-1 text-[12px] font-semibold py-2 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors"
                        >
                          Voltar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className={CARD}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
          <h2 className="font-display text-[14px] font-semibold text-dim-900">Notas Recentes</h2>
          <span className="font-mono text-[11px] text-dim-400">{notes?.length ?? 0} notas</span>
        </div>

        {isLoading ? (
          <p className="text-[13px] text-dim-400 text-center py-10">A carregar…</p>
        ) : !notes?.length ? (
          <div className="py-12 text-center">
            <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
              <ClipboardList className="w-5 h-5 text-dim-400" />
            </div>
            <p className="text-[13px] text-dim-500">Ainda sem notas clínicas.</p>
            <p className="text-[12px] text-dim-400 mt-1">Crie uma a partir da página de um paciente.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {notes.map((n) => (
              <Link
                key={n.id}
                href={`/patients/${n.patientId}`}
                className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-dim-100 last:border-0 hover:bg-dim-50 transition-colors group"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-800 font-semibold text-[11px] flex items-center justify-center shrink-0">
                    {n.patient?.fullName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-dim-900 truncate">{n.patient?.fullName ?? "Paciente"}</p>
                    <p className="text-[11px] text-dim-500 mt-0.5 capitalize">{n.sessionType} · {format(new Date(n.createdAt), "d MMM yyyy, HH:mm", { locale: pt })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${RISK_META[n.riskLevel]?.cls ?? ""}`}>{RISK_META[n.riskLevel]?.label ?? n.riskLevel}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-dim-300 group-hover:text-dim-500 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
