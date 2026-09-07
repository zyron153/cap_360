"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePermissions } from "../hooks/use-permissions";
import { Users2, Stethoscope, UserCheck, Clock, Phone, Mail, CalendarDays, Table2 } from "lucide-react";
import AvailabilityCalendar from "./_AvailabilityCalendar";
import { DB_ROLE_MAP, type ApiStaff, type UiRole } from "../../../components/staff/StaffForm";

type StaffMember = {
  id: string;
  name: string;
  role: UiRole;
  jobTitle: string | null;
  specialty?: string;
  phone: string;
  email: string;
  shift: { start: string; end: string; days: string; dayNums: number[] };
  status: "on_duty" | "off_duty" | "on_leave";
  appointmentsToday: number;
  initials: string;
  color: string;
};

const DOW_NAMES: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };

function toUiMember(s: ApiStaff, idx: number): StaffMember {
  const todayDow = new Date().getDay();
  const todayAvail = s.availability.filter((a) => a.dayOfWeek === todayDow);
  const dayNums = [...new Set(s.availability.map((a) => a.dayOfWeek))].sort();
  const allDays = dayNums.map((d) => DOW_NAMES[d]).join(", ");
  return {
    id: s.id,
    name: s.fullName,
    role: DB_ROLE_MAP[s.role] ?? "receptionist",
    jobTitle: s.jobTitle ?? null,
    specialty: s.specialtyCode ?? undefined,
    phone: s.phone ?? "—",
    email: s.email,
    shift: {
      start: todayAvail[0]?.startTime ?? "—",
      end:   todayAvail[0]?.endTime   ?? "—",
      days:  allDays || "—",
      dayNums,
    },
    status: todayAvail.length > 0 ? "on_duty" : "off_duty",
    appointmentsToday: 0,
    initials: makeInitials(s.fullName),
    color: COLORS[idx % COLORS.length],
  };
}

