"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { TrendingUp, Users, Calendar, Banknote } from "lucide-react";
import type { FinanceiroSummary, AnalyticsSummary } from "@cap/types";
import { usePermissions } from "../hooks/use-permissions";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "border border-dim-200 rounded-[10px] px-3 py-1.5 text-[12px] text-dim-900 bg-white focus:outline-none focus:border-brand-500";

// Cycled by index for plan-distribution segments — "Particular" always pinned to slate below.
const PALETTE = ["#0f9191", "#6d28d9", "#f59e0b", "#e11d48", "#0ea5e9", "#10b981", "#6366f1", "#ec4899"];
const PARTICULAR_COLOR = "#94a3b8";

type RangeMode = "month" | "quarter" | "year" | "custom";
const RANGE_LABELS: Record<RangeMode, string> = {
  month: "Este mês", quarter: "Últimos 3 meses", year: "Este ano", custom: "Personalizado",
};

function fmtDateParam(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return format(new Date(y, m - 1, 1), "MMM", { locale: pt });
}

/** Turns FinanceiroSummary.monthly (real Entradas, faturas pagas + manuais) into an {x,y,value,label} point series. */
function buildRevenueChart(monthly: FinanceiroSummary["monthly"]) {
  const REV_CHART_H = 90;
  const points = monthly.map((m) => ({ month: m.month, value: m.entradas, label: monthLabel(m.month) }));
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values);
  const min = values.length ? Math.min(0, ...values) : 0;
  const range = Math.max(1, max - min);
  const gap = points.length > 1 ? 480 / (points.length - 1) : 0;
  const plotted = points.map((p, i) => ({
    ...p,
    x: 10 + i * gap,
    y: 100 - ((p.value - min) / range) * REV_CHART_H,
  }));
  const line = plotted.length
    ? plotted.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : "";
  const area = plotted.length ? `${line} L ${plotted[plotted.length - 1].x},100 L 10,100 Z` : "";
  const guides = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * range);
  return { plotted, line, area, min, max, guides };
}

/** Turns appointmentsByMonth into the same {x,y,w,h,label,value} bar shape the page's SVG expects. */
function buildApptBars(monthly: AnalyticsSummary["appointmentsByMonth"]) {
  const BAR_H = 130, BAR_W = 36, BAR_GAP = 9;
  const slot = BAR_W + BAR_GAP;
  const max = Math.max(1, ...monthly.map((m) => m.count));
  const totalW = Math.max(1, monthly.length) * slot - BAR_GAP;
  const offset = (560 - totalW) / 2;
  return monthly.map((m, i) => {
    const h = (m.count / max) * BAR_H;
    return { x: offset + i * slot, y: 10 + BAR_H - h, w: BAR_W, h, label: monthLabel(m.month), value: m.count };
  });
}

function donutSegments(dist: AnalyticsSummary["planDistribution"]) {
  const DONUT_R = 44;
  const DONUT_C = 2 * Math.PI * DONUT_R;
  let offset = 0;
  return dist.map((d, i) => {
    const dash = (d.pct / 100) * DONUT_C;
    const gap = DONUT_C - dash;
    const color = d.label === "Particular" ? PARTICULAR_COLOR : PALETTE[i % PALETTE.length];
    const seg = { ...d, dash, gap, offset: -offset, color };
    offset += dash;
    return seg;
  });
}

