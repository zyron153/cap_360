"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, Users, Calendar, Banknote } from "lucide-react";
import { usePermissions } from "../hooks/use-permissions";

/* ── Static mock data ─────────────────────────────────────── */

const MONTHLY_APPTS = [65, 72, 58, 81, 76, 88, 92, 79, 85, 91, 78, 95];
const MONTHS_PT     = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const REVENUE_DATA   = [182000, 195000, 168000, 210000, 198000, 225000];
const REVENUE_MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun"];

const SERVICES = [
  { name: "Medicina Geral",  count: 145, color: "bg-brand-500"    },
  { name: "Enfermagem",      count: 120, color: "bg-teal-500"     },
  { name: "Pediatria",       count: 98,  color: "bg-violet-500"   },
  { name: "Cardiologia",     count: 76,  color: "bg-amber-500"    },
  { name: "Ginecologia",     count: 65,  color: "bg-rose-500"     },
  { name: "Fisioterapia",    count: 52,  color: "bg-sky-500"      },
];

const PEAK_HOURS = [
  { hour: "08h", count: 4  },
  { hour: "09h", count: 12 },
  { hour: "10h", count: 18 },
  { hour: "11h", count: 22 },
  { hour: "12h", count: 8  },
  { hour: "13h", count: 14 },
  { hour: "14h", count: 19 },
  { hour: "15h", count: 16 },
  { hour: "16h", count: 11 },
  { hour: "17h", count: 7  },
  { hour: "18h", count: 3  },
];

const PLAN_DIST = [
  { label: "Familiar",      pct: 38, color: "#0f9191" },
  { label: "Corporativo",   pct: 44, color: "#6d28d9" },
  { label: "Particular",    pct: 18, color: "#94a3b8" },
];

/* ── Chart computations ───────────────────────────────────── */

// Bar chart: 560 wide, 180 tall; bars start at y=10
const BAR_MAX  = Math.max(...MONTHLY_APPTS);
const BAR_H    = 130;
const BAR_W    = 36;
const BAR_GAP  = 9;
const BAR_SLOT = BAR_W + BAR_GAP;
const BAR_OFF  = (560 - (12 * BAR_SLOT - BAR_GAP)) / 2;

const barRects = MONTHLY_APPTS.map((v, i) => {
  const bh = (v / BAR_MAX) * BAR_H;
  return { x: BAR_OFF + i * BAR_SLOT, y: 10 + BAR_H - bh, w: BAR_W, h: bh, label: MONTHS_PT[i], value: v };
});

// Line chart: 500 wide, 120 tall
const REV_MIN    = 155000;
const REV_RANGE  = 70000;
const REV_CHART_H = 90;
const revPoints  = REVENUE_DATA.map((v, i) => ({
  x: 10 + i * 96,
  y: 100 - ((v - REV_MIN) / REV_RANGE) * REV_CHART_H,
  value: v,
}));
const revLine  = revPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const revArea  = `${revLine} L ${revPoints[revPoints.length - 1].x},100 L 10,100 Z`;

// Donut chart: r=44, cx=cy=60
const DONUT_R = 44;
const DONUT_C = 2 * Math.PI * DONUT_R; // ≈ 276.46

function planSegments() {
  let offset = 0;
  return PLAN_DIST.map((p) => {
    const dash   = (p.pct / 100) * DONUT_C;
    const gap    = DONUT_C - dash;
    const result = { ...p, dash, gap, offset: -offset };
    offset      += dash;
    return result;
  });
}
const segments = planSegments();

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

