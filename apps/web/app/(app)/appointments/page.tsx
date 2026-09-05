"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, CalendarDays, List, Clock, User, Stethoscope, DoorOpen, FileText } from "lucide-react";
import { io } from "socket.io-client";
import type { ServiceEntry, TimeSlot } from "@cap/types";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { validateScheduledAt } from "../../../lib/validate-schedule";
import { usePermissions } from "../hooks/use-permissions";

async function fetchAvailability(serviceId: string, staffId: string, date: string): Promise<TimeSlot[]> {
  const params = new URLSearchParams({ serviceId, staffId, date });
  const res = await fetch(`/api/appointments/availability?${params}`);
  if (!res.ok) return [];
  return res.json();
}

const CalendarView = dynamic(() => import("./_CalendarView"), {
  ssr: false,
  loading: () => (
    <div className="p-5 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-48 bg-dim-100 rounded" />
        <div className="flex gap-2">
          <div className="h-8 w-24 bg-dim-100 rounded" />
          <div className="h-8 w-24 bg-dim-100 rounded" />
          <div className="h-8 w-24 bg-dim-100 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-24 bg-dim-50 rounded border border-dim-100" />
        ))}
      </div>
    </div>
  ),
});

type AppointmentDetail = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
  createdAt: string;
  patient: { id: string; fullName: string; phone: string | null };
  staff: { id: string; fullName: string; role: string } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  room: { id: string; name: string } | null;
};

type Appointment = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  patient: { fullName: string };
  service: { name: string };
  staff?: { fullName: string };
};

async function fetchAppointments(from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/appointments?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar marcações");
  return res.json();
}

const STATUS_COLORS: Record<string, string> = {
  pending:    "#F59E0B",
  confirmed:  "#13A3A3",
  checked_in: "#8B5CF6",
  completed:  "#10B981",
  cancelled:  "#8E8EA8",
  no_show:    "#EF4444",
};

const STATUS_LEGEND = [
  { key: "pending",    label: "Pendente",   color: "#F59E0B" },
  { key: "confirmed",  label: "Confirmada", color: "#13A3A3" },
  { key: "checked_in", label: "Presente",   color: "#8B5CF6" },
  { key: "completed",  label: "Concluída",  color: "#10B981" },
  { key: "cancelled",  label: "Cancelada",  color: "#8E8EA8" },
  { key: "no_show",    label: "Faltou",     color: "#EF4444" },
];

const STATUS_PILL: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-700",
  confirmed:  "bg-brand-100 text-brand-800",
  checked_in: "bg-violet-100 text-violet-700",
  completed:  "bg-emerald-100 text-emerald-700",
  cancelled:  "bg-dim-100 text-dim-500",
  no_show:    "bg-red-100 text-red-600",
};

