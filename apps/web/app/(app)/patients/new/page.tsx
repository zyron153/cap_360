"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { CreatePatientSchema, type CreatePatientDto } from "@cap/types";
import { useMessage } from "../../../../components/ui/message-handler";

async function createPatient(data: CreatePatientDto) {
  const res = await fetch("/api/patients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message ?? "Erro ao criar paciente");
  }
  return res.json();
}

function Field({ label, required, error, children }: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

export default function NewPatientPage() {
  const router = useRouter();
  const { addMessage } = useMessage();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreatePatientDto>({
    resolver: zodResolver(CreatePatientSchema),
    defaultValues: { consentGiven: false, gender: "other" },
  });

  const mutation = useMutation({
    mutationFn: createPatient,
    onSuccess: (data) => {
      addMessage("Success", "Paciente criado com sucesso!");
      router.push(`/patients/${data.id}`);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      {/* Back link */}
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Pacientes
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 bg-brand-100 rounded-[12px] flex items-center justify-center shrink-0">
          <UserPlus className="w-5 h-5 text-brand-700" />
        </div>
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Novo Paciente</h1>
          <p className="text-[13px] text-dim-500">Preencha os dados do paciente</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        className={CARD}
      >
        <div className="px-6 py-4 border-b border-dim-100">
          <h2 className="font-display text-[14px] font-semibold text-dim-900">Informação Pessoal</h2>
        </div>

        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Nome Completo" required error={errors.fullName?.message}>
              <input {...register("fullName")} placeholder="Ex: Maria da Silva" className={inputCls} />
            </Field>
          </div>

          <Field label="Data de Nascimento" required error={errors.dateOfBirth?.message}>
            <input type="date" {...register("dateOfBirth")} className={inputCls} />
          </Field>

          <Field label="Género" required>
            <select {...register("gender")} className={inputCls}>
              <option value="male">Masculino</option>
              <option value="female">Feminino</option>
              <option value="other">Outro</option>
            </select>
          </Field>

          <Field label="Telefone" required error={errors.phone?.message}>
            <input
              {...register("phone")}
              placeholder="+2389912345"
              className={inputCls}
            />
          </Field>

          <Field label="NIF">
            <input {...register("nif")} placeholder="123456789" className={inputCls} />
          </Field>

          <div className="col-span-2">
            <Field label="Email">
              <input type="email" {...register("email")} placeholder="paciente@email.com" className={inputCls} />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Morada">
              <textarea
                {...register("address")}
                rows={2}
                placeholder="Rua, Bairro, Cidade"
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/60 rounded-b-[16px] flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              id="consent"
              {...register("consentGiven")}
              className="mt-0.5 w-4 h-4 rounded border-dim-300 accent-brand-600 cursor-pointer"
            />
            <span className="text-[12px] text-dim-700 leading-relaxed">
              O paciente deu consentimento para recolha e tratamento de dados pessoais.{" "}
              <span className="text-red-500">*</span>
            </span>
          </label>
          {errors.consentGiven && (
            <p className="text-[11px] text-red-600">{errors.consentGiven.message}</p>
          )}

          {mutation.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-[10px]">
              <p className="text-[12px] text-red-700">{(mutation.error as Error).message}</p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isSubmitting || mutation.isPending}
              className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)] cursor-pointer"
            >
              {mutation.isPending ? "A guardar…" : "Guardar Paciente"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
