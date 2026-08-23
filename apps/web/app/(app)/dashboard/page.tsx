"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { io } from "socket.io-client";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { validateScheduledAt } from "../../../lib/validate-schedule";

/* ─── Types ──────────────────────────────────────────────────────── */

type TodayAppt = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  source: string;
  patient: { fullName: string };
  staff: { fullName: string } | null;
  service: { name: string } | null;
};

type MonthAppt = {
  scheduledAt: string;
  source: string;
  service: { name: string } | null;
};

type RecentPatient = {
  id: string;
  fullName: string;
  phone: string | null;
  healthPlanId: string | null;
  createdAt: string;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  total: number;
  status: string;
  patient: { fullName: string };
};

type BillingSummary = {
  issuedCount: number;
  collectedAmount: number;
  overdueCount: number;
};

type HealthPlan = {
  id: string;
  active: boolean;
  product: { name: string } | null;
  company: { id: string; name: string } | null;
};

/* ─── Status maps ─────────────────────────────────────────────────── */

const APPT_STATUS: Record<string, { lineState: string; card: string; avatar: string; label: string; pillCls: string }> = {
  pending:    { lineState: "default", card: "gray",  avatar: "teal",  label: "Pendente",   pillCls: "bg-amber-100 text-amber-700"    },
  confirmed:  { lineState: "default", card: "teal",  avatar: "teal",  label: "Confirmada", pillCls: "bg-brand-100 text-brand-800"    },
  checked_in: { lineState: "active",  card: "teal",  avatar: "teal",  label: "Presente",   pillCls: "bg-violet-100 text-violet-700"  },
  completed:  { lineState: "done",    card: "green", avatar: "green", label: "Concluída",  pillCls: "bg-emerald-100 text-emerald-700" },
  cancelled:  { lineState: "cancel",  card: "red",   avatar: "gray",  label: "Cancelada",  pillCls: "bg-dim-100 text-dim-500"        },
  no_show:    { lineState: "cancel",  card: "red",   avatar: "gray",  label: "Faltou",     pillCls: "bg-red-100 text-red-600"        },
};

const INVOICE_STATUS: Record<string, { label: string; cls: string; amtCls: string }> = {
  draft:          { label: "Rascunho",  cls: "bg-dim-100 text-dim-500",         amtCls: "text-dim-500"     },
  issued:         { label: "Emitida",   cls: "bg-brand-100 text-brand-800",     amtCls: "text-brand-700"   },
  partially_paid: { label: "Parcial",   cls: "bg-amber-100 text-amber-700",     amtCls: "text-amber-700"   },
  paid:           { label: "Pago",      cls: "bg-emerald-100 text-emerald-700", amtCls: "text-emerald-700" },
  overdue:        { label: "Em Atraso", cls: "bg-red-100 text-red-600",         amtCls: "text-red-700"     },
  cancelled:      { label: "Anulada",   cls: "bg-dim-100 text-dim-500",         amtCls: "text-dim-500"     },
};

const BAR_COLORS = ["bg-brand-600","bg-brand-500","bg-brand-500","bg-brand-400","bg-brand-400","bg-brand-300","bg-brand-200"];
const DONUT_COLORS = ["#13A3A3","#7C3AED","#D97706","#E11D48"];

