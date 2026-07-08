"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePermissions } from "../hooks/use-permissions";
import { Home, Clock, CheckCircle, MapPin, Plus, ChevronRight, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/modal";

type Visit = {
  id: string;
  ref: string;
  patient: string;
  address: string;
  zone: string;
  type: "routine" | "post_op" | "follow_up" | "urgent";
  assignedTo: string;
  assignedInitials: string;
  assignedColor: string;
  scheduledAt: string;
  duration: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  priority: "normal" | "high";
};

const VISITS_INITIAL: Visit[] = [
  { id: "v1",  ref: "VD-2406-001", patient: "Rosa Mendes",      address: "Rua da Achada, n.º 12",       zone: "São Vicente",  type: "routine",   assignedTo: "Enf. Sofia Lima",   assignedInitials: "SL", assignedColor: "bg-emerald-700", scheduledAt: "2026-06-19T09:00", duration: 45, status: "completed",   priority: "normal" },
  { id: "v2",  ref: "VD-2406-002", patient: "Manuel Faria",     address: "Bairro de Achada Grande, 5",  zone: "Praia",        type: "post_op",   assignedTo: "Enf. Carlos Neves", assignedInitials: "CN", assignedColor: "bg-teal-700",    scheduledAt: "2026-06-19T10:30", duration: 60, status: "completed",   priority: "high"   },
  { id: "v3",  ref: "VD-2406-003", patient: "Filomena Costa",   address: "Achada Santo António, 18",    zone: "Praia",        type: "follow_up", assignedTo: "Enf. Sofia Lima",   assignedInitials: "SL", assignedColor: "bg-emerald-700", scheduledAt: "2026-06-19T13:00", duration: 30, status: "in_progress", priority: "normal" },
  { id: "v4",  ref: "VD-2406-004", patient: "João Barbosa",     address: "Plateau, Rua de Lisboa, 3",   zone: "Praia",        type: "urgent",    assignedTo: "Dr. Nuno Barros",   assignedInitials: "NB", assignedColor: "bg-violet-700",  scheduledAt: "2026-06-19T14:00", duration: 45, status: "scheduled",   priority: "high"   },
  { id: "v5",  ref: "VD-2406-005", patient: "Graça Monteiro",   address: "Vila Nova, Rua dos Flores",   zone: "São Filipe",   type: "routine",   assignedTo: "Enf. Carlos Neves", assignedInitials: "CN", assignedColor: "bg-teal-700",    scheduledAt: "2026-06-19T15:30", duration: 30, status: "scheduled",   priority: "normal" },
  { id: "v6",  ref: "VD-2406-006", patient: "António Neves",    address: "Mindelo Centro, n.º 44",      zone: "São Vicente",  type: "follow_up", assignedTo: "Enf. Sofia Lima",   assignedInitials: "SL", assignedColor: "bg-emerald-700", scheduledAt: "2026-06-18T10:00", duration: 30, status: "completed",   priority: "normal" },
  { id: "v7",  ref: "VD-2406-007", patient: "Maria Vera Cruz",  address: "Palmarejo, Bloco C, Apt. 4",  zone: "Praia",        type: "post_op",   assignedTo: "Dr. Nuno Barros",   assignedInitials: "NB", assignedColor: "bg-violet-700",  scheduledAt: "2026-06-18T14:00", duration: 60, status: "completed",   priority: "high"   },
  { id: "v8",  ref: "VD-2406-008", patient: "César Lima",       address: "Tira Chapéu, Rua Central",    zone: "Praia",        type: "routine",   assignedTo: "Enf. Carlos Neves", assignedInitials: "CN", assignedColor: "bg-teal-700",    scheduledAt: "2026-06-18T16:00", duration: 30, status: "cancelled",   priority: "normal" },
  { id: "v9",  ref: "VD-2406-009", patient: "Isabel Rodrigues", address: "Espargos, Rua da Paz, 7",     zone: "Sal",          type: "urgent",    assignedTo: "Enf. Sofia Lima",   assignedInitials: "SL", assignedColor: "bg-emerald-700", scheduledAt: "2026-06-17T09:30", duration: 45, status: "completed",   priority: "high"   },
  { id: "v10", ref: "VD-2406-010", patient: "Paulo Ferreira",   address: "Cidade da Praia, Zona Alta",  zone: "Praia",        type: "follow_up", assignedTo: "Dr. Nuno Barros",   assignedInitials: "NB", assignedColor: "bg-violet-700",  scheduledAt: "2026-06-17T11:00", duration: 30, status: "completed",   priority: "normal" },
];

const TYPE_META: Record<string, { label: string; bg: string; cls: string }> = {
  routine:   { label: "Rotina",         bg: "bg-dim-100",   cls: "text-dim-600"    },
  post_op:   { label: "Pós-Operatório", bg: "bg-violet-50", cls: "text-violet-700" },
  follow_up: { label: "Seguimento",     bg: "bg-brand-50",  cls: "text-brand-700"  },
  urgent:    { label: "Urgente",        bg: "bg-red-50",    cls: "text-red-600"    },
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  scheduled:   { label: "Agendada",  cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80",       dot: "bg-brand-500"                   },
  in_progress: { label: "Em Curso",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",       dot: "bg-amber-500 animate-pulse"     },
  completed:   { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80", dot: "bg-emerald-500"                 },
  cancelled:   { label: "Cancelada", cls: "bg-dim-100 text-dim-400",                                   dot: "bg-dim-300"                     },
};

const COLORS = ["bg-emerald-700", "bg-teal-700", "bg-violet-700", "bg-brand-700", "bg-rose-700"];

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const todayRef = "2026-06-19";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-dim-700">{label}</label>
      {children}
    </div>
  );
}

const FALLBACK_VISIT_TYPES = [
  { value: "routine",   label: "Rotina"         },
  { value: "post_op",   label: "Pós-Operatório" },
  { value: "follow_up", label: "Seguimento"      },
  { value: "urgent",    label: "Urgente"         },
];

export default function VisitsPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("visits")) router.replace("/dashboard");
  }, [permLoading, can, router]);
  const [visits, setVisits] = useState<Visit[]>(VISITS_INITIAL);
  const [newOpen, setNewOpen] = useState(false);
  const [viewingVisit, setViewingVisit] = useState<Visit | null>(null);

  const { data: visitTypeParams = [] } = useQuery<{ id: number; valor: string; codigo: string | null }[]>({
    queryKey: ["parametrizacao", "TIPO_CONSULTA"],
    queryFn: () => fetch("/api/parametrizacao/TIPO_CONSULTA").then(r => r.json()),
    staleTime: 120_000,
  });
  const visitTypeOptions = visitTypeParams.length > 0
    ? visitTypeParams.map(p => ({ value: p.codigo ?? p.valor, label: p.valor }))
    : FALLBACK_VISIT_TYPES;
  const [form, setForm] = useState({
    patient: "", address: "", zone: "", type: "routine",
    assignedTo: "", scheduledAt: "", duration: "30", priority: "normal",
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function addVisit() {
    if (!form.patient.trim() || !form.scheduledAt) return;
    const n = visits.length + 1;
    const initials = form.assignedTo.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "—";
    setVisits(vs => [{
      id: `v${n}`,
      ref: `VD-2406-${String(n).padStart(3, "0")}`,
      patient: form.patient.trim(),
      address: form.address.trim(),
      zone: form.zone.trim() || "Praia",
      type: form.type as Visit["type"],
      assignedTo: form.assignedTo.trim(),
      assignedInitials: initials,
      assignedColor: COLORS[n % COLORS.length],
      scheduledAt: form.scheduledAt,
      duration: Number(form.duration) || 30,
      status: "scheduled",
      priority: form.priority as Visit["priority"],
    }, ...vs]);
    setForm({ patient: "", address: "", zone: "", type: "routine", assignedTo: "", scheduledAt: "", duration: "30", priority: "normal" });
    setNewOpen(false);
  }

  const todayVisits = visits.filter((v) => v.scheduledAt.startsWith(todayRef));
  const scheduled  = todayVisits.filter((v) => v.status === "scheduled").length;
  const inProgress = todayVisits.filter((v) => v.status === "in_progress").length;
  const completed  = todayVisits.filter((v) => v.status === "completed").length;

  return (
    <>
      <div className="flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold text-dim-900">Visitas Domiciliárias</h1>
            <p className="text-[13px] text-dim-500 mt-0.5">Gestão de visitas e cuidados ao domicílio</p>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Visita
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { icon: Home,          label: "Visitas Hoje", value: todayVisits.length, sub: "total agendadas",   bg: "bg-dim-100",    cls: "text-dim-600"     },
            { icon: Clock,         label: "Agendadas",    value: scheduled,          sub: "a realizar hoje",   bg: "bg-brand-50",   cls: "text-brand-600"   },
            { icon: AlertTriangle, label: "Em Curso",     value: inProgress,         sub: "deslocação activa", bg: "bg-amber-50",   cls: "text-amber-600"   },
            { icon: CheckCircle,   label: "Concluídas",   value: completed,          sub: "realizadas hoje",   bg: "bg-emerald-50", cls: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className={CARD}>
              <div className="px-5 py-5">
                <div className={`w-9 h-9 ${s.bg} rounded-[10px] flex items-center justify-center mb-3`}>
                  <s.icon className={s.cls} style={{ width: 18, height: 18 }} />
                </div>
                <p className="font-display font-bold text-[28px] text-dim-900 leading-none">{s.value}</p>
                <p className="text-[12px] font-semibold text-dim-700 mt-1">{s.label}</p>
                <p className="text-[11px] text-dim-400 mt-0.5">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Today's active visits */}
        {todayVisits.filter((v) => v.status !== "completed").length > 0 && (
          <div>
            <h2 className="font-display text-[14px] font-semibold text-dim-800 mb-3">Hoje em Curso</h2>
            <div className="grid grid-cols-3 gap-4">
              {todayVisits.filter((v) => v.status !== "completed").map((v) => {
                const statusMeta = STATUS_META[v.status];
                const typeMeta   = TYPE_META[v.type];
                const time = v.scheduledAt.split("T")[1];
                return (
                  <div key={v.id} className={`${CARD} ${v.priority === "high" ? "border-red-200" : ""}`}>
                    <div className="px-4 py-4">
                      {v.priority === "high" && (
                        <div className="flex items-center gap-1.5 mb-3 text-[10px] font-bold text-red-600">
                          <AlertTriangle style={{ width: 10, height: 10 }} />
                          PRIORIDADE ALTA
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="text-[14px] font-semibold text-dim-900">{v.patient}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin style={{ width: 10, height: 10 }} className="text-dim-400" />
                            <span className="text-[11px] text-dim-500">{v.zone}</span>
                          </div>
                        </div>
                        <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusMeta.cls}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                          {statusMeta.label}
                        </div>
                      </div>
                      <p className="text-[11px] text-dim-500 mb-3">{v.address}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${v.assignedColor} flex items-center justify-center text-white text-[9px] font-bold`}>
                            {v.assignedInitials}
                          </div>
                          <span className="text-[11px] text-dim-600">{v.assignedTo}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] font-mono text-dim-700">
                          <Clock style={{ width: 10, height: 10 }} className="text-dim-400" />
                          {time} · {v.duration}min
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-dim-100 flex items-center justify-between">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.cls}`}>
                          {typeMeta.label}
                        </span>
                        <span className="font-mono text-[10px] text-dim-400">{v.ref}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All visits table */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Todas as Visitas</h2>
            <span className="font-mono text-[11px] text-dim-400">{visits.length} registos</span>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Ref.", "Paciente", "Tipo", "Zona", "Hora", "Profissional", "Duração", "Estado", ""].map((h) => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => {
                const typeMeta   = TYPE_META[v.type];
                const statusMeta = STATUS_META[v.status];
                const [datePart, timePart] = v.scheduledAt.split("T");
                const dateStr = new Date(datePart).toLocaleDateString("pt-CV", { day: "2-digit", month: "short" });
                return (
                  <tr key={v.id} className="hover:bg-dim-50 transition-colors group">
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-1.5">
                        {v.priority === "high" && <AlertTriangle style={{ width: 10, height: 10 }} className="text-red-500 shrink-0" />}
                        <span className="font-mono text-[11px] font-semibold text-dim-600">{v.ref}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-800 font-semibold text-[10px] flex items-center justify-center shrink-0">
                          {v.patient[0]}
                        </div>
                        <span className="text-[13px] font-medium text-dim-900">{v.patient}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.cls}`}>
                        {typeMeta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-1 text-[12px] text-dim-600">
                        <MapPin style={{ width: 10, height: 10 }} className="text-dim-400 shrink-0" />
                        {v.zone}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-600">
                      {dateStr} · {timePart}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full ${v.assignedColor} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                          {v.assignedInitials}
                        </div>
                        <span className="text-[12px] text-dim-700">{v.assignedTo}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-600">
                      {v.duration} min
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusMeta.cls}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                        {statusMeta.label}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <button
                        onClick={() => setViewingVisit(v)}
                        className="flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Ver <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Visit Modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova Visita Domiciliária" size="md">
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Paciente *">
              <input value={form.patient} onChange={e => set("patient", e.target.value)} placeholder="Nome do paciente" className={inputCls} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Morada *">
              <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="Rua, n.º, Bairro" className={inputCls} />
            </Field>
          </div>
          <Field label="Zona">
            <input value={form.zone} onChange={e => set("zone", e.target.value)} placeholder="Praia, São Vicente…" className={inputCls} />
          </Field>
          <Field label="Tipo">
            <select value={form.type} onChange={e => set("type", e.target.value)} className={inputCls}>
              {visitTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Profissional">
            <input value={form.assignedTo} onChange={e => set("assignedTo", e.target.value)} placeholder="Enf. Nome Apelido" className={inputCls} />
          </Field>
          <Field label="Duração (min)">
            <input type="number" value={form.duration} onChange={e => set("duration", e.target.value)} min="10" max="180" className={inputCls} />
          </Field>
          <Field label="Data e Hora *">
            <input type="datetime-local" value={form.scheduledAt} onChange={e => set("scheduledAt", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Prioridade">
            <select value={form.priority} onChange={e => set("priority", e.target.value)} className={inputCls}>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
            </select>
          </Field>
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button
            onClick={addVisit}
            className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
          >
            Guardar Visita
          </button>
          <button
            onClick={() => setNewOpen(false)}
            className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
          >
            Cancelar
          </button>
        </div>
      </Modal>

      {/* View Visit Modal */}
      <Modal open={!!viewingVisit} onClose={() => setViewingVisit(null)} title={viewingVisit?.patient ?? ""} description={viewingVisit?.ref} size="md">
        {viewingVisit && (
          <div className="px-6 py-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              {([
                ["Referência",  viewingVisit.ref],
                ["Estado",      STATUS_META[viewingVisit.status].label],
                ["Tipo",        TYPE_META[viewingVisit.type].label],
                ["Prioridade",  viewingVisit.priority === "high" ? "Alta" : "Normal"],
                ["Profissional",viewingVisit.assignedTo || "—"],
                ["Duração",     `${viewingVisit.duration} min`],
                ["Data e Hora", viewingVisit.scheduledAt.replace("T", " às ")],
                ["Zona",        viewingVisit.zone || "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">{label}</dt>
                  <dd className="text-[13px] text-dim-900 font-medium mt-0.5">{value}</dd>
                </div>
              ))}
              <div className="col-span-2">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Morada</dt>
                <dd className="text-[13px] text-dim-900 font-medium mt-0.5">{viewingVisit.address}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </>
  );
}
