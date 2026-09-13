"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertCircle, Building2, RefreshCw, User } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";
import { PLAN_STATUS_META, planStatus } from "./status";

type PlanDetail = {
  id: string;
  planNumber: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  usageCount: number;
  createdAt: string;
  holderPatientId: string | null;
  holderPatientName?: string | null;
  companyId: string | null;
  product: { id: string; name: string; code: string; monthlyFee: number; active: boolean };
  company: { id: string; name: string } | null;
};

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

export function HealthPlanDetailBody({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [renewConfirm, setRenewConfirm] = useState(false);

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ["health-plan", id],
    queryFn: () => fetchPlan(id),
  });

  const renewMutation = useMutation({
    mutationFn: () => renewPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-plan", id] });
      queryClient.invalidateQueries({ queryKey: ["health-plans"] });
      addMessage("Success", "Plano renovado com sucesso!");
      setRenewConfirm(false);
    },
    onError: (e: Error) => { addMessage("Error", e.message); setRenewConfirm(false); },
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
  const canRenew = status !== "active";

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

          {canRenew && !renewConfirm && (
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
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Titular</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5 flex items-center gap-1.5">
              {plan.holderPatientId ? (
                <>
                  <User className="w-3.5 h-3.5 text-dim-400" />
                  <Link href={`/patients/${plan.holderPatientId}`} className="hover:text-brand-700 transition-colors">
                    {plan.holderPatientName ?? "Ver paciente"}
                  </Link>
                </>
              ) : plan.company ? (
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
            <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">Estado do Produto</dt>
            <dd className="text-[13px] text-dim-900 font-medium mt-0.5">
              {plan.product.active ? "Ativo" : "Desativado — não é possível renovar"}
            </dd>
          </div>
        </div>
      </div>
    </div>
  );
}
