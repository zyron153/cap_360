"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, Clock, CalendarX } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { FinanceiroSummary } from "@cap/types";

async function fetchSummary(from: string, to: string): Promise<FinanceiroSummary> {
  const res = await fetch(`/api/financeiro/summary?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("Erro ao carregar resumo financeiro");
  return res.json();
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "border border-dim-200 rounded-[10px] px-3 py-1.5 text-[12px] text-dim-900 bg-white focus:outline-none focus:border-brand-500";

const EMERALD = "#10B981";
const RED = "#EF4444";
const BRAND = "#0D8080";
const AMBER = "#F59E0B";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return format(new Date(y, m - 1, 1), "MMM/yy", { locale: pt });
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type RangeMode = "month" | "quarter" | "year" | "custom";
const RANGE_LABELS: Record<RangeMode, string> = {
  month: "Este mês", quarter: "Últimos 3 meses", year: "Este ano", custom: "Personalizado",
};

/** Bar-list breakdown, matching the existing "Despesas por Categoria" visual exactly — chosen so
 * every proportion-of-whole breakdown on this page (payer type, service, expense category) reads
 * as one consistent language rather than a new chart type per section. */
function BarList({ rows, color = BRAND }: { rows: { label: string; total: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-[12px] font-medium text-dim-700 truncate">{r.label}</span>
          <div className="flex-1 h-2.5 bg-dim-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, backgroundColor: color }} />
          </div>
          <span className="w-28 shrink-0 text-right font-mono text-[12px] font-semibold text-dim-900 tabular-nums">
            {r.total.toLocaleString("pt-CV")} <span className="text-dim-400 font-normal">CVE</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ResumoTab() {
  const [rangeMode, setRangeMode] = useState<RangeMode>("year");
  const today = useMemo(() => new Date(), []);
  const [customFrom, setCustomFrom] = useState(fmtDate(new Date(today.getFullYear(), 0, 1)));
  const [customTo, setCustomTo] = useState(fmtDate(today));

  const { from, to } = useMemo(() => {
    if (rangeMode === "custom") return { from: customFrom, to: customTo };
    if (rangeMode === "month") return { from: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtDate(today) };
    if (rangeMode === "quarter") return { from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)), to: fmtDate(today) };
    return { from: fmtDate(new Date(today.getFullYear(), 0, 1)), to: fmtDate(today) };
  }, [rangeMode, customFrom, customTo, today]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["financeiro-summary", from, to],
    queryFn: () => fetchSummary(from, to),
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
  const payerRows = [
    { label: "Privado", total: data.byPayerType.privado },
    { label: "Plano de Saúde / Empresa", total: data.byPayerType.planoSaude },
  ];
  const serviceRows = data.byService.map((s) => ({ label: s.service, total: s.total }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-dim-500">
          Período: <span className="font-semibold text-dim-700">{format(new Date(`${from}T12:00:00`), "dd/MM/yyyy")} – {format(new Date(`${to}T12:00:00`), "dd/MM/yyyy")}</span>
        </p>
        <div className="flex items-center gap-2">
          <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)} className={inputCls}>
            {(Object.keys(RANGE_LABELS) as RangeMode[]).map((m) => <option key={m} value={m}>{RANGE_LABELS[m]}</option>)}
          </select>
          {rangeMode === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={inputCls} />
              <span className="text-dim-400 text-[12px]">–</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={inputCls} />
            </>
          )}
        </div>
      </div>

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
        <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Contas a Receber</h3>
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim-400">valor atual — não depende do período</span>
        </div>
        <div className="px-5 py-5 grid grid-cols-3 gap-6">
          <div>
            <p className="font-display font-bold text-[20px] text-dim-900 leading-none">{data.receivables.totalOutstanding.toLocaleString("pt-CV")}</p>
            <p className="text-[11px] text-dim-500 mt-1">Total em aberto (CVE)</p>
          </div>
          <div>
            <p className={`font-display font-bold text-[20px] leading-none ${data.receivables.totalOverdue > 0 ? "text-red-600" : "text-dim-900"}`}>
              {data.receivables.totalOverdue.toLocaleString("pt-CV")}
            </p>
            <p className="text-[11px] text-dim-500 mt-1">Em atraso (CVE)</p>
          </div>
          <div>
            <p className={`font-display font-bold text-[20px] leading-none ${data.receivables.overdueCount > 0 ? "text-red-600" : "text-dim-900"}`}>
              {data.receivables.overdueCount}
            </p>
            <p className="text-[11px] text-dim-500 mt-1">Faturas em atraso</p>
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
        <div className="px-5 py-4">
          {data.byCategory.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Sem despesas aprovadas ainda.</p>
          ) : (
            <BarList rows={data.byCategory.map(c => ({ label: c.category, total: c.total }))} color={BRAND} />
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Receita por Tipo de Pagador</h3>
          <p className="text-[11px] text-dim-400 mt-0.5">Pagamentos de faturas — privado vs. plano de saúde/empresa</p>
        </div>
        <div className="px-5 py-4">
          {payerRows.every(r => r.total === 0) ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Sem pagamentos de faturas neste período.</p>
          ) : (
            <BarList rows={payerRows} color={EMERALD} />
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Receita por Tipo de Serviço</h3>
          <p className="text-[11px] text-dim-400 mt-0.5">Valor faturado por serviço, no período</p>
        </div>
        <div className="px-5 py-4">
          {serviceRows.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Sem faturas emitidas neste período.</p>
          ) : (
            <BarList rows={serviceRows} color={BRAND} />
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Impacto Financeiro de Faltas</h3>
        </div>
        <div className="px-5 py-5 flex items-center gap-5">
          <div className="w-11 h-11 bg-amber-50 rounded-[12px] flex items-center justify-center shrink-0">
            <CalendarX className="text-amber-600" style={{ width: 20, height: 20 }} />
          </div>
          <div className="flex items-center gap-8">
            <div>
              <p className="font-display font-bold text-[20px] text-dim-900 leading-none">{data.noShowImpact.count}</p>
              <p className="text-[11px] text-dim-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Faltas no período</p>
            </div>
            <div>
              <p className="font-display font-bold text-[20px] leading-none" style={{ color: data.noShowImpact.lostRevenue > 0 ? AMBER : undefined }}>
                {data.noShowImpact.lostRevenue.toLocaleString("pt-CV")} <span className="text-[13px] font-normal text-dim-400">CVE</span>
              </p>
              <p className="text-[11px] text-dim-500 mt-1">Receita não faturada</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
