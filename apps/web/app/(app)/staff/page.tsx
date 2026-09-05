"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePermissions } from "../hooks/use-permissions";
import { Users2, Stethoscope, UserCheck, Clock, Phone, Mail, ChevronRight, Plus } from "lucide-react";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";

type StaffMember = {
  id: string;
  name: string;
  role: "doctor" | "nurse" | "receptionist" | "technician";
  jobTitle: string | null;
  specialty?: string;
  phone: string;
  email: string;
  shift: { start: string; end: string; days: string; dayNums: number[] };
  availability: ApiStaff["availability"];
  status: "on_duty" | "off_duty" | "on_leave";
  appointmentsToday: number;
  initials: string;
  color: string;
};

type ApiStaff = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  jobTitle: string | null;
  phone: string | null;
  specialtyCode: string | null;
  availability: { dayOfWeek: number; startTime: string; endTime: string }[];
};

type ParamOption = { id: number; valor: string; codigo: string | null };

const DOW_NAMES: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };

const DB_ROLE_MAP: Record<string, StaffMember["role"]> = {
  doctor: "doctor", nurse: "nurse", receptionist: "receptionist", lab_tech: "technician",
  admin: "receptionist", corporate_hr: "receptionist",
};

const UI_TO_DB_ROLE: Record<string, string> = {
  doctor: "doctor", nurse: "nurse", receptionist: "receptionist", technician: "lab_tech",
};

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
    availability: s.availability,
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
const DAYS_OF_WEEK = [
  { dow: 1, label: "Seg" }, { dow: 2, label: "Ter" }, { dow: 3, label: "Qua" },
  { dow: 4, label: "Qui" }, { dow: 5, label: "Sex" }, { dow: 6, label: "Sáb" }, { dow: 0, label: "Dom" },
];

function makeInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

const inputCls =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300";

