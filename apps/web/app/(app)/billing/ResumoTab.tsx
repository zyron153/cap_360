"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { TrendingUp, TrendingDown, Wallet, AlertCircle } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { FinanceiroSummary } from "@cap/types";

async function fetchSummary(): Promise<FinanceiroSummary> {
  const res = await fetch("/api/financeiro/summary");
  if (!res.ok) throw new Error("Erro ao carregar resumo financeiro");
  return res.json();
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const EMERALD = "#10B981";
const RED = "#EF4444";
const BRAND = "#0D8080";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return format(new Date(y, m - 1, 1), "MMM/yy", { locale: pt });
}

export function ResumoTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["financeiro-summary"],
    queryFn: fetchSummary,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className={`${CARD} h-28 animate-pulse`} />)}
        </div>
        <div className={`${CARD} h-72 animate-pulse`} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={CARD}>
        <div className="py-16 text-center">
          <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-[13px] font-medium text-dim-700">Erro ao carregar resumo financeiro</p>
        </div>
      </div>
    );
  }

  const positive = data.balance >= 0;
  const maxCategory = Math.max(1, ...data.byCategory.map(c => c.total));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-4">
        <div className={CARD}>
          <div className="px-5 py-5">
            <div className="w-9 h-9 bg-emerald-50 rounded-[10px] flex items-center justify-center mb-3">
              <TrendingUp className="text-emerald-600" style={{ width: 18, height: 18 }} />
            </div>
            <p className="font-display font-bold text-[22px] text-dim-900 leading-none">{data.totalEntradas.toLocaleString("pt-CV")}</p>
            <p className="text-[12px] font-semibold text-dim-700 mt-1">Total Entradas</p>
            <p className="text-[11px] text-dim-400 mt-0.5">CVE recebidos (faturas + manuais)</p>
          </div>
        </div>
        <div className={CARD}>
          <div className="px-5 py-5">
            <div className="w-9 h-9 bg-red-50 rounded-[10px] flex items-center justify-center mb-3">
              <TrendingDown className="text-red-500" style={{ width: 18, height: 18 }} />
            </div>
            <p className="font-display font-bold text-[22px] text-dim-900 leading-none">{data.totalDespesas.toLocaleString("pt-CV")}</p>
            <p className="text-[12px] font-semibold text-dim-700 mt-1">Total Despesas</p>
            <p className="text-[11px] text-dim-400 mt-0.5">CVE em despesas aprovadas</p>
          </div>
        </div>
        <div className={CARD}>
          <div className="px-5 py-5">
            <div className={`w-9 h-9 ${positive ? "bg-brand-50" : "bg-red-50"} rounded-[10px] flex items-center justify-center mb-3`}>
              <Wallet className={positive ? "text-brand-600" : "text-red-500"} style={{ width: 18, height: 18 }} />
            </div>
            <p className={`font-display font-bold text-[22px] leading-none ${positive ? "text-dim-900" : "text-red-600"}`}>
              {positive ? "" : "-"}{Math.abs(data.balance).toLocaleString("pt-CV")}
            </p>
            <p className="text-[12px] font-semibold text-dim-700 mt-1">Saldo</p>
            <p className="text-[11px] text-dim-400 mt-0.5">Entradas − despesas, no período</p>
          </div>
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Entradas vs. Despesas por Mês</h3>
        </div>
        <div className="px-5 py-5">
          {data.monthly.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-10">Sem movimentos registados ainda.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthly.map(m => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E8F0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8E8EA8" }} axisLine={{ stroke: "#E8E8F0" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8E8EA8" }} axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  formatter={(v: number) => `${v.toLocaleString("pt-CV")} CVE`}
                  contentStyle={{ borderRadius: 10, border: "1px solid #E8E8F0", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === "entradas" ? "Entradas" : "Despesas"} />
                <Bar dataKey="entradas" fill={EMERALD} radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesas" fill={RED} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Despesas por Categoria</h3>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          {data.byCategory.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Sem despesas aprovadas ainda.</p>
          ) : (
            data.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-[12px] font-medium text-dim-700 truncate">{c.category}</span>
                <div className="flex-1 h-2.5 bg-dim-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(c.total / maxCategory) * 100}%`, backgroundColor: BRAND }} />
                </div>
                <span className="w-28 shrink-0 text-right font-mono text-[12px] font-semibold text-dim-900 tabular-nums">
                  {c.total.toLocaleString("pt-CV")} <span className="text-dim-400 font-normal">CVE</span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
