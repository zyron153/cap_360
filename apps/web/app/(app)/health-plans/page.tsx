"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Shield, Users, TrendingUp, AlertTriangle, Plus, ChevronRight } from "lucide-react";
import { usePermissions } from "../hooks/use-permissions";
import { Modal } from "@/components/ui/modal";
import { useMessage } from "@/components/ui/message-handler";

/* ─── Types ──────────────────────────────────────────────────── */

type PlanProduct = {
  id: string;
  name: string;
  code: string;
  monthlyFee: number;
  active: boolean;
  company: { id: string; name: string } | null;
  coverageRules: { type?: string; coverage?: number } | null;
};

type PlanInstance = {
  id: string;
  planNumber: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  usageCount: number;
  holderPatientId: string | null;
  companyId: string | null;
  product: { id: string; name: string; code: string; monthlyFee: number; active: boolean };
  company: { id: string; name: string } | null;
};

/* ─── Constants ──────────────────────────────────────────────── */

const TYPE_STYLE: Record<string, string> = {
  familiar:   "bg-brand-50 text-brand-700",
  corp:       "bg-violet-50 text-violet-700",
  particular: "bg-dim-100 text-dim-600",
};
const TYPE_LABEL: Record<string, string> = {
  familiar:   "Familiar",
  corp:       "Corporativo",
  particular: "Particular",
};
const TYPE_ICON: Record<string, string> = {
  familiar: "👨‍👩‍👧",
  corp:     "🏢",
  particular: "👤",
};

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";
const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-semibold text-dim-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[10px] text-dim-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

const FALLBACK_PLAN_TYPES = [
  { value: "familiar",   label: "Familiar"      },
  { value: "corp",       label: "Corporativo"   },
  { value: "particular", label: "Particular"    },
];