function FieldRow({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}

type DayHours = { start: string; end: string };

type FormValues = {
  name: string; role: StaffMember["role"]; jobTitle: string; specialty: string;
  phone: string; email: string;
  days: number[]; hours: Record<number, DayHours>;
};

const DEFAULT_DAY_HOURS: DayHours = { start: "08:00", end: "17:00" };

const BLANK_FORM: FormValues = {
  name: "", role: "doctor", jobTitle: "", specialty: "", phone: "", email: "",
  days: [1, 2, 3, 4, 5],
  hours: { 1: DEFAULT_DAY_HOURS, 2: DEFAULT_DAY_HOURS, 3: DEFAULT_DAY_HOURS, 4: DEFAULT_DAY_HOURS, 5: DEFAULT_DAY_HOURS },
};

const FALLBACK_ROLES: ParamOption[] = [
  { id: 1, valor: "Médico/a",      codigo: "doctor"       },
  { id: 2, valor: "Enfermeiro/a",  codigo: "nurse"        },
  { id: 3, valor: "Recepcionista", codigo: "receptionist" },
  { id: 4, valor: "Técnico/a",     codigo: "lab_tech"     },
];

function StaffForm({ initialValues, onSave, onCancel, submitLabel, saving, jobTitleOptions, specialtyOptions }: {
  initialValues?: FormValues;
  onSave: (v: FormValues) => void;
  onCancel: () => void;
  submitLabel: string;
  saving?: boolean;
  jobTitleOptions: ParamOption[];
  specialtyOptions: ParamOption[];
}) {
  const [form, setForm] = useState<FormValues>(initialValues ?? BLANK_FORM);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const jobTitles = jobTitleOptions.length > 0 ? jobTitleOptions : FALLBACK_ROLES;

  function set<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    setErrs((prev) => ({ ...prev, [k]: "" }));
  }
  function toggleDay(dow: number) {
    setForm((f) => ({
      ...f,
      days: f.days.includes(dow) ? f.days.filter((d) => d !== dow) : [...f.days, dow],
      hours: f.hours[dow] ? f.hours : { ...f.hours, [dow]: DEFAULT_DAY_HOURS },
    }));
  }
  function setDayHours(dow: number, patch: Partial<DayHours>) {
    setForm((f) => ({ ...f, hours: { ...f.hours, [dow]: { ...(f.hours[dow] ?? DEFAULT_DAY_HOURS), ...patch } } }));
  }
  function selectJobTitle(val: string) {
    const entry = jobTitles.find((t) => (t.codigo ?? t.valor) === val);
    if (!entry) return;
    setForm((f) => ({
      ...f,
      jobTitle: entry.valor,
      role: (DB_ROLE_MAP[entry.codigo ?? ""] ?? "receptionist") as StaffMember["role"],
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const e2: Record<string, string> = {};
    if (!form.name.trim()) e2.name = "Nome é obrigatório";
    if (!form.phone.trim()) e2.phone = "Telefone é obrigatório";
    if (!form.email.trim()) e2.email = "Email é obrigatório";
    if (Object.keys(e2).length) { setErrs(e2); return; }
    onSave(form);
  }

  // derive selected job title value for the select element
  const selectedJobTitleValue =
    jobTitles.find((t) => t.valor === form.jobTitle)?.codigo ??
    jobTitles.find((t) => t.codigo === UI_TO_DB_ROLE[form.role])?.codigo ??
    jobTitles[0]?.codigo ?? "";

  return (
    <form onSubmit={submit}>
      <div className="px-6 py-5 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FieldRow label="Nome Completo" required error={errs.name}>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex: Dra. Maria Silva" className={inputCls} />
          </FieldRow>
        </div>

        <FieldRow label="Função" required>
          <select value={selectedJobTitleValue} onChange={(e) => selectJobTitle(e.target.value)} className={inputCls}>
            {jobTitles.map((t) => <option key={t.id} value={t.codigo ?? t.valor}>{t.valor}</option>)}
          </select>
        </FieldRow>

        <FieldRow label="Especialidade">
          {specialtyOptions.length > 0 ? (
            <select value={form.specialty} onChange={(e) => set("specialty", e.target.value)} className={inputCls}>
              <option value="">— Seleccionar —</option>
              {specialtyOptions.map((s) => <option key={s.id} value={s.codigo ?? s.valor}>{s.valor}</option>)}
            </select>
          ) : (
            <input value={form.specialty} onChange={(e) => set("specialty", e.target.value)} placeholder="Ex: Cardiologia" className={inputCls} />
          )}
        </FieldRow>

        <FieldRow label="Telefone" required error={errs.phone}>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+238 991 0000" className={inputCls} />
        </FieldRow>

        <FieldRow label="Email" required error={errs.email}>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nome@cap.cv" className={inputCls} />
        </FieldRow>

        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-2">Dias e Horário de Trabalho</label>
          <div className="flex flex-col gap-1.5">
            {DAYS_OF_WEEK.map(({ dow, label }) => {
              const checked = form.days.includes(dow);
              const dayHours = form.hours[dow] ?? DEFAULT_DAY_HOURS;
              return (
                <div key={dow} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleDay(dow)}
                    className={`w-14 shrink-0 px-3 py-1.5 rounded-[8px] text-[11px] font-semibold transition-colors border ${
                      checked
                        ? "bg-brand-700 text-white border-brand-700"
                        : "bg-white text-dim-500 border-dim-200 hover:border-dim-300"
                    }`}
                  >
                    {label}
                  </button>
                  {checked ? (
                    <div className="flex items-center gap-1.5">
                      <input type="time" value={dayHours.start} onChange={(e) => setDayHours(dow, { start: e.target.value })} className={`${inputCls} py-1.5`} />
                      <span className="text-[11px] text-dim-400">–</span>
                      <input type="time" value={dayHours.end} onChange={(e) => setDayHours(dow, { end: e.target.value })} className={`${inputCls} py-1.5`} />
                    </div>
                  ) : (
                    <span className="text-[11px] text-dim-300">Sem turno</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/60 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]"
        >
          {saving ? "A guardar…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
          Cancelar
        </button>
      </div>
    </form>
  );
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

function toApiBody(form: FormValues) {
  return {
    fullName: form.name.trim(),
    email: form.email.trim(),
    role: UI_TO_DB_ROLE[form.role] ?? form.role,
    jobTitle: form.jobTitle.trim() || undefined,
    phone: form.phone.trim() || undefined,
    specialtyCode: form.specialty.trim() || undefined,
    availability: form.days.map((dow) => ({
      dayOfWeek: dow,
      startTime: (form.hours[dow] ?? DEFAULT_DAY_HOURS).start,
      endTime: (form.hours[dow] ?? DEFAULT_DAY_HOURS).end,
    })),
  };
}

function toFormValues(m: StaffMember): FormValues {
  const hours: Record<number, DayHours> = {};
  for (const a of m.availability) hours[a.dayOfWeek] = { start: a.startTime, end: a.endTime };
  return {
    name: m.name,
    role: m.role,
    jobTitle: m.jobTitle ?? "",
    specialty: m.specialty ?? "",
    phone: m.phone === "—" ? "" : m.phone,
    email: m.email,
    days: m.shift.dayNums,
    hours,
  };
}

export default function StaffPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("staff")) router.replace("/dashboard");
  }, [permLoading, can, router]);
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);

  const { data: apiStaff = [], isLoading } = useQuery<ApiStaff[]>({
    queryKey: ["bff-staff"],
    queryFn: () => fetch("/api/bff/staff").then((r) => r.json()),
  });

  const { data: jobTitleOptions = [] } = useQuery<ParamOption[]>({
    queryKey: ["parametrizacao", "FUNCAO"],
    queryFn: () => fetch("/api/parametrizacao/FUNCAO").then((r) => r.json()),
    staleTime: 120_000,
  });

  const { data: specialtyOptions = [] } = useQuery<ParamOption[]>({
    queryKey: ["parametrizacao", "ESPECIALIDADE"],
    queryFn: () => fetch("/api/parametrizacao/ESPECIALIDADE").then((r) => r.json()),
    staleTime: 120_000,
  });

  const staff = apiStaff.map(toUiMember);

  const createMutation = useMutation({
    mutationFn: (body: object) => fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao criar colaborador"); }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bff-staff"] });
      addMessage("Success", "Colaborador adicionado com sucesso!");
      setNewOpen(false);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => fetch(`/api/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar alterações"); }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bff-staff"] });
      addMessage("Success", "Alterações guardadas com sucesso!");
      setEditingStaff(null);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const onDuty     = staff.filter((s) => s.status === "on_duty").length;
  const doctors    = staff.filter((s) => s.role === "doctor").length;
  const nurses     = staff.filter((s) => s.role === "nurse").length;
  const totalAppts = staff.filter((s) => s.status === "on_duty").reduce((sum, s) => sum + s.appointmentsToday, 0);

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold text-dim-900">Equipa & Turnos</h1>
            <p className="text-[13px] text-dim-500 mt-0.5">Gestão de colaboradores e horários</p>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Colaborador
          </button>
        </div>

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
                <div
                  key={member.id}
                  onClick={() => setEditingStaff(member)}
                  className={`${CARD} hover:border-brand-300 transition-colors cursor-pointer`}
                >
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
                          <a href={`tel:${member.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11px] text-dim-500 hover:text-dim-800 transition-colors">
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
                {["Colaborador", "Função", "Horário", "Dias", "Contacto", "Consultas Hoje", "Estado", ""].map((h) => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && staff.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar colaboradores...</td></tr>
              )}
              {staff.map((member) => {
                const roleMeta   = ROLE_META[member.role];
                const statusMeta = STATUS_META[member.status];
                return (
                  <tr key={member.id} className="hover:bg-dim-50 transition-colors group">
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
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <button
                        onClick={() => setEditingStaff(member)}
                        className="flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Editar <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New staff modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Novo Colaborador" description="Adicione um novo membro à equipa" size="lg">
        <StaffForm
          onSave={(form) => createMutation.mutate(toApiBody(form))}
          onCancel={() => setNewOpen(false)}
          submitLabel="Adicionar Colaborador"
          saving={createMutation.isPending}
          jobTitleOptions={jobTitleOptions}
          specialtyOptions={specialtyOptions}
        />
      </Modal>

      {/* Edit staff modal */}
      <Modal
        open={!!editingStaff}
        onClose={() => setEditingStaff(null)}
        title="Editar Colaborador"
        description={editingStaff?.name}
        size="lg"
      >
        {editingStaff && (
          <StaffForm
            initialValues={toFormValues(editingStaff)}
            onSave={(form) => editMutation.mutate({ id: editingStaff.id, body: toApiBody(form) })}
            onCancel={() => setEditingStaff(null)}
            submitLabel="Guardar Alterações"
            saving={editMutation.isPending}
            jobTitleOptions={jobTitleOptions}
            specialtyOptions={specialtyOptions}
          />
        )}
      </Modal>
    </>
  );
}
