"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import type { OutstandingBalanceEntry, PaginatedResponse } from "@cap/types";

async function fetchOutstandingBalances(page: number) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  const res = await fetch(`/api/financeiro/saldos?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar saldos em aberto");
  return res.json() as Promise<PaginatedResponse<OutstandingBalanceEntry>>;
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[160, 70, 90, 100, 40].map((w, i) => (
        <td key={i} className="px-5 py-3.5 border-b border-dim-100">
          <div className="h-3 bg-dim-100 rounded inline-block" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export function SaldosTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["outstanding-balances", page],
    queryFn: () => fetchOutstandingBalances(page),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const totalOwed = data?.data.reduce((sum, row) => sum + row.totalDue, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-dim-500">
          {isLoading ? "A carregar…" : error ? "Erro ao carregar saldos" : `${data?.total ?? 0} pacientes com saldo em aberto`}
        </p>
        {!isLoading && !error && (
          <p className="text-[13px] font-semibold text-dim-900">
            {totalOwed.toLocaleString("pt-CV")} <span className="text-[11px] font-normal text-dim-400">CVE nesta página</span>
          </p>
        )}
      </div>

      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Paciente", "Faturas", "Vencidas", "Saldo em Dívida", "Em dívida desde", ""].map((h) => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : error
                ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-700">Erro ao carregar saldos</p>
                    </td>
                  </tr>
                )
                : data?.data.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <div className="w-12 h-12 bg-emerald-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <Wallet className="w-6 h-6 text-emerald-500" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-600">Nenhum paciente com saldo em aberto</p>
                    </td>
                  </tr>
                )
                : data?.data.map((row) => (
                    <tr key={row.patientId} className="hover:bg-dim-50 transition-colors group">
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <Link href={`/patients/${row.patientId}`} className="text-[13px] font-medium text-dim-900 hover:text-brand-700 transition-colors">
                          {row.patientName}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] text-dim-600 tabular-nums">
                        {row.invoiceCount}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        {row.overdueCount > 0 ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 ring-1 ring-red-200/80">
                            {row.overdueCount} vencida{row.overdueCount > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-[11px] text-dim-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[13px] font-semibold text-red-600 tabular-nums">
                        {row.totalDue.toLocaleString("pt-CV")}
                        <span className="text-[10px] font-normal text-dim-400 ml-1">CVE</span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">
                        {row.oldestDueDate ? format(new Date(row.oldestDueDate), "d MMM yyyy", { locale: pt }) : "—"}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <Link
                          href={`/patients/${row.patientId}`}
                          className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Ver paciente →
                        </Link>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3.5 border-t border-dim-100 flex items-center justify-between">
            <span className="text-[12px] text-dim-500">
              {data.total} pacientes · Página <span className="font-semibold text-dim-700">{page}</span> de {data.totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={page === data.totalPages} onClick={() => setPage((p) => p + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