const ROLE_META: Record<string, { label: string; plural: string; bg: string; cls: string }> = {
  doctor:       { label: "Médico",        plural: "Médicos",    bg: "bg-brand-50",   cls: "text-brand-700"   },
  nurse:        { label: "Enfermeira/o",  plural: "Enfermagem", bg: "bg-emerald-50", cls: "text-emerald-700" },
  receptionist: { label: "Recepcionista", plural: "Recepção",   bg: "bg-amber-50",   cls: "text-amber-700"   },
  technician:   { label: "Técnico",       plural: "Técnicos",   bg: "bg-violet-50",  cls: "text-violet-700"  },
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  on_duty:  { label: "Em Serviço", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80", dot: "bg-emerald-500" },
  off_duty: { label: "Fora",       cls: "bg-dim-100 text-dim-500",                                   dot: "bg-dim-400"     },
  on_leave: { label: "De Férias",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",       dot: "bg-amber-400"   },
};

const COLORS = ["bg-brand-700","bg-violet-700","bg-blue-700","bg-emerald-700","bg-teal-700","bg-amber-700","bg-orange-700","bg-rose-700","bg-pink-700","bg-indigo-700"];

function makeInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

// Staff onboarding, editing, and deactivation all live under Gestão de Acesso → Utilizadores now
// (one canonical place instead of duplicated create/edit UI here) — this page is a read-only
// roster of the same data, plus the availability-blocking calendar, which stays here since it's
// a scheduling concern, not an identity one.
export default function StaffPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("staff")) router.replace("/dashboard");
  }, [permLoading, can, router]);
  const [view, setView] = useState<"overview" | "calendar">("overview");

  const { data: apiStaff = [], isLoading } = useQuery<ApiStaff[]>({
    queryKey: ["bff-staff"],
    queryFn: () => fetch("/api/bff/staff").then((r) => r.json()),
  });

  const staff = apiStaff.map(toUiMember);

  const onDuty     = staff.filter((s) => s.status === "on_duty").length;
  const doctors    = staff.filter((s) => s.role === "doctor").length;
  const nurses     = staff.filter((s) => s.role === "nurse").length;
  const totalAppts = staff.filter((s) => s.status === "on_duty").reduce((sum, s) => sum + s.appointmentsToday, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Equipa & Turnos</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">Gestão de colaboradores e horários</p>
        </div>
        <div className="flex items-center gap-1 bg-dim-100 rounded-[10px] p-1">
          <button
            onClick={() => setView("overview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              view === "overview" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            Visão Geral
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              view === "calendar" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Calendário de Disponibilidade
          </button>
        </div>
      </div>

      {view === "calendar" && <AvailabilityCalendar />}

      {view === "overview" && (
      <>
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Users2,      label: "Em Serviço",     value: onDuty,     sub: `de ${staff.length} total`, bg: "bg-emerald-50", cls: "text-emerald-600" },
          { icon: Stethoscope, label: "Médicos",         value: doctors,    sub: "na equipa clínica",        bg: "bg-brand-50",   cls: "text-brand-600"   },
          { icon: UserCheck,   label: "Enfermagem",      value: nurses,     sub: "incluindo técnicos",       bg: "bg-violet-50",  cls: "text-violet-600"  },
          { icon: Clock,       label: "Consultas Hoje",  value: totalAppts, sub: "equipa em serviço",        bg: "bg-amber-50",   cls: "text-amber-600"   },
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

      {/* Role overview */}
      <div className="grid grid-cols-4 gap-3">
        {(["doctor", "nurse", "receptionist", "technician"] as const).map((role) => {
          const members = staff.filter((s) => s.role === role);
          const active  = members.filter((s) => s.status === "on_duty").length;
          const meta    = ROLE_META[role];
          return (
            <div key={role} className={CARD}>
              <div className="px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${meta.bg} ${meta.cls}`}>
                    {meta.plural}
                  </span>
                  <span className="font-mono text-[11px] text-dim-400">{members.length} total</span>
                </div>
                <p className="font-display font-bold text-[26px] text-dim-900 leading-none">{active}</p>
                <p className="text-[11px] text-dim-500 mt-0.5">em serviço agora</p>
                <div className="mt-3 flex gap-1">
                  {members.map((m) => (
                    <div key={m.id} title={m.name} className={`w-6 h-6 rounded-full ${m.color} flex items-center justify-center text-white text-[9px] font-bold ${m.status !== "on_duty" ? "opacity-30" : ""}`}>
                      {m.initials[0]}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Staff cards — on duty */}
      <div>
        <h2 className="font-display text-[14px] font-semibold text-dim-800 mb-3">Em Serviço Hoje</h2>
        <div className="grid grid-cols-3 gap-4">
          {staff.filter((s) => s.status === "on_duty").map((member) => {
            const roleMeta = ROLE_META[member.role];
            return (
              <div key={member.id} className={CARD}>
                <div className="px-5 py-5">
                  <div className="flex items-start gap-3.5">
                    <div className={`w-11 h-11 rounded-full ${member.color} flex items-center justify-center text-white font-bold text-[13px] shrink-0`}>
                      {member.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-semibold text-dim-900 truncate">{member.name}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${roleMeta.bg} ${roleMeta.cls}`}>
                          {roleMeta.label}
                        </span>
                      </div>
                      {member.specialty && <p className="text-[11px] text-dim-500 mt-0.5 truncate">{member.specialty}</p>}
                      <div className="flex items-center gap-3 mt-3">
                        <div className="flex items-center gap-1 text-[11px] text-dim-500">
                          <Clock className="w-3 h-3 text-dim-400" />
                          <span className="font-mono">{member.shift.start} – {member.shift.end}</span>
                        </div>
                        {member.appointmentsToday > 0 && (
                          <div className="flex items-center gap-1 text-[11px] text-brand-600 font-semibold">
                            <span className="font-mono">{member.appointmentsToday}</span>
                            <span className="text-dim-400 font-normal">consultas</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-[11px] text-dim-500 hover:text-dim-800 transition-colors">
                          <Phone className="w-3 h-3" /> {member.phone}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full staff table */}
      <div className={CARD}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
          <h2 className="font-display text-[14px] font-semibold text-dim-900">Toda a Equipa</h2>
          <span className="font-mono text-[11px] text-dim-400">{staff.length} colaboradores</span>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Colaborador", "Função", "Horário", "Dias", "Contacto", "Consultas Hoje", "Estado"].map((h) => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && staff.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar colaboradores...</td></tr>
            )}
            {staff.map((member) => {
              const roleMeta   = ROLE_META[member.role];
              const statusMeta = STATUS_META[member.status];
              return (
                <tr key={member.id} className="hover:bg-dim-50 transition-colors">
                  <td className="px-5 py-3.5 border-b border-dim-100">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full ${member.color} flex items-center justify-center text-white font-bold text-[11px] shrink-0`}>
                        {member.initials}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-dim-900">{member.name}</p>
                        {member.specialty && <p className="text-[11px] text-dim-400">{member.specialty}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 border-b border-dim-100">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${roleMeta.bg} ${roleMeta.cls}`}>
                      {roleMeta.label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-700">
                    {member.shift.start} – {member.shift.end}
                  </td>
                  <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-500">{member.shift.days}</td>
                  <td className="px-5 py-3.5 border-b border-dim-100">
                    <div className="flex flex-col gap-0.5">
                      <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-[11px] text-dim-600 hover:text-brand-600 transition-colors">
                        <Phone className="w-3 h-3" /> {member.phone}
                      </a>
                      <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-[11px] text-dim-400 hover:text-brand-600 transition-colors truncate max-w-[160px]">
                        <Mail className="w-3 h-3 shrink-0" /> {member.email}
                      </a>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 border-b border-dim-100">
                    {member.appointmentsToday > 0 ? (
                      <span className="font-mono text-[13px] font-bold text-dim-900">{member.appointmentsToday}</span>
                    ) : (
                      <span className="text-[12px] text-dim-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 border-b border-dim-100">
                    <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusMeta.cls}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                      {statusMeta.label}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