export default function AnalyticsPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("analytics")) router.replace("/dashboard");
  }, [permLoading, can, router]);
  const peakMax = Math.max(...PEAK_HOURS.map((h) => h.count));
  const svcMax  = Math.max(...SERVICES.map((s) => s.count));
  const totalAppts = MONTHLY_APPTS.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Analytics</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">Métricas e indicadores de desempenho — 2026</p>
        </div>
        <span className="flex items-center gap-1.5 border border-dim-200 bg-white text-dim-600 text-[12px] font-medium px-3.5 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.04)]">
          Jan – Jun 2026
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Calendar,  label: "Consultas (YTD)",   value: totalAppts,       sub: "+12% vs ano anterior",  bg: "bg-brand-50",   cls: "text-brand-600",   fmt: (v: number) => v.toString()                              },
          { icon: Users,     label: "Pacientes Activos", value: 834,              sub: "+48 este mês",          bg: "bg-violet-50",  cls: "text-violet-600",  fmt: (v: number) => v.toString()                              },
          { icon: Banknote,  label: "Receita YTD",       value: 1178000,          sub: "+8.4% vs objectivo",    bg: "bg-emerald-50", cls: "text-emerald-600", fmt: (v: number) => `${(v/1000).toFixed(0)}k CVE`             },
          { icon: TrendingUp,label: "Taxa de Presença",  value: 87,               sub: "meta: 90%",             bg: "bg-amber-50",   cls: "text-amber-600",   fmt: (v: number) => `${v}%`                                   },
        ].map((s) => (
          <div key={s.label} className={CARD}>
            <div className="px-5 py-5">
              <div className={`w-9 h-9 ${s.bg} rounded-[10px] flex items-center justify-center mb-3`}>
                <s.icon className={s.cls} style={{ width: 18, height: 18 }} />
              </div>
              <p className="font-display font-bold text-[26px] text-dim-900 leading-none font-mono">{s.fmt(s.value)}</p>
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
            <p className="text-[11px] text-dim-400 mt-0.5">Total: <span className="font-mono font-semibold text-dim-700">{totalAppts}</span> em 2026</p>
          </div>
          <span className="font-mono text-[11px] text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full">Pico: {BAR_MAX} consultas</span>
        </div>
        <div className="px-4 py-4">
          <svg viewBox="0 0 560 180" className="w-full" style={{ height: 180 }}>
            <defs>
              <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0f9191" stopOpacity="1" />
                <stop offset="100%" stopColor="#13A3A3" stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {/* Horizontal guide lines */}
            {[0, 25, 50, 75, 100].map((pct) => {
              const y = 10 + BAR_H - (pct / 100) * BAR_H;
              const val = Math.round((pct / 100) * BAR_MAX);
              return (
                <g key={pct}>
                  <line x1="0" y1={y} x2="560" y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={pct === 0 ? "none" : "3,3"} />
                  {pct > 0 && (
                    <text x="2" y={y - 2} fontSize="8" fill="#94a3b8" fontFamily="monospace">{val}</text>
                  )}
                </g>
              );
            })}
            {/* Bars */}
            {barRects.map((b, i) => (
              <g key={i}>
                <rect
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  fill="url(#barGrad)" rx="4"
                />
                {/* Value label on tall bars */}
                {b.h > 20 && (
                  <text x={b.x + b.w / 2} y={b.y + 12} textAnchor="middle" fontSize="8" fill="white" fontFamily="monospace" fontWeight="bold">
                    {b.value}
                  </text>
                )}
                {/* Month label */}
                <text x={b.x + b.w / 2} y="168" textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="sans-serif">
                  {b.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* Revenue + Plan distribution */}
      <div className="grid grid-cols-3 gap-4">

        {/* Revenue line chart */}
        <div className={`${CARD} col-span-2`}>
          <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
            <div>
              <h2 className="font-display text-[14px] font-semibold text-dim-900">Receita Mensal</h2>
              <p className="text-[11px] text-dim-400 mt-0.5">Jan – Jun 2026 · em CVE</p>
            </div>
            <span className="font-mono text-[12px] text-emerald-700 font-bold">225 000 CVE <span className="text-[10px] font-normal text-dim-400">Junho</span></span>
          </div>
          <div className="px-4 py-4">
            <svg viewBox="0 0 500 120" className="w-full" style={{ height: 130 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#13A3A3" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#13A3A3" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              {/* Guide lines */}
              {[155000, 175000, 195000, 215000].map((v) => {
                const y = 100 - ((v - REV_MIN) / REV_RANGE) * REV_CHART_H;
                return (
                  <g key={v}>
                    <line x1="10" y1={y.toFixed(1)} x2="490" y2={y.toFixed(1)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
                    <text x="10" y={y - 2} fontSize="7" fill="#94a3b8" fontFamily="monospace">{(v/1000).toFixed(0)}k</text>
                  </g>
                );
              })}
              {/* Filled area */}
              <path d={revArea} fill="url(#areaGrad)" />
              {/* Line */}
              <path d={revLine} fill="none" stroke="#0f9191" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {/* Points */}
              {revPoints.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="4" fill="white" stroke="#0f9191" strokeWidth="2" />
                  <text x={p.x.toFixed(1)} y="115" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="sans-serif">
                    {REVENUE_MONTHS[i]}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Plan distribution donut */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Distribuição por Plano</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Pacientes activos</p>
          </div>
          <div className="px-5 py-4 flex flex-col items-center gap-5">
            <svg viewBox="0 0 120 120" width="120" height="120">
              {segments.map((seg) => (
                <circle
                  key={seg.label}
                  cx="60" cy="60" r={DONUT_R}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="16"
                  strokeDasharray={`${seg.dash.toFixed(2)} ${seg.gap.toFixed(2)}`}
                  strokeDashoffset={seg.offset.toFixed(2)}
                  style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }}
                />
              ))}
              <text x="60" y="56" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1A1A2E" fontFamily="monospace">834</text>
              <text x="60" y="68" textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">pacientes</text>
            </svg>

            <div className="w-full flex flex-col gap-2">
              {segments.map((seg) => (
                <div key={seg.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="text-[12px] text-dim-600">{seg.label}</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-dim-900">{seg.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top services + Peak hours */}
      <div className="grid grid-cols-2 gap-4">

        {/* Top services */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Serviços mais Solicitados</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Consultas por especialidade</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3.5">
            {SERVICES.map((s, i) => (
              <div key={s.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-dim-400 w-3 text-right shrink-0">{i + 1}</span>
                    <span className="text-[12px] font-medium text-dim-800">{s.name}</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-dim-700">{s.count}</span>
                </div>
                <div className="h-1.5 bg-dim-100 rounded-full overflow-hidden ml-5">
                  <div
                    className={`h-full ${s.color} rounded-full transition-all`}
                    style={{ width: `${(s.count / svcMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Peak hours */}
        <div className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Horários de Pico</h2>
            <p className="text-[11px] text-dim-400 mt-0.5">Distribuição de consultas por hora</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2">
            {PEAK_HOURS.map((h) => {
              const pct = (h.count / peakMax) * 100;
              const isPeak = h.count >= peakMax * 0.8;
              return (
                <div key={h.hour} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-dim-400 w-8 shrink-0">{h.hour}</span>
                  <div className="flex-1 h-4 bg-dim-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full rounded-md transition-all ${isPeak ? "bg-brand-700" : "bg-brand-300"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-dim-600 w-4 text-right shrink-0">{h.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