/* ─── Helpers ─────────────────────────────────────────────────────── */

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const LINE_CLS: Record<string, string> = {
  done: "bg-dim-200", active: "bg-brand-400", warn: "bg-dim-200", cancel: "bg-dim-200", default: "bg-dim-200",
};
const DOT_CLS: Record<string, string> = {
  done: "bg-emerald-500", active: "bg-brand-400", warn: "bg-amber-500", cancel: "bg-red-400", default: "bg-dim-300",
};
const CARD_CLS: Record<string, string> = {
  green: "bg-emerald-50/50", teal: "bg-brand-50", amber: "bg-amber-50", red: "bg-red-50", gray: "bg-dim-50",
};
const AVATAR_CLS: Record<string, string> = {
  teal: "bg-brand-200 text-brand-800", green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700", gray: "bg-dim-100 text-dim-500",
};

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/* ─── Page ────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const [apptOpen, setApptOpen]         = useState(false);
  const [patientOpen, setPatientOpen]   = useState(false);
  const [apptForm, setApptForm]         = useState({ patientId: "", serviceId: "", staffId: "", scheduledAt: "", notes: "" });
  const [apptSubmitting, setApptSubmitting] = useState(false);
  const [patientForm, setPatientForm]   = useState({ fullName: "", dateOfBirth: "", phone: "", email: "", gender: "female" });
  const [patConsent, setPatConsent]     = useState(false);
  const [patSubmitting, setPatSubmitting] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();

  const NOW        = new Date();
  const todayStr   = format(NOW, "yyyy-MM-dd");
  const monthStart = format(new Date(NOW.getFullYear(), NOW.getMonth(), 1), "yyyy-MM-dd");
  const monthEnd   = format(new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0), "yyyy-MM-dd");
  const todayLabel = format(NOW, "EEEE, dd MMM", { locale: pt });
  const calMonthStart = format(calMonth, "yyyy-MM-dd");
  const calMonthEnd   = format(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0), "yyyy-MM-dd");
  const monthLabel    = format(calMonth, "MMMM yyyy", { locale: pt });
  const selectedLabel = format(new Date(selectedDay + "T00:00:00"), "EEEE, dd MMM", { locale: pt });

  /* ── Queries ── */
  const { data: todayAppts = [], isLoading: todayLoading } = useQuery<TodayAppt[]>({
    queryKey: ["appointments", "calendar", todayStr, todayStr],
    queryFn:  () => fetch(`/api/appointments?from=${todayStr}&to=${todayStr}`).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: monthAppts = [] } = useQuery<MonthAppt[]>({
    queryKey: ["appointments", "calendar", monthStart, monthEnd],
    queryFn:  () => fetch(`/api/appointments?from=${monthStart}&to=${monthEnd}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: calAppts = [] } = useQuery<MonthAppt[]>({
    queryKey: ["appointments", "calendar", calMonthStart, calMonthEnd],
    queryFn:  () => fetch(`/api/appointments?from=${calMonthStart}&to=${calMonthEnd}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: selectedAppts = [], isLoading: selectedLoading } = useQuery<TodayAppt[]>({
    queryKey: ["appointments", "calendar", selectedDay, selectedDay],
    queryFn:  () => fetch(`/api/appointments?from=${selectedDay}&to=${selectedDay}`).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: patientsList } = useQuery<{ data: RecentPatient[] }>({
    queryKey: ["patients", "dashboard"],
    queryFn:  () => fetch("/api/patients?limit=20").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: invoicesData } = useQuery<{ data: InvoiceRow[] }>({
    queryKey: ["invoices", "dashboard"],
    queryFn:  () => fetch("/api/invoices?limit=5").then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: billingSummary } = useQuery<BillingSummary>({
    queryKey: ["bff", "billing-summary"],
    queryFn:  () => fetch("/api/bff/billing-summary").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: healthPlans = [] } = useQuery<HealthPlan[]>({
    queryKey: ["health-plans", "all"],
    queryFn:  () => fetch("/api/health-plans").then(r => r.json()),
    staleTime: 120_000,
  });

  const { data: patients }    = useQuery<{ data: { id: string; fullName: string }[] }>({ queryKey: ["patients-list"],  queryFn: () => fetch("/api/patients?limit=100").then(r => r.json()), staleTime: 60_000 });
  const { data: staffList }   = useQuery<{ id: string; fullName: string }[]>({ queryKey: ["staff-list"],   queryFn: () => fetch("/api/staff").then(r => r.json()), staleTime: 60_000 });
  const { data: servicesList} = useQuery<{ id: string; name: string }[]>({   queryKey: ["services-list"], queryFn: () => fetch("/api/services").then(r => r.json()), staleTime: 60_000 });

  /* ── Real-time ── */
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const socket = io(`${apiUrl}/calendar`, { path: "/socket.io", reconnectionAttempts: 3 });
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["bff", "billing-summary"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    };
    socket.on("appointment:created", refresh);
    socket.on("appointment:updated", refresh);
    return () => { socket.disconnect(); };
  }, [queryClient]);

  /* ── Derived ── */
  const todayTotal     = todayAppts.length;
  const completedCount = todayAppts.filter(a => a.status === "completed").length;
  const noShowPct      = todayTotal > 0 ? Math.round((todayAppts.filter(a => a.status === "no_show").length / todayTotal) * 100) : 0;
  const monthRevKilo   = Math.round((billingSummary?.collectedAmount ?? 0) / 1000);

  const webCount  = monthAppts.filter(a => a.source === "web").length;
  const onlinePct = monthAppts.length > 0 ? Math.round((webCount / monthAppts.length) * 100) : 0;

  // Calendar dots
  const apptDays = new Set(calAppts.map(a => new Date(a.scheduledAt).getDate()));
  const firstDOW = calMonth.getDay();
  const lastDay  = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const isCurrentMonth = calMonth.getFullYear() === NOW.getFullYear() && calMonth.getMonth() === NOW.getMonth();
  const selDate  = new Date(selectedDay + "T00:00:00");
  const selectedIsThisMonth = selDate.getFullYear() === calMonth.getFullYear() && selDate.getMonth() === calMonth.getMonth();
  const selectedDayNum = selectedIsThisMonth ? selDate.getDate() : 0;
  const calDays  = [
    ...Array.from({ length: firstDOW }, () => ({ d: 0, muted: true, appt: false, today: false, selected: false })),
    ...Array.from({ length: lastDay }, (_, i) => ({
      d: i + 1, muted: false, appt: apptDays.has(i + 1),
      today: isCurrentMonth && i + 1 === NOW.getDate(),
      selected: i + 1 === selectedDayNum,
    })),
  ];

  // Recent patients sorted by newest
  const recentPatients = [...(patientsList?.data ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const recentInvoices = invoicesData?.data ?? [];

  // Service bar chart from real month appointments
  const svcMap: Record<string, number> = {};
  monthAppts.forEach(a => { const n = a.service?.name ?? "Outros"; svcMap[n] = (svcMap[n] ?? 0) + 1; });
  const maxSvc = Math.max(...Object.values(svcMap), 1);
  const serviceBars = Object.entries(svcMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, count], i) => ({
      name,
      label: name.length > 5 ? name.slice(0, 5) + "." : name,
      pct: Math.round((count / maxSvc) * 100),
      cls: BAR_COLORS[i] ?? "bg-brand-400",
    }));

  // Occupancy = active (checked_in + completed) / total today
  const occupancyPct = todayTotal > 0
    ? Math.round((todayAppts.filter(a => a.status === "completed" || a.status === "checked_in").length / todayTotal) * 100)
    : 0;

  // Health plans donut from real data
  const activePlans = healthPlans.filter(p => p.active);
  const totalPlans  = activePlans.length;
  const planGroups: { name: string; count: number }[] = [];
  activePlans.forEach(p => {
    const name = p.product?.name ?? (p.company ? "Corporativo" : "Particular");
    const g = planGroups.find(x => x.name === name);
    if (g) g.count++; else planGroups.push({ name, count: 1 });
  });
  planGroups.sort((a, b) => b.count - a.count);
  const C = 2 * Math.PI * 26;
  let cum = 0;
  const donutSegs = totalPlans > 0
    ? planGroups.slice(0, 4).map((g, i) => {
        const frac = g.count / totalPlans;
        const offset = -(cum * C);
        cum += frac;
        return { name: g.name, count: g.count, pct: Math.round(frac * 100), dash: frac * C, rest: (1 - frac) * C, offset, color: DONUT_COLORS[i] ?? "#D1D1E0" };
      })
    : [];

  /* ── Modal handlers ── */
  function setA(k: string, v: string) { setApptForm(f => ({ ...f, [k]: v })); }
  function setP(k: string, v: string) { setPatientForm(f => ({ ...f, [k]: v })); }

  async function handlePatientSubmit() {
    if (!patientForm.fullName.trim() || !patientForm.phone || !patientForm.dateOfBirth || !patConsent) return;
    setPatSubmitting(true);
    try {
      const res = await fetch("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: patientForm.fullName.trim(), dateOfBirth: patientForm.dateOfBirth, gender: patientForm.gender, phone: patientForm.phone, email: patientForm.email || undefined, consentGiven: true }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message ?? "Erro ao criar paciente"); }
      setPatientForm({ fullName: "", dateOfBirth: "", phone: "", email: "", gender: "female" });
      setPatConsent(false); setPatientOpen(false);
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      addMessage("Success", "Paciente registado com sucesso!");
    } catch (e: unknown) { addMessage("Error", e instanceof Error ? e.message : "Erro desconhecido"); }
    finally { setPatSubmitting(false); }
  }

  async function handleApptSubmit() {
    if (!apptForm.patientId || !apptForm.staffId || !apptForm.serviceId || !apptForm.scheduledAt) return;
    const scheduleError = validateScheduledAt(apptForm.scheduledAt);
    if (scheduleError) { addMessage("Error", scheduleError); return; }
    setApptSubmitting(true);
    try {
      const res = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: apptForm.patientId, staffId: apptForm.staffId, serviceId: apptForm.serviceId, scheduledAt: new Date(apptForm.scheduledAt).toISOString(), notes: apptForm.notes || undefined, source: "web" }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message ?? "Erro ao criar marcação"); }
      setApptForm({ patientId: "", serviceId: "", staffId: "", scheduledAt: "", notes: "" }); setApptOpen(false);
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      addMessage("Success", "Marcação criada com sucesso!");
    } catch (e: unknown) { addMessage("Error", e instanceof Error ? e.message : "Erro desconhecido"); }
    finally { setApptSubmitting(false); }
  }

  /* ── KPI stats — all real ── */
  const STATS = [
    {
      label: "Consultas Hoje",
      value: todayLoading ? "…" : String(todayTotal),
      delta: todayLoading ? "A carregar…" : `${completedCount} concluída${completedCount !== 1 ? "s" : ""}`,
      deltaUp: true, iconBg: "bg-brand-50",
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="#0D8080" strokeWidth="1.4" fill="none"/><path d="M5 1V3M11 1V3" stroke="#0D8080" strokeWidth="1.4" strokeLinecap="round"/><path d="M1 6H15" stroke="#0D8080" strokeWidth="1.4"/></svg>,
    },
    {
      label: "Reservas Online",
      value: monthAppts.length > 0 ? `${onlinePct}%` : "—",
      delta: `Meta: 70% · ${webCount} via web`,
      deltaUp: onlinePct >= 70, iconBg: "bg-blue-50",
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#2563EB" strokeWidth="1.4" fill="none"/><path d="M5.5 8L7.5 10L11 6" stroke="#2563EB" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
    {
      label: "Sem-Apresentação",
      value: `${noShowPct}%`,
      delta: noShowPct < 12 ? "Melhor que meta 12%" : "Acima da meta 12%",
      deltaUp: noShowPct < 12, iconBg: "bg-red-50",
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#DC2626" strokeWidth="1.4" fill="none"/><path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="#DC2626" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
    {
      label: "Receita Mensal",
      value: billingSummary ? (monthRevKilo > 0 ? `${monthRevKilo}k` : "0") : "…",
      valueSub: "CVE",
      delta: billingSummary ? (billingSummary.overdueCount > 0 ? `${billingSummary.overdueCount} em atraso` : "Sem atrasos") : "A carregar…",
      deltaUp: (billingSummary?.overdueCount ?? 1) === 0, iconBg: "bg-emerald-50",
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2V14M5 4H9.5C10.6 4 11.5 4.9 11.5 6C11.5 7.1 10.6 8 9.5 8H5M5 8H10C11.1 8 12 8.9 12 10C12 11.1 11.1 12 10 12H5" stroke="#059669" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
    {
      label: "Planos Ativos",
      value: totalPlans > 0 ? String(totalPlans) : "—",
      delta: planGroups[0] ? `${planGroups[0].name} lidera` : "Sem planos registados",
      deltaUp: true, iconBg: "bg-violet-50",
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L2 4.5V9C2 12 5 14.5 8 15C11 14.5 14 12 14 9V4.5L8 1.5Z" stroke="#7C3AED" strokeWidth="1.4" fill="none"/><path d="M5.5 8L7.5 10L11 6" stroke="#7C3AED" strokeWidth="1.4" strokeLinecap="round"/></svg>,
    },
  ];

  return (
    <>
    <div className="flex flex-col gap-5">

      {/* ── KPI Stats ── */}
      <div className="grid grid-cols-5 gap-3.5">
        {STATS.map((s) => (
          <div key={s.label} className={`${CARD} p-[18px] flex flex-col gap-2.5 hover:shadow-[0_4px_12px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.04)] transition-shadow`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-dim-500">{s.label}</span>
              <div className={`w-8 h-8 ${s.iconBg} rounded-md flex items-center justify-center`}>{s.icon}</div>
            </div>
            <div className="font-display text-[26px] font-bold text-dim-900 leading-none">
              {s.value}
              {"valueSub" in s && s.valueSub && (
                <sub className="text-[13px] font-normal text-dim-500 ml-0.5 align-baseline">{s.valueSub}</sub>
              )}
            </div>
            <div className={`flex items-center gap-1 text-[11px] font-semibold ${s.deltaUp ? "text-emerald-500" : "text-red-500"}`}>
              {s.deltaUp
                ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 8V2M2 5L5 2L8 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                : <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2V8M2 5L5 8L8 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              }
              {s.delta}
            </div>
          </div>
        ))}
      </div>

      {/* ── Main Grid ── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 340px" }}>

        {/* Appointment Timeline */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
              <div className="w-[26px] h-[26px] bg-brand-50 rounded-md flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1.5" width="12" height="11" rx="1.5" stroke="#0D8080" strokeWidth="1.3" fill="none"/><path d="M4 0.5V2.5M10 0.5V2.5M1 5H13" stroke="#0D8080" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </div>
              Agenda de — <span className="capitalize ml-1">{selectedLabel}</span>
            </div>
            <button onClick={() => setApptOpen(true)} className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-brand-700 text-white hover:bg-brand-800 transition-colors">
              <Plus className="w-2.5 h-2.5" /> Nova Consulta
            </button>
          </div>
          <div className="px-5 pb-4">
            {selectedLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-stretch gap-3 py-2 border-b border-dim-100 last:border-b-0 animate-pulse">
                  <div className="w-[46px] shrink-0 space-y-1 pt-0.5"><div className="h-3 bg-dim-100 rounded w-10"/><div className="h-2 bg-dim-100 rounded w-8"/></div>
                  <div className="w-0.5 bg-dim-100 shrink-0 rounded-sm"/>
                  <div className="flex-1 h-12 bg-dim-50 rounded-[10px]"/>
                </div>
              ))
            ) : selectedAppts.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-dim-400">Sem consultas agendadas para este dia.</div>
            ) : (
              selectedAppts.map((appt) => {
                const st = APPT_STATUS[appt.status] ?? APPT_STATUS.pending;
                return (
                  <div key={appt.id} className="flex items-stretch gap-3 py-2 border-b border-dim-100 last:border-b-0">
                    <div className="w-[46px] shrink-0 pt-0.5">
                      <strong className="font-mono text-[11px] font-medium text-dim-600 block">{format(new Date(appt.scheduledAt), "HH:mm")}</strong>
                      <span className="font-mono text-[10px] text-dim-400">{appt.durationMinutes} min</span>
                    </div>
                    <div className={`w-0.5 ${LINE_CLS[st.lineState]} rounded-sm shrink-0 relative`}>
                      <span className={`absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${DOT_CLS[st.lineState]} border-2 border-white`}/>
                    </div>
                    <div className={`flex-1 ${CARD_CLS[st.card]} rounded-[10px] px-3 py-2.5 flex items-center gap-2.5 border border-transparent hover:border-dim-200 hover:shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-all`}>
                      <div className={`w-8 h-8 rounded-full ${AVATAR_CLS[st.avatar]} font-semibold text-[12px] flex items-center justify-center shrink-0`}>
                        {initials(appt.patient.fullName) || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px] text-dim-900 truncate">{appt.patient.fullName}</div>
                        <div className="text-[11px] text-dim-500 mt-0.5">{appt.service?.name ?? "—"}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-dim-500">{appt.staff?.fullName ?? "—"}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.pillCls}`}>{st.label}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-4">

          {/* Mini Calendar */}
          <div className={CARD}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
              <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
                <div className="w-[26px] h-[26px] bg-blue-50 rounded-md flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x=".5" y="1.5" width="12" height="10" rx="1.5" stroke="#2563EB" strokeWidth="1.2" fill="none"/><path d="M3 0V2M10 0V2M.5 4.5H12.5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round"/></svg>
                </div>
                <span className="capitalize">{monthLabel}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))} className="w-6 h-6 rounded flex items-center justify-center text-dim-400 hover:bg-dim-100 transition-colors"><ChevronLeft className="w-3 h-3"/></button>
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))} className="w-6 h-6 rounded flex items-center justify-center text-dim-400 hover:bg-dim-100 transition-colors"><ChevronRight className="w-3 h-3"/></button>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="grid grid-cols-7 gap-0.5">
                {["D","S","T","Q","Q","S","S"].map((d, i) => (
                  <div key={i} className="text-center text-[9px] font-bold text-dim-400 tracking-[0.06em] pb-1.5">{d}</div>
                ))}
                {calDays.map(({ d, muted, appt, today, selected }, i) => (
                  <div
                    key={i}
                    onClick={() => !muted && d > 0 && setSelectedDay(format(new Date(calMonth.getFullYear(), calMonth.getMonth(), d), "yyyy-MM-dd"))}
                    className={`aspect-square flex items-center justify-center font-mono text-[11px] rounded relative transition-colors ${
                      muted ? "text-dim-300 cursor-default" :
                      today ? "bg-brand-700 text-white font-bold cursor-pointer" :
                      selected ? "bg-brand-100 text-brand-700 font-semibold ring-1 ring-brand-300 cursor-pointer" :
                      "text-dim-700 hover:bg-dim-100 cursor-pointer"
                    }`}
                  >
                    {d > 0 ? d : ""}
                    {appt && <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${today ? "bg-brand-200" : selected ? "bg-brand-400" : "bg-brand-400"}`}/>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* WhatsApp — module not yet available */}
          <div className={CARD}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
              <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
                <div className="w-[26px] h-[26px] bg-emerald-500/10 rounded-md flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1C3.7 1 1.5 3 1.5 5.5C1.5 6.5 1.9 7.4 2.5 8.1L1.5 11L4.7 10.1C5.2 10.3 5.8 10.4 6.5 10.4C9.3 10.4 11.5 8.4 11.5 5.9C11.5 3.4 9.3 1 6.5 1Z" stroke="#059669" strokeWidth="1.2" fill="none"/></svg>
                </div>
                Caixa WhatsApp
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-full">Em breve</span>
            </div>
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-dim-400">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 3C9.4 3 4 7.9 4 14C4 16.6 5 19 6.8 21L4 28L11.4 25.8C12.8 26.3 14.4 26.6 16 26.6C22.6 26.6 28 21.7 28 15.6C28 9.5 22.6 3 16 3Z" stroke="#D1D1E0" strokeWidth="2" fill="none"/></svg>
              <span className="text-[12px] font-medium text-dim-500">Módulo WhatsApp Bot — Fase 3</span>
              <span className="text-[11px] text-dim-400">Ainda não disponível nesta versão.</span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Recent Patients ── */}
      <div className={CARD}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
          <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
            <div className="w-[26px] h-[26px] bg-dim-100 rounded-md flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="3" stroke="#4A4A6A" strokeWidth="1.3"/><path d="M1.5 13C1.5 10.5 4 8.5 7 8.5C10 8.5 12.5 10.5 12.5 13" stroke="#4A4A6A" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </div>
            Pacientes Recentes
          </div>
          <button onClick={() => setPatientOpen(true)} className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-brand-700 text-white hover:bg-brand-800 transition-colors">
            <Plus className="w-2.5 h-2.5"/> Novo Paciente
          </button>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>{["Paciente","Telefone","Registado em","Plano"].map(h => (
              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2 border-b border-dim-100 bg-dim-50">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {recentPatients.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-[13px] text-dim-400">Sem pacientes registados.</td></tr>
            ) : recentPatients.map(p => (
              <tr key={p.id} className="hover:bg-dim-50 transition-colors">
                <td className="px-5 py-2.5 border-b border-dim-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center font-semibold text-[10px] bg-brand-100 text-brand-800">{initials(p.fullName) || "?"}</div>
                    <span className="text-[12px] text-dim-900 font-medium">{p.fullName}</span>
                  </div>
                </td>
                <td className="px-5 py-2.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">{p.phone ?? "—"}</td>
                <td className="px-5 py-2.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">{format(new Date(p.createdAt), "dd MMM yyyy", { locale: pt })}</td>
                <td className="px-5 py-2.5 border-b border-dim-100">
                  {p.healthPlanId
                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-[0.04em] bg-blue-100 text-blue-700">Com Plano</span>
                    : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-[0.04em] bg-dim-100 text-dim-600">Particular</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Bottom Grid ── */}
      <div className="grid grid-cols-3 gap-5">

        {/* Billing */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
              <div className="w-[26px] h-[26px] bg-emerald-50 rounded-md flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1V13M4.5 3H8.5C9.3 3 10 3.7 10 4.5C10 5.3 9.3 6 8.5 6H4.5M4.5 6H9C9.8 6 10.5 6.7 10.5 7.5C10.5 8.3 9.8 9 9 9H4.5" stroke="#059669" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </div>
              Faturação Recente
            </div>
            <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-dim-100 text-dim-600 hover:bg-dim-200 transition-colors">Ver Tudo</button>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>{["Paciente","Fatura","Valor","Estado"].map((h, i) => (
                <th key={h} className={`text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-4 py-2 border-b border-dim-100 bg-dim-50 ${i === 2 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {recentInvoices.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-[13px] text-dim-400">Sem faturas recentes.</td></tr>
              ) : recentInvoices.map(inv => {
                const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.draft;
                return (
                  <tr key={inv.id} className="hover:bg-dim-50 transition-colors">
                    <td className="px-4 py-2.5 border-b border-dim-100 text-[12px] text-dim-900">{inv.patient.fullName}</td>
                    <td className="px-4 py-2.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">{inv.invoiceNumber}</td>
                    <td className={`px-4 py-2.5 border-b border-dim-100 font-mono text-[12px] font-semibold text-right ${st.amtCls}`}>{Number(inv.total).toLocaleString("pt-CV")} CVE</td>
                    <td className="px-4 py-2.5 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bar chart — real data from monthAppts grouped by service */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
              <div className="w-[26px] h-[26px] bg-brand-50 rounded-md flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 11L4.5 7.5L7 9.5L10 5L12.5 7" stroke="#0D8080" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><rect x=".5" y=".5" width="13" height="13" rx="1.5" stroke="#E8E8F0" strokeWidth="1" fill="none"/></svg>
              </div>
              Consultas por Serviço
            </div>
            <span className="font-mono text-[10px] text-dim-400">{monthAppts.length} este mês</span>
          </div>
          <div className="px-5 py-4">
            {serviceBars.length === 0 ? (
              <div className="h-20 flex items-center justify-center text-[12px] text-dim-400">Sem dados este mês.</div>
            ) : (
              <div className="flex items-end gap-1.5 h-20">
                {serviceBars.map(b => (
                  <div key={b.name} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className={`w-full ${b.cls} rounded-t hover:opacity-80 transition-opacity`} style={{ height: `${b.pct}%`, minHeight: 4 }}/>
                    <span className="font-mono text-[9px] text-dim-400">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-5 pb-4 pt-1 border-t border-dim-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-dim-500">Taxa de Ocupação (hoje)</span>
              <span className="font-mono text-[12px] font-semibold text-brand-700">{occupancyPct}%</span>
            </div>
            <div className="h-1.5 bg-dim-100 rounded-full">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${occupancyPct}%` }}/>
            </div>
          </div>
        </div>

        {/* Planos Ativos donut — real from health-plans API */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <div className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
              <div className="w-[26px] h-[26px] bg-violet-50 rounded-md flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L2 3.5V7C2 10 4.5 12.5 7 13C9.5 12.5 12 10 12 7V3.5L7 1Z" stroke="#7C3AED" strokeWidth="1.3" fill="none"/></svg>
              </div>
              Planos de Saúde Ativos
            </div>
          </div>

          {totalPlans === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-dim-400">
              <span className="text-[12px] font-medium text-dim-500">Sem planos ativos registados.</span>
            </div>
          ) : (
            <>
              {/* Visitas Domiciliárias — module not yet available */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-dim-100">
                <div className="flex items-center gap-2">
                  <div className="w-[26px] h-[26px] bg-amber-50 rounded-md flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 5L6 1.5L10.5 5V11H7.5V8H4.5V11H1.5V5Z" stroke="#D97706" strokeWidth="1.2" fill="none"/></svg>
                  </div>
                  <span className="text-[12px] font-semibold text-dim-700">Visitas Domiciliárias</span>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-full">Em breve</span>
              </div>

              {/* Donut */}
              <div className="border-t border-dim-100">
                <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-dim-500">Distribuição</div>
                <div className="flex items-center gap-4 px-5 py-3">
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="26" fill="none" stroke="#E8E8F0" strokeWidth="14"/>
                    {donutSegs.map((seg) => (
                      <circle
                        key={seg.name}
                        cx="36" cy="36" r="26" fill="none"
                        stroke={seg.color} strokeWidth="14"
                        strokeDasharray={`${seg.dash} ${seg.rest}`}
                        strokeDashoffset={seg.offset}
                        transform="rotate(-90 36 36)"
                      />
                    ))}
                    <text x="36" y="39" textAnchor="middle" fontFamily="var(--font-ibm-mono, monospace)" fontSize="11" fontWeight="700" fill="#2D2D44">{totalPlans}</text>
                  </svg>
                  <div className="flex-1 space-y-1.5">
                    {donutSegs.map(seg => (
                      <div key={seg.name} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: seg.color }}/>
                        <span className="text-[11px] text-dim-700 flex-1 truncate">{seg.name}</span>
                        <span className="font-mono text-[11px] font-bold text-dim-800">{seg.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </div>

    <Modal open={apptOpen} onClose={() => setApptOpen(false)} title="Nova Consulta">
      <div className="flex flex-col gap-3.5">
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Paciente *</label>
          <select className={inputCls} value={apptForm.patientId} onChange={e => setA("patientId", e.target.value)}>
            <option value="">Selecionar paciente…</option>
            {patients?.data?.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Serviço *</label>
          <select className={inputCls} value={apptForm.serviceId} onChange={e => setA("serviceId", e.target.value)}>
            <option value="">Selecionar serviço…</option>
            {servicesList?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Médico/a *</label>
          <select className={inputCls} value={apptForm.staffId} onChange={e => setA("staffId", e.target.value)}>
            <option value="">Selecionar médico…</option>
            {staffList?.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Data e Hora *</label>
          <input type="datetime-local" className={inputCls} value={apptForm.scheduledAt} onChange={e => setA("scheduledAt", e.target.value)}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Notas</label>
          <textarea className={inputCls} rows={2} placeholder="Observações..." value={apptForm.notes} onChange={e => setA("notes", e.target.value)}/>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setApptOpen(false)} className="px-4 py-2 text-[12px] font-semibold rounded-[10px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors">Cancelar</button>
          <button onClick={handleApptSubmit} disabled={apptSubmitting || !apptForm.patientId || !apptForm.staffId || !apptForm.serviceId || !apptForm.scheduledAt}
            className="px-4 py-2 text-[12px] font-semibold rounded-[10px] bg-brand-700 text-white hover:bg-brand-800 transition-colors disabled:opacity-50">
            {apptSubmitting ? "A guardar…" : "Adicionar"}
          </button>
        </div>
      </div>
    </Modal>

    <Modal open={patientOpen} onClose={() => setPatientOpen(false)} title="Novo Paciente">
      <div className="flex flex-col gap-3.5">
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Nome Completo *</label>
          <input className={inputCls} placeholder="Nome do paciente" value={patientForm.fullName} onChange={e => setP("fullName", e.target.value)}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Data de Nascimento *</label>
          <input type="date" className={inputCls} value={patientForm.dateOfBirth} onChange={e => setP("dateOfBirth", e.target.value)}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Telefone * (formato: +2389912345)</label>
          <input className={inputCls} placeholder="+2389912345" value={patientForm.phone} onChange={e => setP("phone", e.target.value)}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Email</label>
          <input type="email" className={inputCls} placeholder="email@exemplo.cv" value={patientForm.email} onChange={e => setP("email", e.target.value)}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-dim-500 mb-1.5">Género</label>
          <select className={inputCls} value={patientForm.gender} onChange={e => setP("gender", e.target.value)}>
            <option value="female">Feminino</option>
            <option value="male">Masculino</option>
            <option value="other">Outro</option>
          </select>
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer text-[12px] text-dim-700 leading-relaxed">
          <input type="checkbox" checked={patConsent} onChange={e => setPatConsent(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-dim-300 accent-brand-600 cursor-pointer shrink-0"/>
          Consentimento para recolha e tratamento de dados pessoais. <span className="text-red-500">*</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setPatientOpen(false)} className="px-4 py-2 text-[12px] font-semibold rounded-[10px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors">Cancelar</button>
          <button onClick={handlePatientSubmit} disabled={patSubmitting || !patientForm.fullName.trim() || !patientForm.phone || !patientForm.dateOfBirth || !patConsent}
            className="px-4 py-2 text-[12px] font-semibold rounded-[10px] bg-brand-700 text-white hover:bg-brand-800 transition-colors disabled:opacity-50">
            {patSubmitting ? "A guardar…" : "Adicionar"}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}
