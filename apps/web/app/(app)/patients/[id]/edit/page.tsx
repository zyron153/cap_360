"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Patient } from "@cap/types";
import { useMessage } from "../../../../../components/ui/message-handler";

type FormState = {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  nif: string;
  email: string;
  address: string;
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)]";
const INPUT = "w-full text-[13px] border border-dim-200 rounded-[8px] px-3 py-2 bg-white text-dim-900 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 cursor-default">
      <span className="text-[11px] font-semibold text-dim-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

export default function PatientEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { addMessage } = useMessage();
  const [form, setForm] = useState<FormState>({
    fullName: "", dateOfBirth: "", gender: "female", phone: "", nif: "", email: "", address: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: patient, isLoading } = useQuery<Patient>({
    queryKey: ["patient", id],
    queryFn: () => fetch(`/api/patients/${id}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!patient) return;
    setForm({
      fullName: patient.fullName ?? "",
      dateOfBirth: patient.dateOfBirth ? String(patient.dateOfBirth).slice(0, 10) : "",
      gender: patient.gender ?? "female",
      phone: patient.phone ?? "",
      nif: (patient as Patient & { nif?: string }).nif ?? "",
      email: patient.email ?? "",
      address: (patient as Patient & { address?: string }).address ?? "",
    });
  }, [patient]);

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        fullName: form.fullName.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        phone: form.phone || undefined,
        nif: form.nif.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
      };
      const res = await fetch(`/api/patients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Erro ao guardar");
      }
      addMessage("Success", "Dados guardados com sucesso!");
      router.push(`/patients/${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setError(msg);
      addMessage("Error", msg);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 animate-pulse">
        <div className="w-24 h-3 bg-dim-100 rounded" />
        <div className="bg-dim-100 rounded-[16px] h-72 max-w-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Paciente
      </Link>

      <div className={`${CARD} p-6 max-w-xl`}>
        <h2 className="font-display font-bold text-dim-900 text-[16px] mb-5">Editar Paciente</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Nome completo">
            <input value={form.fullName} onChange={set("fullName")} required className={INPUT} />
          </Field>

          <Field label="Data de nascimento">
            <input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} className={INPUT} />
          </Field>

          <Field label="Género">
            <select value={form.gender} onChange={set("gender")} className={INPUT}>
              <option value="female">Feminino</option>
              <option value="male">Masculino</option>
              <option value="other">Outro</option>
            </select>
          </Field>

          <Field label="Telefone">
            <input value={form.phone} onChange={set("phone")} placeholder="+238..." className={INPUT} />
          </Field>

          <Field label="NIF">
            <input value={form.nif} onChange={set("nif")} className={INPUT} />
          </Field>

          <Field label="Email">
            <input type="email" value={form.email} onChange={set("email")} className={INPUT} />
          </Field>

          <Field label="Morada">
            <textarea value={form.address} onChange={set("address")} rows={2} className={`${INPUT} resize-none`} />
          </Field>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !form.fullName.trim()}
              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-semibold px-5 py-2.5 rounded-[10px] transition-colors"
            >
              {saving ? "A guardar…" : "Guardar alterações"}
            </button>
            <Link
              href={`/patients/${id}`}
              className="text-[13px] text-dim-500 hover:text-dim-800 px-3 py-2.5 transition-colors"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