async function fetchFinanceiroSummary(from: string, to: string): Promise<FinanceiroSummary> {
  const res = await fetch(`/api/financeiro/summary?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("Erro ao carregar resumo financeiro");
  return res.json();
}

async function fetchAnalyticsSummary(from: string, to: string): Promise<AnalyticsSummary> {
  const res = await fetch(`/api/analytics/summary?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("Erro ao carregar resumo de analytics");
  return res.json();
}

export default function AnalyticsPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("analytics")) router.replace("/dashboard");
  }, [permLoading, can, router]);

  const [rangeMode, setRangeMode] = useState<RangeMode>("year");
  const today = useMemo(() => new Date(), []);
  const [customFrom, setCustomFrom] = useState(fmtDateParam(new Date(today.getFullYear(), 0, 1)));
  const [customTo, setCustomTo] = useState(fmtDateParam(today));

  const { from, to } = useMemo(() => {
    if (rangeMode === "custom") return { from: customFrom, to: customTo };
    if (rangeMode === "month") return { from: fmtDateParam(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtDateParam(today) };
    if (rangeMode === "quarter") return { from: fmtDateParam(new Date(today.getFullYear(), today.getMonth() - 2, 1)), to: fmtDateParam(today) };
    return { from: fmtDateParam(new Date(today.getFullYear(), 0, 1)), to: fmtDateParam(today) };
  }, [rangeMode, customFrom, customTo, today]);

  const { data: financeiro } = useQuery({
    queryKey: ["analytics-financeiro-summary", from, to],
    queryFn: () => fetchFinanceiroSummary(from, to),
    staleTime: 60_000,
  });
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useQuery({
    queryKey: ["analytics-summary", from, to],
    queryFn: () => fetchAnalyticsSummary(from, to),
    staleTime: 60_000,
  });

  const revenueChart = buildRevenueChart(financeiro?.monthly ?? []);
  const receita = financeiro?.totalEntradas ?? 0;

  if (analyticsLoading || !analytics) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`${CARD} h-28 animate-pulse`} />)}
        </div>
        <div className={`${CARD} h-56 animate-pulse`} />
      </div>
    );
  }

  if (analyticsError) {
    return (
      <div className={CARD}>
        <p className="text-[13px] text-dim-500 text-center py-16">Erro ao carregar analytics.</p>
      </div>
    );
  }

  const apptBars = buildApptBars(analytics.appointmentsByMonth);
  const barMax = Math.max(1, ...apptBars.map((b) => b.value));
  const svcMax = Math.max(1, ...analytics.topServices.map((s) => s.count));
  const peakMax = Math.max(1, ...analytics.peakHours.map((h) => h.count));
  const segments = donutSegments(analytics.planDistribution);
  const attendanceLabel = analytics.attendanceRate.rate === null ? "—" : `${analytics.attendanceRate.rate}%`;

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Analytics</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">
            Período: <span className="font-semibold text-dim-700">{format(new Date(`${from}T12:00:00`), "dd/MM/yyyy")} – {format(new Date(`${to}T12:00:00`), "dd/MM/yyyy")}</span>
          </p>
        </div>
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

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Calendar,   label: "Consultas",         display: analytics.totalAppointments.toString(),         sub: "no período selecionado", bg: "bg-brand-50",   cls: "text-brand-600"   },
          { icon: Users,      label: "Pacientes Activos", display: analytics.activePatients.toString(),            sub: "últimos 12 meses",       bg: "bg-violet-50",  cls: "text-violet-600"  },
          { icon: Banknote,   label: "Receita",           display: `${(receita/1000).toFixed(0)}k CVE`,            sub: "Faturas pagas + entradas manuais", bg: "bg-emerald-50", cls: "text-emerald-600" },
          { icon: TrendingUp, label: "Taxa de Presença",  display: attendanceLabel, sub: `${analytics.attendanceRate.completed} concluídas · ${analytics.attendanceRate.noShow} faltas`, bg: "bg-amber-50", cls: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className={CARD}>
            <div className="px-5 py-5">
              <div className={`w-9 h-9 ${s.bg} rounded-[10px] flex items-center justify-center mb-3`}>
                <s.icon className={s.cls} style={{ width: 18, height: 18 }} />
              </div>
              <p className="font-display font-bold text-[26px] text-dim-900 leading-none font-mono">{s.display}</p>
              <p className="text-[12px] font-semibold text-dim-700 mt-1">{s.label}</p>
              <p className="text-[11px] text-dim-400 mt-0.5">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly appointments bar chart */}
      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Consultas por Mês</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Total: <span className="font-mono font-semibold text-dim-700">{analytics.totalAppointments}</span> no período</p>
          </div>
          <span className="font-mono text-[11px] text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full">Pico: {barMax} consultas</span>
        </div>
        <div className="px-4 py-4">
          {apptBars.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-10">Sem consultas registadas neste período.</p>
          ) : (
            <svg viewBox="0 0 560 180" className="w-full" style={{ height: 180 }}>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f9191" stopOpacity="1" />
                  <stop offset="100%" stopColor="#13A3A3" stopOpacity="0.7" />
                </linearGradient>
              </defs>
              {[0, 25, 50, 75, 100].map((pct) => {
                const y = 10 + 130 - (pct / 100) * 130;
                const val = Math.round((pct / 100) * barMax);
                return (
                  <g key={pct}>
                    <line x1="0" y1={y} x2="560" y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={pct === 0 ? "none" : "3,3"} />
                    {pct > 0 && <text x="2" y={y - 2} fontSize="8" fill="#94a3b8" fontFamily="monospace">{val}</text>}
                  </g>
                );
              })}
              {apptBars.map((b, i) => (
                <g key={i}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#barGrad)" rx="4" />
                  {b.h > 20 && (
                    <text x={b.x + b.w / 2} y={b.y + 12} textAnchor="middle" fontSize="8" fill="white" fontFamily="monospace" fontWeight="bold">
                      {b.value}
                    </text>
                  )}
                  <text x={b.x + b.w / 2} y="168" textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="sans-serif">
                    {b.label}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>

      {/* Revenue + Plan distribution */}
      <div className="grid grid-cols-3 gap-4">

        {/* Revenue line chart */}
        <div className={`${CARD} col-span-2`}>
          <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
            <div>
              <h2 className="font-display text-[14px] font-semibold text-dim-900">Receita Mensal</h2>
              <p className="text-[11px] text-dim-400 mt-0.5">Entradas (faturas pagas + manuais) · em CVE</p>
            </div>
            {revenueChart.plotted.length > 0 && (
              <span className="font-mono text-[12px] text-emerald-700 font-bold">
                {revenueChart.plotted[revenueChart.plotted.length - 1].value.toLocaleString("pt-CV")} CVE{" "}
                <span className="text-[10px] font-normal text-dim-400">{revenueChart.plotted[revenueChart.plotted.length - 1].label}</span>
              </span>
            )}
          </div>
          <div className="px-4 py-4">
            {revenueChart.plotted.length === 0 ? (
              <p className="text-[13px] text-dim-400 text-center py-10">Sem movimentos registados ainda.</p>
            ) : (
              <svg viewBox="0 0 500 120" className="w-full" style={{ height: 130 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#13A3A3" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#13A3A3" stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                {revenueChart.guides.map((v) => {
                  const y = 100 - ((v - revenueChart.min) / Math.max(1, revenueChart.max - revenueChart.min)) * 90;
                  return (
                    <g key={v}>
                      <line x1="10" y1={y.toFixed(1)} x2="490" y2={y.toFixed(1)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
                      <text x="10" y={y - 2} fontSize="7" fill="#94a3b8" fontFamily="monospace">{(v/1000).toFixed(0)}k</text>
                    </g>
                  );
                })}
                <path d={revenueChart.area} fill="url(#areaGrad)" />
                <path d={revenueChart.line} fill="none" stroke="#0f9191" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {revenueChart.plotted.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="4" fill="white" stroke="#0f9191" strokeWidth="2" />
                    <text x={p.x.toFixed(1)} y="115" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="sans-serif">
                      {p.label}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Plan distribution donut */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Distribuição por Plano</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Pacientes activos (últimos 12 meses)</p>
          </div>
          <div className="px-5 py-4 flex flex-col items-center gap-5">
            {segments.length === 0 ? (
              <p className="text-[13px] text-dim-400 text-center py-8">Sem pacientes activos.</p>
            ) : (
              <>
                <svg viewBox="0 0 120 120" width="120" height="120">
                  {segments.map((seg) => (
                    <circle
                      key={seg.label}
                      cx="60" cy="60" r="44"
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="16"
                      strokeDasharray={`${seg.dash.toFixed(2)} ${seg.gap.toFixed(2)}`}
                      strokeDashoffset={seg.offset.toFixed(2)}
                      style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }}
                    />
                  ))}
                  <text x="60" y="56" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1A1A2E" fontFamily="monospace">{analytics.activePatients}</text>
                  <text x="60" y="68" textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">pacientes</text>
                </svg>

                <div className="w-full flex flex-col gap-2">
                  {segments.map((seg) => (
                    <div key={seg.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                        <span className="text-[12px] text-dim-600 truncate">{seg.label}</span>
                      </div>
                      <span className="font-mono text-[12px] font-semibold text-dim-900 shrink-0">{seg.pct}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Top services + Peak hours */}
      <div className="grid grid-cols-2 gap-4">

        {/* Top services */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Serviços mais Solicitados</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Consultas por especialidade, no período</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3.5">
            {analytics.topServices.length === 0 ? (
              <p className="text-[13px] text-dim-400 text-center py-6">Sem consultas registadas neste período.</p>
            ) : (
              analytics.topServices.map((s, i) => (
                <div key={s.service}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-dim-400 w-3 text-right shrink-0">{i + 1}</span>
                      <span className="text-[12px] font-medium text-dim-800">{s.service}</span>
                    </div>
                    <span className="font-mono text-[12px] font-semibold text-dim-700">{s.count}</span>
                  </div>
                  <div className="h-1.5 bg-dim-100 rounded-full overflow-hidden ml-5">
                    <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${(s.count / svcMax) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Peak hours */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Horários de Pico</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Distribuição de consultas por hora, no período</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            {analytics.peakHours.length === 0 ? (
              <p className="text-[13px] text-dim-400 text-center py-6">Sem consultas registadas neste período.</p>
            ) : (
              analytics.peakHours.map((h) => {
                const pct = (h.count / peakMax) * 100;
                const isPeak = h.count >= peakMax * 0.8;
                return (
                  <div key={h.hour} className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-dim-400 w-8 shrink-0">{String(h.hour).padStart(2, "0")}h</span>
                    <div className="flex-1 h-4 bg-dim-100 rounded-md overflow-hidden">
                      <div className={`h-full rounded-md transition-all ${isPeak ? "bg-brand-700" : "bg-brand-300"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-dim-600 w-4 text-right shrink-0">{h.count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
