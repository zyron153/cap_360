"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, TrendingUp, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import type { IncomeEntry, PaginatedResponse } from "@cap/types";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { usePermissions } from "../hooks/use-permissions";

async function fetchIncome(page: number) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  const res = await fetch(`/api/financeiro/entradas?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar entradas");
  return res.json() as Promise<PaginatedResponse<IncomeEntry>>;
}

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

const BLANK_FORM = { description: "", category: "", amount: "", date: format(new Date(), "yyyy-MM-dd"), notes: "" };

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[160, 100, 80, 70, 40].map((w, i) => (
        <td key={i} className="px-5 py-3.5 border-b border-dim-100">
          <div className="h-3 bg-dim-100 rounded inline-block" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export function EntradasTab() {
  const { canDo, isAdmin } = usePermissions();
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  function set(k: keyof typeof BLANK_FORM, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const { data, isLoading, error } = useQuery({
    queryKey: ["income", page],
    queryFn: () => fetchIncome(page),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/financeiro/entradas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description,
          category: form.category,
          amount: Number(form.amount),
          date: form.date,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao criar entrada"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["income"] });
      queryClient.invalidateQueries({ queryKey: ["financeiro-summary"] });
      setForm(BLANK_FORM);
      setNewOpen(false);
      addMessage("Success", "Entrada registada!");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/financeiro/entradas/${id}`, { method: "DELETE" })
      .then(async r => { if (!r.ok) throw new Error("Erro ao eliminar entrada"); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["income"] });
      queryClient.invalidateQueries({ queryKey: ["financeiro-summary"] });
      addMessage("Success", "Entrada eliminada.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-dim-500">
          {isLoading ? "A carregar…" : error ? "Erro ao carregar entradas" : `${data?.total ?? 0} entradas manuais`}
        </p>
        {canDo("billing", "create") && (
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Entrada
          </button>
        )}
      </div>

      <p className="text-[11px] text-dim-400 -mt-3">
        Receitas de faturas pagas aparecem automaticamente no Resumo — use isto apenas para entradas manuais (ex: subsídios, outras receitas).
      </p>

      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Descrição", "Categoria", "Valor", "Data", ""].map((h) => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-5 py-2.5 border-b border-dim-100 bg-dim-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : error
                ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-700">Erro ao carregar entradas</p>
                    </td>
                  </tr>
                )
                : data?.data.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <TrendingUp className="w-6 h-6 text-dim-400" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-600">Nenhuma entrada manual registada</p>
                    </td>
                  </tr>
                )
                : data?.data.map((inc) => (
                    <tr key={inc.id} className="hover:bg-dim-50 transition-colors group">
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[13px] font-medium text-dim-900">{inc.description}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-600">{inc.category}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[13px] font-semibold text-emerald-700 tabular-nums">
                        +{Number(inc.amount).toLocaleString("pt-CV")}<span className="text-[10px] font-normal text-dim-400 ml-1">CVE</span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">
                        {format(new Date(inc.date), "d MMM yyyy", { locale: pt })}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        {isAdmin && (
                          <button onClick={() => deleteMut.mutate(inc.id)}
                            className="opacity-0 group-hover:opacity-100 text-[11px] font-semibold text-dim-400 hover:text-red-600 transition-all">
                            Eliminar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3.5 border-t border-dim-100 flex items-center justify-between">
            <span className="text-[12px] text-dim-500">
              {data.total} entradas · Página <span className="font-semibold text-dim-700">{page}</span> de {data.totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={page === data.totalPages} onClick={() => setPage((p) => p + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-dim-200 text-dim-600 hover:bg-dim-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova Entrada" description="Regista uma receita manual (ex: subsídios, outras receitas)" size="md">
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Descrição *</label>
            <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Ex: Subsídio câmara municipal" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Categoria *</label>
            <input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Ex: Subsídios" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Valor (CVE) *</label>
            <input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Data *</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Notas</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Observações opcionais…" className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !form.description || !form.category || !(Number(form.amount) > 0) || !form.date}
            className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors disabled:opacity-50"
          >
            {createMut.isPending ? "A criar…" : "Registar Entrada"}
          </button>
          <button onClick={() => setNewOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Cancelar
          </button>
        </div>
      </Modal>
    </div>
  );
}
