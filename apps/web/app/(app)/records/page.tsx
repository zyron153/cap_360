"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import type { ClinicalNoteEntry } from "@cap/types";
import { usePermissions } from "../hooks/use-permissions";

type NoteWithPatient = ClinicalNoteEntry & { patient?: { fullName: string } };

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
  const { isLoading: permLoading, isAdmin, me } = usePermissions();
  const router = useRouter();
  const canView = isAdmin || me?.role === "doctor";
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  const { data: notes, isLoading } = useQuery({
    queryKey: ["clinical-notes", "mine"],
    queryFn: fetchNotes,
    enabled: canView,
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900">Registos Clínicos</h1>
        <p className="text-[13px] text-dim-500 mt-0.5">
          {isAdmin ? "Todas as notas clínicas recentes" : "As suas notas clínicas recentes, em todos os pacientes"}
        </p>
      </div>

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
    </div>
  );
}