const TRANSITIONS: Record<string, { status: string; label: string; primary: boolean }[]> = {
  pending:    [{ status: "confirmed",  label: "Confirmar",      primary: true  },
               { status: "cancelled",  label: "Cancelar",       primary: false }],
  confirmed:  [{ status: "checked_in", label: "Check-in feito", primary: true  },
               { status: "cancelled",  label: "Cancelar",       primary: false }],
  checked_in: [{ status: "completed",  label: "Concluída",      primary: true  },
               { status: "no_show",    label: "Faltou",         primary: false }],
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

const BLANK_APPT = {
  patientId: "", serviceId: "", staffId: "", apptDate: "", apptTime: "", notes: "",
  recurring: false, frequency: "weekly" as "daily" | "weekly" | "monthly", interval: "1",
  endType: "count" as "count" | "date", occurrenceCount: "8", endDate: "",
};

export default function AppointmentsPage() {
  const { isLoading: permLoading, can, canDo } = usePermissions();
  const router = useRouter();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_APPT);
  const [submitting, setSubmitting] = useState(false);
  // One key per booking attempt — stable across retries of the same submit, regenerated once
  // the modal resets after a success so the next, separate booking gets its own key.
  const [apptIdempotencyKey, setApptIdempotencyKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();

  useEffect(() => {
    if (!permLoading && !can("appointments")) router.replace("/dashboard");
  }, [permLoading, can, router]);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetch(`/api/appointments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(async (r) => {
        if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro"); }
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      addMessage("Success", "Estado atualizado com sucesso!");
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      fetch(`/api/appointments/${id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt }),
      }).then(async (r) => {
        if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro"); }
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      addMessage("Success", "Marcação reagendada com sucesso!");
    },
  });

  function handleEventDrop(id: string, newStart: Date, revert: () => void) {
    rescheduleMutation.mutate(
      { id, scheduledAt: newStart.toISOString() },
      { onError: (err: Error) => { revert(); addMessage("Error", err.message); } }
    );
  }

  const { data: patients } = useQuery<{ data: { id: string; fullName: string }[] }>({
    queryKey: ["patients-list"],
    queryFn: () => fetch("/api/patients?limit=100").then((r) => r.json()),
    staleTime: 60_000,
  });
  const { data: staffList } = useQuery<{ id: string; fullName: string; specialtyCode: string | null }[]>({
    queryKey: ["staff-list"],
    queryFn: () => fetch("/api/staff").then((r) => r.json()),
    staleTime: 60_000,
  });
  const { data: servicesList = [] } = useQuery<ServiceEntry[]>({
    queryKey: ["services-list"],
    queryFn: () => fetch("/api/services").then((r) => r.json()),
    staleTime: 120_000,
  });

  const selectedService = servicesList.find((s) => s.id === form.serviceId);
  const staffOptions = staffList?.filter(
    (s) => !selectedService?.specialtyCode || s.specialtyCode === selectedService.specialtyCode
  );

  const { data: slots } = useQuery({
    queryKey: ["availability", form.serviceId, form.staffId, form.apptDate],
    queryFn: () => fetchAvailability(form.serviceId, form.staffId, form.apptDate),
    enabled: !!(form.serviceId && form.staffId && form.apptDate),
  });
  const availableSlots = slots?.filter((s) => s.available) ?? [];

  const { data: detail, isLoading: detailLoading } = useQuery<AppointmentDetail>({
    queryKey: ["appointment", selectedId],
    queryFn: () => fetch(`/api/appointments/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
  });

  function set<K extends keyof typeof BLANK_APPT>(k: K, v: (typeof BLANK_APPT)[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function handleDateClick(dateStr: string, isTimeGrid: boolean) {
    setForm(f => ({
      ...f,
      apptDate: dateStr.slice(0, 10),
      apptTime: isTimeGrid ? dateStr.slice(11, 16) : "",
    }));
    setNewOpen(true);
  }

  async function addAppt() {
    if (!form.patientId || !form.staffId || !form.serviceId || !form.apptDate || !form.apptTime) return;
    if (form.recurring && form.endType === "count" && !form.occurrenceCount) return;
    if (form.recurring && form.endType === "date" && !form.endDate) return;

    const scheduledAt = `${form.apptDate}T${form.apptTime}`;
    const scheduleError = validateScheduledAt(scheduledAt);
    if (scheduleError) {
      addMessage("Error", scheduleError);
      return;
    }

    setSubmitting(true);
    try {
      if (form.recurring) {
        const res = await fetch("/api/appointments/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId: form.patientId,
            staffId: form.staffId,
            serviceId: form.serviceId,
            scheduledAt: new Date(scheduledAt).toISOString(),
            notes: form.notes || undefined,
            source: "web",
            frequency: form.frequency,
            interval: Number(form.interval) || 1,
            ...(form.endType === "count"
              ? { occurrenceCount: Number(form.occurrenceCount) }
              : { endDate: form.endDate }),
            idempotencyKey: apptIdempotencyKey,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? "Erro ao criar marcações recorrentes");
        }
        const data = await res.json();
        setForm(BLANK_APPT);
        setNewOpen(false);
        setApptIdempotencyKey(crypto.randomUUID());
        queryClient.invalidateQueries({ queryKey: ["appointments"] });
        const skippedNote = data.skipped?.length
          ? ` (${data.skipped.length} não puderam ser criadas — conflito de horário ou feriado)`
          : "";
        addMessage("Success", `${data.created.length} marcações recorrentes criadas com sucesso!${skippedNote}`);
        return;
      }

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: form.patientId,
          staffId: form.staffId,
          serviceId: form.serviceId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          notes: form.notes || undefined,
          source: "web",
          idempotencyKey: apptIdempotencyKey,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "Erro ao criar marcação");
      }
      setForm(BLANK_APPT);
      setNewOpen(false);
      setApptIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      addMessage("Success", "Marcação criada com sucesso!");
    } catch (e: unknown) {
      addMessage("Error", e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  }

  const now = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const from = `${year}-${month}-01`;
  const to   = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;

  const { data: appointments, isLoading } = useQuery<Appointment[]>({
    queryKey: ["appointments", "calendar", from, to],
    queryFn: () => fetchAppointments(from, to),
    staleTime: 60_000,
  });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const socket = io(`${apiUrl}/calendar`, {
      path: "/socket.io",
      reconnectionAttempts: 3,
    });
    socket.on("appointment:created", () =>
      queryClient.invalidateQueries({ queryKey: ["appointments", "calendar", from, to] })
    );
    socket.on("appointment:updated", () =>
      queryClient.invalidateQueries({ queryKey: ["appointments", "calendar", from, to] })
    );
    return () => { socket.disconnect(); };
  }, [queryClient, from, to]);

  const allAppts = appointments ?? [];

  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set(STATUS_LEGEND.map((s) => s.key))
  );
  function toggleFilter(key: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const filteredAppts = allAppts.filter((a) => activeFilters.has(a.status));

  const events = filteredAppts.map((a) => ({
    id: a.id,
    title: `${a.patient.fullName} — ${a.service.name}`,
    start: a.scheduledAt,
    end: new Date(new Date(a.scheduledAt).getTime() + a.durationMinutes * 60_000).toISOString(),
    backgroundColor: STATUS_COLORS[a.status] ?? "#8E8EA8",
    borderColor: "transparent",
    textColor: "#ffffff",
    // Mirrors the backend's own rule (only pending/confirmed can be rescheduled) so dragging an
    // already-completed/cancelled appointment is visibly not offered, instead of letting the user
    // drag it and only finding out it's rejected after the fact.
    editable: ["pending", "confirmed"].includes(a.status),
    // Per-event `editable: true` overrides the calendar's global eventDurationEditable={false} —
    // FullCalendar treats it as "fully editable" unless durationEditable is also set here, so
    // resize (duration change, which reschedule has no concept of) has to be disabled per event too.
    durationEditable: false,
  }));

  const sortedList = [...filteredAppts].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  const today    = allAppts.length;
  const pending  = allAppts.filter((a) => a.status === "pending").length;
  const confirmed = allAppts.filter((a) => a.status === "confirmed").length;
  const completed = allAppts.filter((a) => a.status === "completed").length;

  return (
    <>
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Agendamentos</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">Calendário de consultas e marcações</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-dim-100 rounded-[10px] p-1">
            <button
              onClick={() => setView("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === "calendar" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Calendário
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                view === "list" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </button>
          </div>

          {canDo("appointments", "create") && (
            <button
              onClick={() => setNewOpen(true)}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova Marcação
            </button>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-3">
        {[
          { label: "Este mês", value: today,     cls: "bg-dim-100 text-dim-700" },
          { label: "Pendentes", value: pending,   cls: "bg-amber-50 text-amber-700 border border-amber-200/80" },
          { label: "Confirmadas", value: confirmed, cls: "bg-brand-50 text-brand-700 border border-brand-200/80" },
          { label: "Concluídas", value: completed, cls: "bg-emerald-50 text-emerald-700 border border-emerald-200/80" },
        ].map((s) => (
          <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-[12px] font-medium ${s.cls}`}>
            <span className="font-mono font-bold">{isLoading ? "…" : s.value}</span>
            {s.label}
          </div>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setActiveFilters(activeFilters.size === STATUS_LEGEND.length ? new Set() : new Set(STATUS_LEGEND.map((s) => s.key)))}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-opacity"
            style={activeFilters.size === STATUS_LEGEND.length
              ? { background: "#e8e8f0", color: "#4b4b6b" }
              : { background: "#f0f0f5", color: "#9898b0", opacity: 0.6 }
            }
          >
            Todos
          </button>
          {STATUS_LEGEND.map((s) => {
            const active = activeFilters.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => toggleFilter(s.key)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-opacity"
                style={active
                  ? { background: s.color + "18", color: s.color }
                  : { background: "#f0f0f5", color: "#9898b0", opacity: 0.6 }
                }
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: active ? s.color : "#9898b0" }} />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Calendar view */}
      {view === "calendar" && (
        <div className={CARD}>
          <CalendarView events={events} onEventClick={setSelectedId} onDateClick={handleDateClick} onEventDrop={handleEventDrop} />
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Lista de Marcações</h2>
            <span className="font-mono text-[11px] text-dim-400">{sortedList.length} registos</span>
          </div>

          {isLoading ? (
            <div className="divide-y divide-dim-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center gap-4 animate-pulse">
                  <div className="w-20 h-3 bg-dim-100 rounded" />
                  <div className="w-32 h-3 bg-dim-100 rounded" />
                  <div className="flex-1 h-3 bg-dim-100 rounded" />
                  <div className="w-20 h-5 bg-dim-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : sortedList.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                <CalendarDays className="w-6 h-6 text-dim-400" />
              </div>
              <p className="text-[13px] font-medium text-dim-600">Sem marcações este mês</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Data", "Hora", "Paciente", "Serviço", "Médico", "Estado", ""].map((h) => (
                    <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedList.map((a) => (
                  <tr key={a.id} className="hover:bg-dim-50 transition-colors group">
                    <td className="px-5 py-3 border-b border-dim-100 font-mono text-[11px] text-dim-600 whitespace-nowrap">
                      {format(new Date(a.scheduledAt), "dd MMM yyyy", { locale: pt })}
                    </td>
                    <td className="px-5 py-3 border-b border-dim-100 font-mono text-[12px] font-semibold text-dim-900">
                      {format(new Date(a.scheduledAt), "HH:mm")}
                    </td>
                    <td className="px-5 py-3 border-b border-dim-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-800 font-semibold text-[10px] flex items-center justify-center shrink-0">
                          {a.patient.fullName?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-[13px] font-medium text-dim-900">{a.patient.fullName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 border-b border-dim-100 text-[12px] text-dim-600">{a.service.name}</td>
                    <td className="px-5 py-3 border-b border-dim-100 text-[12px] text-dim-500">
                      {a.staff?.fullName ?? "—"}
                    </td>
                    <td className="px-5 py-3 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[a.status] ?? "bg-dim-100 text-dim-600"}`}>
                        {STATUS_LEGEND.find((s) => s.key === a.status)?.label ?? a.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 border-b border-dim-100">
                      <button
                        onClick={() => setSelectedId(a.id)}
                        className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Ver →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>

    <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova Marcação" description="Agende uma nova consulta ou procedimento" size="md">
      <div className="px-6 py-5 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Paciente *</label>
          <select value={form.patientId} onChange={(e) => set("patientId", e.target.value)} className={inputCls}>
            <option value="">Selecionar paciente…</option>
            {patients?.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Serviço *</label>
          <select
            value={form.serviceId}
            onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value, staffId: "", apptTime: "" }))}
            className={inputCls}
          >
            <option value="">Selecionar serviço…</option>
            {servicesList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Médico/a *</label>
          <select
            value={form.staffId}
            onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value, apptTime: "" }))}
            className={inputCls}
          >
            <option value="">Selecionar médico…</option>
            {staffOptions?.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Data *</label>
          <input
            type="date"
            value={form.apptDate}
            onChange={(e) => setForm((f) => ({ ...f, apptDate: e.target.value, apptTime: "" }))}
            className={inputCls}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-2">Horário Disponível *</label>
          {!form.serviceId || !form.staffId || !form.apptDate ? (
            <p className="text-[12px] text-dim-400">Selecione serviço, médico/a e data para ver os horários.</p>
          ) : availableSlots.length === 0 ? (
            <p className="text-[12px] text-dim-400">Sem horários disponíveis nesta data.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {availableSlots.map((slot) => {
                const hhmm = format(new Date(slot.start), "HH:mm");
                const isSelected = form.apptTime === hhmm;
                return (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => set("apptTime", hhmm)}
                    className={`flex items-center justify-center gap-1.5 border rounded-[10px] py-2 text-[12px] font-semibold transition-all ${
                      isSelected
                        ? "bg-brand-700 border-brand-700 text-white"
                        : "border-dim-200 text-dim-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    {hhmm}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Notas</label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Observações opcionais…" className={`${inputCls} resize-none`} />
        </div>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-dim-800 cursor-pointer">
            <input type="checkbox" checked={form.recurring} onChange={(e) => set("recurring", e.target.checked)} className="w-4 h-4 rounded border-dim-300 text-brand-700 focus:ring-brand-500" />
            Tornar recorrente
          </label>
        </div>
        {form.recurring && (
          <>
            <div>
              <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Repetir</label>
              <select value={form.frequency} onChange={(e) => set("frequency", e.target.value as typeof form.frequency)} className={inputCls}>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente</option>
                <option value="monthly">Mensalmente</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">A cada</label>
              <input type="number" min={1} value={form.interval} onChange={(e) => set("interval", e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-2 flex gap-4 text-[13px] text-dim-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="endType" checked={form.endType === "count"} onChange={() => set("endType", "count")} />
                Nº de sessões
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="endType" checked={form.endType === "date"} onChange={() => set("endType", "date")} />
                Até uma data
              </label>
            </div>
            {form.endType === "count" ? (
              <div>
                <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Nº de sessões *</label>
                <input type="number" min={1} max={104} value={form.occurrenceCount} onChange={(e) => set("occurrenceCount", e.target.value)} className={inputCls} />
              </div>
            ) : (
              <div>
                <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Até *</label>
                <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputCls} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
        <button
          onClick={addAppt}
          disabled={
            submitting || !form.patientId || !form.staffId || !form.serviceId || !form.apptDate || !form.apptTime ||
            (form.recurring && form.endType === "count" && !form.occurrenceCount) ||
            (form.recurring && form.endType === "date" && !form.endDate)
          }
          className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
        >
          {submitting ? "A guardar…" : form.recurring ? "Guardar Marcações" : "Guardar Marcação"}
        </button>
        <button onClick={() => setNewOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
          Cancelar
        </button>
      </div>
    </Modal>

    <Modal
      open={!!selectedId}
      onClose={() => setSelectedId(null)}
      title={detail?.patient.fullName ?? "Marcação"}
      description={detail ? `${detail.service?.name ?? "Consulta"} · ${format(new Date(detail.scheduledAt), "dd/MM/yyyy 'às' HH:mm")}` : undefined}
      size="md"
    >
      {detailLoading || !detail ? (
        <div className="px-6 py-8 flex flex-col gap-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-dim-100 rounded w-3/4" />
          ))}
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col divide-y divide-dim-100">
          {[
            { icon: <CalendarDays className="w-4 h-4" />, label: "Data e Hora", value: `${format(new Date(detail.scheduledAt), "dd/MM/yyyy")} · ${format(new Date(detail.scheduledAt), "HH:mm")} – ${format(new Date(new Date(detail.scheduledAt).getTime() + detail.durationMinutes * 60_000), "HH:mm")}` },
            { icon: <Clock className="w-4 h-4" />, label: "Duração", value: `${detail.durationMinutes} minutos` },
            { icon: <User className="w-4 h-4" />, label: "Paciente", value: `${detail.patient.fullName}${detail.patient.phone ? ` · ${detail.patient.phone}` : ""}` },
            { icon: <Stethoscope className="w-4 h-4" />, label: "Médico / Profissional", value: detail.staff?.fullName ?? "—" },
            { icon: <DoorOpen className="w-4 h-4" />, label: "Sala", value: detail.room?.name ?? "—" },
            { icon: <FileText className="w-4 h-4" />, label: "Notas", value: detail.notes ?? "Sem notas" },
          ].map(({ icon, label, value }) => (
            <div key={label} className="flex items-start gap-3 py-3">
              <div className="w-7 h-7 bg-dim-50 rounded-md flex items-center justify-center shrink-0 mt-0.5 text-dim-500">{icon}</div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim-400 mb-0.5">{label}</div>
                <div className="text-[13px] font-medium text-dim-900">{value}</div>
              </div>
            </div>
          ))}
          <div className="pt-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-dim-400">
              Estado: <span className={`font-semibold px-2 py-0.5 rounded-full ml-1 ${STATUS_PILL[detail.status] ?? "bg-dim-100 text-dim-600"}`}>{STATUS_LEGEND.find((s) => s.key === detail.status)?.label ?? detail.status}</span>
            </div>
            {TRANSITIONS[detail.status] && (
              <div className="flex gap-2">
                {TRANSITIONS[detail.status].map(({ status, label, primary }) => (
                  <button
                    key={status}
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: detail.id, status })}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-[8px] disabled:opacity-50 transition-colors ${
                      primary
                        ? "bg-brand-700 hover:bg-brand-800 text-white"
                        : "border border-red-200 text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {statusMutation.isPending ? "…" : label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
    </>
  );
}