export default function HealthPlansPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permLoading && !can("health_plans")) router.replace("/dashboard");
  }, [permLoading, can, router]);
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [newOpen, setNewOpen]             = useState(false);
  const [managingProduct, setManagingProduct] = useState<PlanProduct | null>(null);
  const [deactivateConfirm, setDeactivateConfirm] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", type: "familiar", coverage: "80", monthlyFee: "" });

  const { data: planTypeParams = [] } = useQuery<{ id: number; valor: string; codigo: string | null }[]>({
    queryKey: ["parametrizacao", "TIPO_PLANO_SAUDE"],
    queryFn: () => fetch("/api/parametrizacao/TIPO_PLANO_SAUDE").then(r => r.json()),
    staleTime: 120_000,
  });
  const planTypeOptions = planTypeParams.length > 0
    ? planTypeParams.map(p => ({ value: p.codigo ?? p.valor, label: p.valor }))
    : FALLBACK_PLAN_TYPES;
  const [formErr, setFormErr] = useState("");

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  // Auto-generate code from name
  useEffect(() => {
    if (!form.name.trim()) return;
    const auto = form.name.trim().split(/\s+/).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 8);
    setForm(f => ({ ...f, code: auto }));
  }, [form.name]); // eslint-disable-line

  /* ── Queries ── */

  const { data: products = [], isLoading: productsLoading } = useQuery<PlanProduct[]>({
    queryKey: ["health-plan-products"],
    queryFn:  () => fetch("/api/health-plans/products?activeOnly=false").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: instances = [] } = useQuery<PlanInstance[]>({
    queryKey: ["health-plans", "all"],
    queryFn:  () => fetch("/api/health-plans").then(r => r.json()),
    staleTime: 30_000,
  });

  /* ── Mutations ── */

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.code.trim() || !form.monthlyFee) throw new Error("Preencha todos os campos obrigatórios");
      const codeClean = form.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (!codeClean) throw new Error("Código inválido — use apenas letras, números e hífens");
      const res = await fetch("/api/health-plans/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: codeClean,
          monthlyFee: Number(form.monthlyFee),
          coverageRules: { type: form.type, coverage: Number(form.coverage) || 0 },
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao criar plano"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-plan-products"] });
      queryClient.invalidateQueries({ queryKey: ["health-plans"] });
      setForm({ name: "", code: "", type: "familiar", coverage: "80", monthlyFee: "" });
      setFormErr("");
      setNewOpen(false);
      addMessage("Success", "Produto de plano criado com sucesso!");
    },
    onError: (e: Error) => { setFormErr(e.message); addMessage("Error", e.message); },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/health-plans/products/${id}`, { method: "DELETE" })
      .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro"); } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-plan-products"] });
      setManagingProduct(null);
      setDeactivateConfirm(false);
      addMessage("Success", "Produto desativado com sucesso.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  /* ── Derived ── */

  const activeInstances = instances.filter(p => p.active);
  const today           = new Date();

  const totalSubscribers = activeInstances.filter(p => !!p.holderPatientId).length;
  const totalRevenue     = activeInstances.reduce((s, i) => s + Number(i.product.monthlyFee), 0);
  const expiringCount    = activeInstances.filter(p => {
    if (!p.endDate) return false;
    const days = (new Date(p.endDate).getTime() - today.getTime()) / 86_400_000;
    return days >= 0 && days <= 60;
  }).length;
  const activeProductCount = products.filter(p => p.active).length;

  // Instances per product (for table subscriber count)
  const instancesPerProduct: Record<string, number> = {};
  activeInstances.forEach(i => {
    instancesPerProduct[i.product.id] = (instancesPerProduct[i.product.id] ?? 0) + 1;
  });

  // Type distribution (from active instances × product coverageRules)
  const typeCount: Record<string, number> = { familiar: 0, corp: 0, particular: 0 };
  activeInstances.forEach(inst => {
    const prod  = products.find(p => p.id === inst.product.id);
    const type  = prod?.coverageRules?.type ?? "particular";
    const key   = type in typeCount ? type : "particular";
    typeCount[key as keyof typeof typeCount]++;
  });
  const totalTyped = activeInstances.length;

  return (
    <>
      <div className="flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold text-dim-900">Planos de Saúde</h1>
            <p className="text-[13px] text-dim-500 mt-0.5">Gestão de produtos e subscritores</p>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Produto
          </button>
        </div>

        {/* KPI cards — all live */}
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              icon: Shield, label: "Produtos Ativos",
              value: productsLoading ? "…" : String(activeProductCount),
              sub: `de ${products.length} total`,
              cls: "text-brand-600", bg: "bg-brand-50",
            },
            {
              icon: Users, label: "Subscritores",
              value: String(totalSubscribers),
              sub: "pacientes cobertos",
              cls: "text-violet-600", bg: "bg-violet-50",
            },
            {
              icon: TrendingUp, label: "Receita Mensal",
              value: totalRevenue > 0 ? `${totalRevenue.toLocaleString("pt-CV")} CVE` : "0 CVE",
              sub: "planos ativos",
              cls: "text-emerald-600", bg: "bg-emerald-50",
            },
            {
              icon: AlertTriangle, label: "A Expirar",
              value: String(expiringCount),
              sub: "nos próximos 60 dias",
              cls: "text-amber-600", bg: "bg-amber-50",
            },
          ].map(s => (
            <div key={s.label} className={CARD}>
              <div className="px-5 py-5">
                <div className={`w-9 h-9 ${s.bg} rounded-[10px] flex items-center justify-center mb-3`}>
                  <s.icon className={s.cls} style={{ width: 18, height: 18 }} />
                </div>
                <p className="font-display font-bold text-[22px] text-dim-900 leading-none">{s.value}</p>
                <p className="text-[12px] font-semibold text-dim-700 mt-1">{s.label}</p>
                <p className="text-[11px] text-dim-400 mt-0.5">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Type distribution — live */}
        <div className="grid grid-cols-3 gap-4">
          {(["familiar", "corp", "particular"] as const).map(type => {
            const count = typeCount[type];
            const pct   = totalTyped > 0 ? Math.round((count / totalTyped) * 100) : 0;
            return (
              <div key={type} className={CARD}>
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${TYPE_STYLE[type]}`}>
                      {TYPE_LABEL[type]}
                    </span>
                    <span className="text-base">{TYPE_ICON[type]}</span>
                  </div>
                  <p className="font-display font-bold text-[28px] text-dim-900 leading-none">{count}</p>
                  <p className="text-[12px] text-dim-500 mt-0.5">planos ativos</p>
                  <div className="mt-3 h-1.5 bg-dim-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-dim-400 mt-1 font-mono">{pct}% do total</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Products table — live */}
        <div className={CARD}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-dim-100">
            <h2 className="font-display text-[14px] font-semibold text-dim-900">Produtos de Plano</h2>
            <span className="font-mono text-[11px] text-dim-400">{products.length} produto{products.length !== 1 ? "s" : ""}</span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Produto", "Código", "Tipo", "Planos Ativos", "Cobertura", "Mensalidade", "Estado", ""].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productsLoading ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar produtos…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-[13px] text-dim-500">Nenhum produto registado.</td></tr>
              ) : products.map(product => {
                const type       = product.coverageRules?.type ?? "particular";
                const coverage   = product.coverageRules?.coverage ?? 0;
                const activeSubs = instancesPerProduct[product.id] ?? 0;
                return (
                  <tr key={product.id} className="hover:bg-dim-50 transition-colors group">
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <span className="text-[13px] font-semibold text-dim-900">{product.name}</span>
                      {product.company && (
                        <span className="block text-[11px] text-dim-400 mt-0.5">{product.company.name}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">{product.code}</td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_STYLE[type in TYPE_STYLE ? type : "particular"]}`}>
                        {TYPE_LABEL[type in TYPE_LABEL ? type : "particular"]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-dim-900">{activeSubs}</span>
                        <div className="w-14 h-1 bg-dim-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-400 rounded-full" style={{ width: `${Math.min((activeSubs / Math.max(...Object.values(instancesPerProduct), 1)) * 100, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1 bg-dim-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${coverage >= 85 ? "bg-emerald-400" : coverage >= 70 ? "bg-brand-400" : "bg-amber-400"}`}
                            style={{ width: `${coverage}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-dim-600">{coverage}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] font-semibold text-dim-900">
                      {Number(product.monthlyFee).toLocaleString("pt-CV")} <span className="text-[10px] font-normal text-dim-400">CVE</span>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${product.active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" : "bg-dim-100 text-dim-500"}`}>
                        {product.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 border-b border-dim-100">
                      <button
                        onClick={() => { setManagingProduct(product); setDeactivateConfirm(false); }}
                        className="flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Gerir <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>

      {/* ── New Product Modal ── */}
      <Modal open={newOpen} onClose={() => { setNewOpen(false); setFormErr(""); }} title="Novo Produto de Plano" size="md">
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Nome do Produto" required>
              <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Ex: Plano Familiar Ouro" className={inputCls} />
            </Field>
          </div>
          <Field label="Código" required hint="Auto-gerado · editável">
            <input
              value={form.code}
              onChange={e => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              placeholder="PFO"
              className={inputCls}
            />
          </Field>
          <Field label="Tipo">
            <select value={form.type} onChange={e => set("type", e.target.value)} className={inputCls}>
              {planTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Cobertura (%)">
            <input type="number" value={form.coverage} onChange={e => set("coverage", e.target.value)} min="0" max="100" className={inputCls} />
          </Field>
          <Field label="Mensalidade (CVE)" required>
            <input type="number" value={form.monthlyFee} onChange={e => set("monthlyFee", e.target.value)} placeholder="0" min="0" className={inputCls} />
          </Field>
        </div>
        {formErr && (
          <div className="mx-6 mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-[8px]">
            <p className="text-[12px] text-red-700">{formErr}</p>
          </div>
        )}
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.name.trim() || !form.code.trim() || !form.monthlyFee}
            className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? "A guardar…" : "Guardar Produto"}
          </button>
          <button onClick={() => { setNewOpen(false); setFormErr(""); }} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Cancelar
          </button>
        </div>
      </Modal>

      {/* ── Manage Product Modal ── */}
      {managingProduct && (
        <Modal open onClose={() => { setManagingProduct(null); setDeactivateConfirm(false); }} title={managingProduct.name} description={managingProduct.code} size="md">
          <div className="px-6 py-5 flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              {([
                ["Estado",         managingProduct.active ? "Ativo" : "Inativo"],
                ["Tipo",           TYPE_LABEL[managingProduct.coverageRules?.type ?? "particular"] ?? "Particular"],
                ["Planos Ativos",  String(instancesPerProduct[managingProduct.id] ?? 0)],
                ["Cobertura",      `${managingProduct.coverageRules?.coverage ?? 0}%`],
                ["Mensalidade",    `${Number(managingProduct.monthlyFee).toLocaleString("pt-CV")} CVE`],
                ["Seguradora",     managingProduct.company?.name ?? "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-dim-400">{label}</dt>
                  <dd className="text-[13px] text-dim-900 font-medium mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>

            {managingProduct.active && (
              deactivateConfirm ? (
                <div className="bg-red-50 border border-red-200 rounded-[10px] p-3.5 flex flex-col gap-2.5">
                  <p className="text-[12px] text-red-700 font-medium">Desativar "{managingProduct.name}"? Os planos existentes não são afetados.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => deactivateMutation.mutate(managingProduct.id)}
                      disabled={deactivateMutation.isPending}
                      className="flex-1 text-[12px] font-semibold py-1.5 rounded-[8px] bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                    >
                      {deactivateMutation.isPending ? "A desativar…" : "Confirmar"}
                    </button>
                    <button onClick={() => setDeactivateConfirm(false)} className="flex-1 text-[12px] font-semibold py-1.5 rounded-[8px] border border-dim-200 text-dim-700 hover:bg-dim-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setDeactivateConfirm(true)}
                  className="self-start text-[12px] font-semibold px-4 py-2 rounded-[10px] border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  Desativar Produto
                </button>
              )
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
