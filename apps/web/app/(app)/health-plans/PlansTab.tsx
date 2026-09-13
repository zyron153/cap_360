"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { AlertCircle, ChevronRight, RefreshCw, Search, Shield } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";
import { PLAN_STATUS_META, planStatus, type PlanStatusKey } from "./status";

type PlanInstance = {
  id: string;
  planNumber: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  usageCount: number;
  holderPatientId: string | null;
  holderPatientName?: string | null;
  companyId: string | null;
  product: { id: string; name: string; code: string; monthlyFee: number; active: boolean };
  company: { id: string; name: string } | null;
};

async function fetchPlans() {
  const res = await fetch("/api/health-plans");
  if (!res.ok) throw new Error("Erro ao carregar planos");
  return res.json() as Promise<PlanInstance[]>;
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
const STATUS_FILTERS: { key: "all" | PlanStatusKey; label: string }[] = [
  { key: "all",      label: "Todos" },
  { key: "active",   label: "Ativos" },
  { key: "expiring", label: "A Expirar" },
  { key: "expired",  label: "Expirados" },
  { key: "inactive", label: "Inativos" },
];

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[150, 130, 90, 90, 70, 40].map((w, i) => (
        <td key={i} className="px-5 py-3.5 border-b border-dim-100">
          <div className="h-3 bg-dim-100 rounded inline-block" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export function PlansTab() {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PlanStatusKey>("all");
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const { data: plans = [], isLoading, error } = useQuery({
    queryKey: ["health-plans", "all"],
    queryFn: fetchPlans,
    staleTime: 30_000,
  });

  const renewMutation = useMutation({
    mutationFn: renewPlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-plans"] });
      addMessage("Success", "Plano renovado com sucesso!");
      setRenewingId(null);
    },
    onError: (e: Error) => { addMessage("Error", e.message); setRenewingId(null); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter(p => {
      if (statusFilter !== "all" && planStatus(p) !== statusFilter) return false;
      if (!q) return true;
      return (
        p.planNumber.toLowerCase().includes(q) ||
        (p.holderPatientName?.toLowerCase().includes(q) ?? false) ||
        (p.company?.name.toLowerCase().includes(q) ?? false) ||
        p.product.name.toLowerCase().includes(q)
      );
    });
  }, [plans, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<PlanStatusKey, number> = { active: 0, expiring: 0, expired: 0, inactive: 0 };
    plans.forEach(p => { c[planStatus(p)]++; });
    return c;
  }, [plans]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] font-bold text-dim-900">Planos</h2>
          <p className="text-[13px] text-dim-500 mt-0.5">Todas as subscrições de planos de saúde</p>
        </div>
        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-dim-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Titular, empresa, produto, nº plano…"
            className="w-full border border-dim-200 rounded-[10px] pl-8 pr-3 py-2 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all"
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
              statusFilter === f.key ? "bg-brand-700 text-white" : "bg-dim-100 text-dim-600 hover:bg-dim-200"
            }`}
          >
            {f.label}{f.key !== "all" && ` (${counts[f.key]})`}
          </button>
        ))}
      </div>

      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Nº Plano", "Titular", "Produto", "Validade", "Estado", ""].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : error ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                      <AlertCircle className="w-6 h-6 text-red-500" />
                    </div>
                    <p className="text-[13px] font-medium text-dim-700">Erro ao carregar planos</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                      <Shield className="w-6 h-6 text-dim-400" />
                    </div>
                    <p className="text-[13px] font-medium text-dim-600">
                      {plans.length === 0 ? "Nenhum plano registado" : "Nenhum plano corresponde aos filtros"}
                    </p>
                  </td>
                </tr>
              ) : filtered.map(plan => {
                const status = planStatus(plan);
                const meta = PLAN_STATUS_META[status];
                const canRenew = status === "expiring" || status === "expired" || status === "inactive";
                return (
                  <tr key={plan.id} className="hover:bg-dim-50 transition-colors group">
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] text-dim-700">
                      {plan.planNumber}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      {plan.holderPatientId ? (
                        <Link href={`/patients/${plan.holderPatientId}`} className="text-[13px] font-medium text-dim-900 hover:text-brand-700 transition-colors">
                          {plan.holderPatientName ?? "Ver paciente"}
                        </Link>
                      ) : plan.company ? (
                        <span className="text-[13px] font-medium text-dim-900">{plan.company.name}</span>
                      ) : (
                        <span className="text-[12px] text-dim-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 text-[13px] text-dim-700">
                      {plan.product.name}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">
                      {plan.endDate ? format(new Date(plan.endDate), "d MMM yyyy", { locale: pt }) : "Sem validade"}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-3 justify-end">
                        {canRenew && (
                          <button
                            onClick={() => { setRenewingId(plan.id); renewMutation.mutate(plan.id); }}
                            disabled={renewMutation.isPending && renewingId === plan.id}
                            className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50 transition-colors"
                          >
                            <RefreshCw className={`w-3 h-3 ${renewMutation.isPending && renewingId === plan.id ? "animate-spin" : ""}`} />
                            Renovar
                          </button>
                        )}
                        <Link
                          href={`/health-plans/${plan.id}`}
                          className="flex items-center gap-0.5 text-[11px] font-semibold text-dim-500 hover:text-dim-800 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Ver <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
