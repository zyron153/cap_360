"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertCircle, Building2, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";
import { Modal } from "@/components/ui/modal";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { HealthPlanInstance } from "@cap/types";
import { PLAN_STATUS_META, planStatus } from "./status";

type PlanDetail = HealthPlanInstance;

type PatientSearchResult = { id: string; fullName: string; phone: string };

async function fetchPlan(id: string) {
  const res = await fetch(`/api/health-plans/${id}`);
  if (!res.ok) throw new Error("Plano não encontrado");
  return res.json() as Promise<PlanDetail>;
}

async function renewPlan(id: string) {
  const res = await fetch(`/api/health-plans/${id}/renew`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? "Erro ao renovar plano");
  }
  return res.json();
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 placeholder:text-dim-400";

function AddMemberModal({ planId, onClose, onAdded }: { planId: string; onClose: () => void; onAdded: () => void }) {
  const { addMessage } = useMessage();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: results = [], isFetching } = useQuery<PatientSearchResult[]>({
    queryKey: ["patient-search", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "10" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/patients?${params}`);
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: debouncedSearch.length >= 2,
  });

  const addMutation = useMutation({
    mutationFn: (patientId: string) => fetch(`/api/health-plans/${planId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId }),
    }).then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao adicionar membro"); } }),
    onSuccess: () => { addMessage("Success", "Membro adicionado com sucesso!"); onAdded(); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <Modal open onClose={onClose} title="Adicionar Membro" description="Pesquise um paciente para associar a este plano">
      <div className="p-5 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dim-400 pointer-events-none" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, telefone ou NIF…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          {debouncedSearch.length < 2 ? (
            <p className="text-[12px] text-dim-400 text-center py-6">Escreva pelo menos 2 caracteres para pesquisar.</p>
          ) : isFetching ? (
            <p className="text-[12px] text-dim-400 text-center py-6">A pesquisar…</p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-dim-400 text-center py-6">Nenhum paciente encontrado.</p>
          ) : (
            <div className="divide-y divide-dim-100">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addMutation.mutate(p.id)}
                  disabled={addMutation.isPending}
                  className="w-full flex items-center justify-between py-2.5 px-2 rounded-[8px] hover:bg-dim-50 transition-colors text-left disabled:opacity-50"
                >
                  <div>
                    <p className="text-[13px] font-medium text-dim-900">{p.fullName}</p>
                    <p className="text-[11px] text-dim-400 font-mono">{p.phone}</p>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-brand-600" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function HealthPlanDetailBody({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [renewConfirm, setRenewConfirm] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeConfirmPatientId, setRemoveConfirmPatientId] = useState<string | null>(null);

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ["health-plan", id],
    queryFn: () => fetchPlan(id),
  });

  function invalidatePlan() {
    queryClient.invalidateQueries({ queryKey: ["health-plan", id] });
    queryClient.invalidateQueries({ queryKey: ["health-plans"] });
  }

  const renewMutation = useMutation({
    mutationFn: () => renewPlan(id),
    onSuccess: () => {
      invalidatePlan();
      addMessage("Success", "Plano renovado com sucesso!");
      setRenewConfirm(false);
    },
    onError: (e: Error) => { addMessage("Error", e.message); setRenewConfirm(false); },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (patientId: string) => fetch(`/api/health-plans/${id}/members/${patientId}`, { method: "DELETE" })
      .then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao remover membro"); } }),
    onSuccess: () => {
      invalidatePlan();
      addMessage("Success", "Membro removido com sucesso.");
      setRemoveConfirmPatientId(null);
    },
    onError: (e: Error) => { addMessage("Error", e.message); setRemoveConfirmPatientId(null); },
  });

  if (isLoading) {
    return (
      <div className={CARD}>
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-5 bg-dim-100 rounded w-1/2" />
          <div className="h-4 bg-dim-100 rounded w-1/3" />
          <div className="h-4 bg-dim-100 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className={CARD}>
        <div className="p-10 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-[13px] font-medium text-dim-700">Plano não encontrado</p>
        </div>
      </div>
    );
  }

  const status = planStatus(plan);
  const meta = PLAN_STATUS_META[status];
  // Renewal is a manual, staff-triggered action — always offered, not gated on the computed
  // status. A plan with no endDate (never "expiring") or one renewed well ahead of its expiry
  // must still be renewable on demand; the backend itself has no such restriction either.

  return (
    <div className="flex flex-col gap-5">
      <div className={CARD}>
        <div className="px-6 py-5 border-b border-dim-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-[18px] font-bold text-dim-900">{plan.product.name}</h1>
              <span data-testid="plan-status" className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="font-mono text-[12px] text-dim-500 mt-0.5">{plan.planNumber}</p>
          </div>

          {!renewConfirm && (
            <button
              onClick={() => setRenewConfirm(true)}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Renovar Plano
            </button>
          )}
        </div>

        {renewConfirm && (
          <div className="mx-6 mt-5 bg-brand-50 border border-brand-100 rounded-[12px] p-4 flex flex-col gap-3">
            <p className="text-[12px] text-brand-800 font-medium">
              Renovar este plano por mais um ciclo de {plan.product.name}?
              {plan.endDate && ` A validade atual é ${format(new Date(plan.endDate), "d MMM yyyy", { locale: pt })}.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => renewMutation.mutate()}
                disabled={renewMutation.isPending}
                className="flex-1 text-[12px] font-semibold py-2 rounded-[8px] bg-brand-700 hover:bg-brand-800 text-white transition-colors disabled:opacity-50"
              >
                {renewMutation.isPending ? "A renovar…" : "Confirmar Renovação"}
              </button>
              <button
                onClick={() => setRenewConfirm(false)}
                className="flex-1 text-[12px] font-semibold py-2 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Empresa</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 flex items-center gap-1.5">
              {plan.company ? (
                <>
                  <Building2 className="w-3.5 h-3.5 text-dim-400" />
                  {plan.company.name}
                </>
              ) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Mensalidade</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5">
              {Number(plan.product.monthlyFee).toLocaleString("pt-CV")} CVE/mês
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Início</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 font-mono">
              {format(new Date(plan.startDate), "d MMM yyyy", { locale: pt })}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Validade</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 font-mono">
              {plan.endDate ? format(new Date(plan.endDate), "d MMM yyyy", { locale: pt }) : "Sem validade definida"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Utilizações</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 font-mono">{plan.usageCount}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Sessões</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 font-mono">
              {plan.product.sessionsPerCycle == null ? "Ilimitado" : `${plan.sessionsRemaining ?? 0}/${plan.product.sessionsPerCycle}`}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Estado do Produto</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5">
              {plan.product.active ? "Ativo" : "Desativado — não é possível renovar"}
            </dd>
          </div>
        </div>
      </div>

      <div className={CARD}>
        <div className="px-6 py-4 border-b border-dim-100 flex items-center justify-between">
          <div>
            <h3 className="font-display text-[14px] font-semibold text-dim-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-dim-400" /> Membros
            </h3>
            <p className="text-[11px] text-dim-400 mt-0.5">
              {plan.members.length}{plan.product.maxMembers != null ? ` de ${plan.product.maxMembers}` : ""} pacientes cobertos por este plano
            </p>
          </div>
          <button
            onClick={() => setAddMemberOpen(true)}
            disabled={plan.product.maxMembers != null && plan.members.length >= plan.product.maxMembers}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar Membro
          </button>
        </div>

        {plan.members.length === 0 ? (
          <div className="px-6 py-8 text-center text-[13px] text-dim-400">Nenhum membro associado a este plano.</div>
        ) : (
          <div className="divide-y divide-dim-100">
            {plan.members.map((m) => (
              <div key={m.patientId} className="px-6 py-3.5 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-800 font-semibold text-[11px] flex items-center justify-center shrink-0">
                    {m.patientName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <Link href={`/patients/${m.patientId}`} className="text-[13px] font-semibold text-dim-900 hover:text-brand-700 transition-colors">
                      {m.patientName ?? "Paciente removido"}
                    </Link>
                    <p className="text-[11px] text-dim-400 mt-0.5">Desde {format(new Date(m.addedAt), "d MMM yyyy", { locale: pt })}</p>
                  </div>
                </div>

                {removeConfirmPatientId === m.patientId ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => removeMemberMutation.mutate(m.patientId)}
                      disabled={removeMemberMutation.isPending}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-[8px] bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                    >
                      {removeMemberMutation.isPending ? "A remover…" : "Confirmar"}
                    </button>
                    <button
                      onClick={() => setRemoveConfirmPatientId(null)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemoveConfirmPatientId(m.patientId)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-[8px] border border-dim-200 text-dim-500 hover:border-red-300 hover:text-red-600 transition-colors"
                  >
                    <X className="w-3 h-3" /> Remover
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {addMemberOpen && (
        <AddMemberModal
          planId={id}
          onClose={() => setAddMemberOpen(false)}
          onAdded={() => { setAddMemberOpen(false); invalidatePlan(); }}
        />
      )}
    </div>
  );
}
