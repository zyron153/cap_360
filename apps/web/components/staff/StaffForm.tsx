"use client";

import { useState } from "react";

export type ApiStaff = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  jobTitle: string | null;
  phone: string | null;
  specialtyCode: string | null;
  companyId?: string | null;
  availability: { dayOfWeek: number; startTime: string; endTime: string }[];
};

export type ParamOption = { id: number; valor: string; codigo: string | null };

export type UiRole = "doctor" | "nurse" | "receptionist" | "technician";

// DB role (StaffRole enum) <-> the 4 onboardable UI roles. corporate_hr and admin accounts
// aren't created through this form — admin is seeded, corporate_hr has no self-service flow yet.
export const DB_ROLE_MAP: Record<string, UiRole> = {
  doctor: "doctor", nurse: "nurse", receptionist: "receptionist", lab_tech: "technician",
  admin: "receptionist", corporate_hr: "receptionist",
};
export const UI_TO_DB_ROLE: Record<UiRole, string> = {
  doctor: "doctor", nurse: "nurse", receptionist: "receptionist", technician: "lab_tech",
};

export type DayHours = { start: string; end: string };

export type FormValues = {
  name: string; role: UiRole; jobTitle: string; specialty: string;
  phone: string; email: string;
  days: number[]; hours: Record<number, DayHours>;
};

export const DEFAULT_DAY_HOURS: DayHours = { start: "08:00", end: "17:00" };

export const BLANK_FORM: FormValues = {
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

const DAYS_OF_WEEK = [
  { dow: 1, label: "Seg" }, { dow: 2, label: "Ter" }, { dow: 3, label: "Qua" },
  { dow: 4, label: "Qui" }, { dow: 5, label: "Sex" }, { dow: 6, label: "Sáb" }, { dow: 0, label: "Dom" },
];

export const inputCls =
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

/** POST /staff/invite (create, InviteStaffSchema === CreateStaffSchema) or PATCH /staff/:id (edit) body. */
export function toApiBody(form: FormValues) {
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

export function toFormValues(s: ApiStaff): FormValues {
  const hours: Record<number, DayHours> = {};
  for (const a of s.availability) hours[a.dayOfWeek] = { start: a.startTime, end: a.endTime };
  return {
    name: s.fullName,
    role: DB_ROLE_MAP[s.role] ?? "receptionist",
    jobTitle: s.jobTitle ?? "",
    specialty: s.specialtyCode ?? "",
    phone: s.phone ?? "",
    email: s.email,
    days: [...new Set(s.availability.map((a) => a.dayOfWeek))].sort(),
    hours,
  };
}

export function StaffForm({ initialValues, onSave, onCancel, submitLabel, saving, jobTitleOptions, specialtyOptions }: {
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
      role: DB_ROLE_MAP[entry.codigo ?? ""] ?? "receptionist",
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
