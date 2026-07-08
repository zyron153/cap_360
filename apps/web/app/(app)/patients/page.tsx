"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, User, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { usePermissions } from "../hooks/use-permissions";
import { CreatePatientSchema, type CreatePatientDto } from "@cms/types";
import type { Patient, PaginatedResponse } from "@cms/types";

// ── API ────────────────────────────────────────────────────────

async function fetchPatients(q: string, planFilter: string, page: number) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (q) params.set("q", q);
  if (planFilter !== "all") params.set("planFilter", planFilter);
  const res = await fetch(`/api/patients?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar pacientes");
  return res.json() as Promise<PaginatedResponse<Patient>>;
}

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

// ── Shared form helpers ────────────────────────────────────────

const inputCls =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300";

function Field({ label, required, error, children }: {
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

// ── New Patient Modal ──────────────────────────────────────────

function NewPatientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreatePatientDto>({
    resolver: zodResolver(CreatePatientSchema),
    defaultValues: { consentGiven: false, gender: "other" },
  });

  const mutation = useMutation({
    mutationFn: createPatient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      addMessage("Success", "Paciente criado com sucesso!");
      reset();
      onClose();
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  // Reset form when modal closes
  useEffect(() => {
    if (!open) { reset(); mutation.reset(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title="Novo Paciente" description="Preencha os dados do novo paciente" size="lg">
      <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
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
            <input {...register("phone")} placeholder="+2389912345" className={inputCls} />
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
              <textarea {...register("address")} rows={2} placeholder="Rua, Bairro, Cidade" className={inputCls} />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/60 flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
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

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]"
            >
              {mutation.isPending ? "A guardar…" : "Guardar Paciente"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Plan Modal ─────────────────────────────────────────────────

type PlanProduct = { id: string; name: string; code: string; monthlyFee: number; company: { id: string; name: string } | null };
type HealthPlan  = { id: string; planNumber: string; startDate: string; endDate?: string | null; active: boolean; product: PlanProduct; company: { name: string } | null };

function PlanModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const hasplan = !!patient.healthPlanId;
  const [mode, setMode] = useState<"view" | "edit">(hasplan ? "view" : "edit");
  const TODAY = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ productId: "", planNumber: "", startDate: TODAY });
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [err, setErr] = useState("");
  const autoFillProductRef = useRef<string>("");

  const { data: products = [] } = useQuery<PlanProduct[]>({
    queryKey: ["health-plan-products"],
    queryFn:  () => fetch("/api/health-plans/products").then(r => r.json()),
    staleTime: 120_000,
  });

  const { data: allPlans = [], isSuccess: plansLoaded } = useQuery<HealthPlan[]>({
    queryKey: ["health-plans", "all"],
    queryFn:  () => fetch("/api/health-plans").then(r => r.json()),
    enabled:  mode === "edit",
    staleTime: 30_000,
  });

  const selectedProduct = products.find(p => p.id === form.productId);

  // Auto-fill plan number when product changes or plans finish loading
  useEffect(() => {
    if (!form.productId || !selectedProduct || !plansLoaded) return;
    if (form.productId === autoFillProductRef.current) return;
    autoFillProductRef.current = form.productId;
    const year = new Date().getFullYear();
    const count = allPlans.filter(
      p => p.product.id === form.productId &&
      new Date(p.startDate).getFullYear() === year
    ).length;
    setForm(f => ({ ...f, planNumber: `${selectedProduct.code}-${year}-${String(count + 1).padStart(3, "0")}` }));
  }, [form.productId, plansLoaded]); // eslint-disable-line

  const { data: currentPlan, isLoading: planLoading } = useQuery<HealthPlan>({
    queryKey: ["health-plan", patient.healthPlanId],
    queryFn:  () => fetch(`/api/health-plans/${patient.healthPlanId}`).then(r => r.json()),
    enabled:  hasplan,
    staleTime: 60_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["patients"] });
    queryClient.invalidateQueries({ queryKey: ["health-plan-products"] });
    queryClient.invalidateQueries({ queryKey: ["health-plans"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.productId || !form.planNumber || !form.startDate) throw new Error("Preencha todos os campos obrigatórios");
      const plan = await fetch("/api/health-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: form.productId, holderPatientId: patient.id, planNumber: form.planNumber, startDate: form.startDate }),
      }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro ao criar plano"); } return r.json(); });
      await fetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ healthPlanId: plan.id }),
      }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro ao associar plano"); } });
    },
    onSuccess: () => {
      invalidate();
      addMessage("Success", hasplan ? "Plano atualizado com sucesso!" : "Plano adicionado com sucesso!");
      onClose();
    },
    onError: (e: Error) => { setErr(e.message); addMessage("Error", e.message); },
  });

  const removeMutation = useMutation({
    mutationFn: () => fetch(`/api/patients/${patient.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ healthPlanId: null }),
    }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.message ?? "Erro ao remover plano"); } }),
    onSuccess: () => {
      invalidate();
      addMessage("Success", "Plano removido com sucesso.");
      onClose();
    },
    onError: (e: Error) => { setErr(e.message); addMessage("Error", e.message); },
  });

  const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

  return (
    <Modal open onClose={onClose} title="Plano de Saúde" description={patient.fullName}>
      <div className="px-6 py-5 flex flex-col gap-4">

        {/* Current plan view */}
        {mode === "view" && (
          planLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-dim-100 rounded w-3/4" />
              <div className="h-4 bg-dim-100 rounded w-1/2" />
            </div>
          ) : currentPlan ? (
            <>
              <div className="bg-brand-50 border border-brand-100 rounded-[12px] p-4 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-brand-600">Plano Ativo</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${currentPlan.active ? "bg-emerald-100 text-emerald-700" : "bg-dim-100 text-dim-500"}`}>
                    {currentPlan.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="text-[15px] font-bold text-dim-900">{currentPlan.product.name}</p>
                <div className="grid grid-cols-2 gap-1.5 text-[12px] text-dim-600">
                  <span>Nº do Plano</span>
                  <span className="font-mono font-semibold text-dim-800">{currentPlan.planNumber}</span>
                  <span>Início</span>
                  <span className="font-mono font-semibold text-dim-800">{new Date(currentPlan.startDate).toLocaleDateString("pt-CV")}</span>
                  {currentPlan.endDate && (
                    <>
                      <span>Validade</span>
                      <span className="font-mono font-semibold text-dim-800">{new Date(currentPlan.endDate).toLocaleDateString("pt-CV")}</span>
                    </>
                  )}
                  <span>Mensalidade</span>
                  <span className="font-mono font-semibold text-dim-800">{Number(currentPlan.product.monthlyFee).toLocaleString("pt-CV")} CVE/mês</span>
                  {currentPlan.company && (
                    <>
                      <span>Seguradora</span>
                      <span className="font-semibold text-dim-800">{currentPlan.company.name}</span>
                    </>
                  )}
                </div>
              </div>

              {removeConfirm ? (
                <div className="bg-red-50 border border-red-200 rounded-[10px] p-3.5 flex flex-col gap-2.5">
                  <p className="text-[12px] text-red-700 font-medium">Confirmar remoção do plano de {patient.fullName}?</p>
                  <div className="flex gap-2">
                    <button onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}
                      className="flex-1 text-[12px] font-semibold py-1.5 rounded-[8px] bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
                      {removeMutation.isPending ? "A remover…" : "Confirmar"}
                    </button>
                    <button onClick={() => setRemoveConfirm(false)}
                      className="flex-1 text-[12px] font-semibold py-1.5 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setMode("edit")}
                    className="flex-1 text-[12px] font-semibold py-2 rounded-[10px] bg-brand-700 hover:bg-brand-800 text-white transition-colors">
                    Alterar Plano
                  </button>
                  <button onClick={() => setRemoveConfirm(true)}
                    className="flex-1 text-[12px] font-semibold py-2 rounded-[10px] border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                    Remover Plano
                  </button>
                </div>
              )}
            </>
          ) : null
        )}

        {/* Create / change form */}
        {mode === "edit" && (
          <>
            {hasplan && (
              <div className="flex items-center gap-2 text-[12px] text-dim-500">
                <button onClick={() => setMode("view")} className="text-brand-600 hover:text-brand-700 font-semibold text-[11px]">← Voltar</button>
                <span>·</span>
                <span>A substituir o plano atual</span>
              </div>
            )}
            <div>
              <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Tipo de Plano <span className="text-red-500">*</span></label>
              <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} className={inputCls}>
                <option value="">Selecionar produto…</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — {Number(p.monthlyFee).toLocaleString("pt-CV")} CVE/mês</option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-dim-700">Número do Plano <span className="text-red-500">*</span></label>
                {form.planNumber && <span className="text-[10px] text-dim-400 font-medium">Gerado automaticamente · editável</span>}
              </div>
              <input
                value={form.planNumber}
                onChange={e => {
                  autoFillProductRef.current = form.productId; // lock: treat as manual
                  setForm(f => ({ ...f, planNumber: e.target.value }));
                }}
                placeholder={selectedProduct ? `${selectedProduct.code}-${new Date().getFullYear()}-001` : "Selecione um produto primeiro"}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Data de Início <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={form.startDate}
                max={TODAY}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className={`${inputCls}${form.startDate > TODAY ? " border-red-300 focus:border-red-400 focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]" : ""}`}
              />
              {form.startDate > TODAY && (
                <p className="text-[11px] text-red-600 mt-1.5">A data de início não pode ser uma data futura.</p>
              )}
            </div>

            {err && <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{err}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.productId || !form.planNumber || !form.startDate || form.startDate > TODAY}
                className="flex-1 text-[12px] font-semibold py-2 rounded-[10px] bg-brand-700 hover:bg-brand-800 text-white transition-colors disabled:opacity-50">
                {saveMutation.isPending ? "A guardar…" : hasplan ? "Substituir Plano" : "Adicionar Plano"}
              </button>
              <button onClick={onClose} className="flex-1 text-[12px] font-semibold py-2 rounded-[10px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors">
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Skeleton row ───────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-dim-100 rounded-full shrink-0" />
          <div className="w-36 h-3 bg-dim-100 rounded" />
        </div>
      </td>
      <td className="px-5 py-3.5"><div className="w-28 h-3 bg-dim-100 rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-40 h-3 bg-dim-100 rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-16 h-5 bg-dim-100 rounded-full" /></td>
      <td className="px-5 py-3.5"><div className="w-14 h-3 bg-dim-100 rounded ml-auto" /></td>
    </tr>
  );
}

// ── Constants ──────────────────────────────────────────────────

const PLAN_FILTERS = [
  { key: "all",  label: "Todos"      },
  { key: "plan", label: "Com Plano"  },
  { key: "none", label: "Particular" },
];

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

// ── Page ───────────────────────────────────────────────────────

export default function PatientsPage() {
  const { isLoading: permLoading, can, canDo } = usePermissions();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [planFilter, setPlanFilter] = useState("all");
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [planPatient, setPlanPatient] = useState<Patient | null>(null);

  useEffect(() => {
    if (!permLoading && !can("patients")) router.replace("/dashboard");
  }, [permLoading, can, router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["patients", search, planFilter, page],
    queryFn: () => fetchPatients(search, planFilter, page),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const patients = data?.data ?? [];

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold text-dim-900">Pacientes</h1>
            <p className="text-[13px] text-dim-500 mt-0.5">
              {isLoading ? "A carregar…" : error ? "Erro ao carregar pacientes" : `${data?.total ?? 0} pacientes registados`}
            </p>
          </div>
          {canDo("patients", "create") && (
            <button
              onClick={() => setNewPatientOpen(true)}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Paciente
            </button>
          )}
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dim-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Pesquisar por nome, telefone ou NIF…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white border border-dim-200 rounded-[10px] text-[13px] text-dim-900 placeholder:text-dim-400 focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-all"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {PLAN_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setPlanFilter(f.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-colors ${
                  planFilter === f.key
                    ? "bg-brand-700 text-white shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                    : "bg-white border border-dim-200 text-dim-600 hover:border-brand-400 hover:text-brand-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className={CARD}>
          {error ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-[13px] font-medium text-dim-700">Erro ao carregar pacientes</p>
              <p className="text-[12px] text-dim-400 mt-1">Verifique a ligação ao servidor</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["Nome", "Telefone", "Email", "Plano", ""].map((h) => (
                        <th
                          key={h}
                          className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading
                      ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                      : patients.length === 0
                      ? (
                        <tr>
                          <td colSpan={5} className="py-16 text-center">
                            <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                              <User className="w-6 h-6 text-dim-400" />
                            </div>
                            <p className="text-[13px] font-medium text-dim-600">Nenhum paciente encontrado</p>
                            {search && (
                              <p className="text-[12px] text-dim-400 mt-1">Tente pesquisar com outros termos</p>
                            )}
                          </td>
                        </tr>
                      )
                      : patients.map((patient) => (
                        <tr key={patient.id} className="hover:bg-dim-50 transition-colors group">
                          <td className="px-5 py-3.5 border-b border-dim-100">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-800 font-semibold text-[11px] flex items-center justify-center shrink-0">
                                {patient.fullName[0]?.toUpperCase()}
                              </div>
                              <span className="text-[13px] font-semibold text-dim-900">{patient.fullName}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] text-dim-600">{patient.phone}</td>
                          <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-500">{patient.email ?? "—"}</td>
                          <td className="px-5 py-3.5 border-b border-dim-100">
                            {patient.healthPlanId ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">
                                Plano Ativo
                              </span>
                            ) : (
                              <span className="text-[12px] text-dim-400">Particular</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 border-b border-dim-100 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setPlanPatient(patient)}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-[7px] border border-dim-200 text-dim-600 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                              >
                                {patient.healthPlanId ? "Gerir Plano" : "Adicionar Plano"}
                              </button>
                              <Link
                                href={`/patients/${patient.id}`}
                                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 transition-colors"
                              >
                                Ver perfil →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data && data.totalPages > 1 && (
                <div className="px-5 py-3.5 border-t border-dim-100 flex items-center justify-between">
                  <span className="text-[12px] text-dim-500">
                    {data.total} pacientes · Página <span className="font-semibold text-dim-700">{page}</span> de {data.totalPages}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      disabled={page === data.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <NewPatientModal open={newPatientOpen} onClose={() => setNewPatientOpen(false)} />
      {planPatient && <PlanModal patient={planPatient} onClose={() => setPlanPatient(null)} />}
    </>
  );
}
