"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import type { ClinicalAccessLogEntry } from "@cap/types";
import { fetchJson, formatCvDateTime } from "./_note-shared";
import { useStaffList } from "./_staff-list";

const PAGE_SIZE = 50;
const COLS = "md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]";

/** The API's `basis` is a stable English phrase; show the clinic's wording for the ones it knows. */
const BASIS_LABEL: Record<string, string> = { "patient in treatment today": "Paciente em consulta hoje" };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Admin report: every time a clinician read another clinician's finalized notes under the "patient in treatment
 * today" exception (M7 §3.1). Newest first, paged with "Carregar mais" like the history tab.
 */
export function AccessLogTab({ enabled }: { enabled: boolean }) {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery({
    queryKey: ["clinical-access-log"],
    queryFn: ({ pageParam }) =>
      fetchJson<ClinicalAccessLogEntry[]>(`/api/clinical-notes/access-log?${new URLSearchParams({ page: String(pageParam), limit: String(PAGE_SIZE) })}`),
    initialPageParam: 1,
    // A short page means there is nothing more (the API returns a plain array).
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.length + 1 : undefined),
    enabled,
  });
  // Only used to put a name to "the author of the note that was read" (the log carries the author's id).
  const staffQ = useStaffList(enabled);
  const staffName = useMemo(() => new Map((staffQ.data ?? []).map((s) => [s.id, s.fullName])), [staffQ.data]);

  // Offset paging can repeat a row at a page boundary if a read lands while browsing.
  const entries = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flat() ?? []).filter((e) => !seen.has(e.id) && seen.add(e.id));
  }, [data]);

  return (
    <section className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden" aria-labelledby="access-log-title">
      <div className="px-5 py-4 border-b border-dim-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="access-log-title" className="font-display text-[14px] font-semibold text-dim-900">Acessos entre clínicos</h2>
          <span className="font-mono text-[11px] text-dim-400">{entries.length}{hasNextPage ? "+" : ""} {plural(entries.length, "leitura", "leituras")}</span>
        </div>
        <p className="text-[12px] text-dim-500 mt-1">
          Cada vez que um clínico leu notas finalizadas de outro autor — permitido apenas enquanto o paciente está em consulta hoje — fica registado aqui, para o administrador rever.
        </p>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-dim-400 text-center py-10">A carregar…</p>
      ) : isError ? (
        <div className="py-10 text-center">
          <p role="alert" className="text-[13px] text-red-600">Erro ao carregar o registo de acessos.</p>
          <button type="button" onClick={() => refetch()} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 mt-1.5">Tentar novamente</button>
        </div>
      ) : !entries.length ? (
        <div className="py-12 text-center">
          <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
            <Eye className="w-5 h-5 text-dim-400" aria-hidden />
          </div>
          <p className="text-[13px] text-dim-500">Nenhum clínico leu notas de outro autor até agora.</p>
          <p className="text-[12px] text-dim-400 mt-1">As leituras aparecem aqui assim que acontecerem.</p>
        </div>
      ) : (
        <div role="table" aria-label="Leituras de notas de outros autores">
          <div role="rowgroup" className="hidden md:block">
            <div role="row" className={`grid ${COLS} gap-3 px-5 py-2 bg-dim-50 border-b border-dim-100 text-[10px] font-bold uppercase tracking-wide text-dim-400`}>
              <span role="columnheader">Quando</span>
              <span role="columnheader">Quem leu</span>
              <span role="columnheader">Paciente</span>
              <span role="columnheader">Base e detalhe</span>
            </div>
          </div>
          <div role="rowgroup">
            {entries.map((e) => {
              const reader = e.reader.fullName ?? e.reader.email ?? "Clínico removido";
              const author = e.note ? staffName.get(e.note.authorStaffId) : undefined;
              return (
                <div key={e.id} role="row" className={`grid grid-cols-1 ${COLS} gap-x-3 gap-y-1 px-5 py-3.5 border-b border-dim-100 last:border-0 text-[12px]`}>
                  <span role="cell" className="font-mono text-dim-500">{formatCvDateTime(e.at)}</span>
                  <span role="cell" className="text-dim-900 font-medium break-words">
                    <span className="md:hidden text-dim-400 font-normal" aria-hidden>Leu: </span>{reader}
                  </span>
                  <span role="cell" className="break-words">
                    <span className="md:hidden text-dim-400" aria-hidden>Paciente: </span>
                    {!e.patient ? (
                      <span className="text-dim-500">Paciente não identificado</span>
                    ) : e.patient.fullName === null ? (
                      <span className="text-dim-500 italic">Paciente removido</span>
                    ) : (
                      <Link href={`/patients/${e.patient.id}`} className="text-brand-700 hover:text-brand-800 font-medium hover:underline">{e.patient.fullName}</Link>
                    )}
                  </span>
                  <span role="cell" className="text-dim-600 break-words">
                    {BASIS_LABEL[e.basis] ?? e.basis}
                    {e.otherAuthorsNotes != null && ` · ${e.otherAuthorsNotes} ${plural(e.otherAuthorsNotes, "nota", "notas")} de outros autores (lista do paciente)`}
                    {e.note && ` · nota${author ? ` de ${author}` : " de outro autor"} (aberta diretamente)`}
                  </span>
                </div>
              );
            })}
          </div>
          {(hasNextPage || isFetchNextPageError) && (
            <div className="px-5 py-3 border-t border-dim-100 text-center">
              {isFetchNextPageError && <p role="alert" className="text-[12px] text-red-600 mb-1">Não foi possível carregar mais leituras.</p>}
              <button
                type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
                className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50 transition-colors"
              >
                {isFetchingNextPage ? "A carregar…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
