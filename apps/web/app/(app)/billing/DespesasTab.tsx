"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, TrendingDown, ChevronLeft, ChevronRight, AlertCircle, Paperclip, Check, X } from "lucide-react";
import type { ExpenseEntry, PaginatedResponse } from "@cap/types";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { usePermissions } from "../hooks/use-permissions";

async function fetchExpenses(page: number, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status) params.set("status", status);
  const res = await fetch(`/api/financeiro/despesas?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar despesas");
  return res.json() as Promise<PaginatedResponse<ExpenseEntry>>;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:  { label: "Pendente",  cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"     },
  approved: { label: "Aprovada",  cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  rejected: { label: "Rejeitada", cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80"            },
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Numerário", bank_transfer: "Transferência", health_plan: "Plano de Saúde", vinti4: "Vinti4",
};

const FILTERS = [
  { key: "",          label: "Todas"     },
  { key: "pending",   label: "Pendentes" },
  { key: "approved",  label: "Aprovadas" },
  { key: "rejected",  label: "Rejeitadas" },
];

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

const BLANK_FORM = { description: "", category: "", amount: "", date: format(new Date(), "yyyy-MM-dd"), supplier: "", method: "cash", reference: "", notes: "" };

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[140, 90, 100, 70, 70, 80, 70, 40].map((w, i) => (
        <td key={i} className="px-5 py-3.5 border-b border-dim-100">
          <div className="h-3 bg-dim-100 rounded inline-block" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

function ReceiptCell({ expense }: { expense: ExpenseEntry }) {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/financeiro/despesas/${expense.id}/receipt`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Erro ao anexar recibo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      addMessage("Success", "Recibo anexado.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  async function viewReceipt() {
    const res = await fetch(`/api/financeiro/despesas/${expense.id}/receipt-url`);
    if (!res.ok) { addMessage("Error", "Erro ao obter recibo"); return; }
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (expense.receiptR2Key) {
    return (
      <button onClick={viewReceipt} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700">
        <Paperclip className="w-3 h-3" /> Ver
      </button>
    );
  }
  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); }} />
      <button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-dim-400 hover:text-brand-700 transition-colors">
        <Paperclip className="w-3 h-3" /> {uploadMut.isPending ? "A anexar…" : "Anexar"}
      </button>
    </>
  );
}

export function DespesasTab() {
  const { canDo, isAdmin } = usePermissions();
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  function set(k: keyof typeof BLANK_FORM, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const { data, isLoading, error } = useQuery({
    queryKey: ["expenses", page, statusFilter],
    queryFn: () => fetchExpenses(page, statusFilter || undefined),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/financeiro/despesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description,
          category: form.category,
          amount: Number(form.amount),
          date: form.date,
          supplier: form.supplier || undefined,
          method: form.method,
          reference: form.reference || undefined,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao criar despesa"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setForm(BLANK_FORM);
      setNewOpen(false);
      addMessage("Success", "Despesa registada!");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const decideMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) =>
      fetch(`/api/financeiro/despesas/${id}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(async r => { if (!r.ok) throw new Error("Erro ao decidir despesa"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      addMessage("Success", "Decisão registada.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/financeiro/despesas/${id}`, { method: "DELETE" })
      .then(async r => { if (!r.ok) throw new Error("Erro ao eliminar despesa"); }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["expenses"] }); addMessage("Success", "Despesa eliminada."); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-dim-500">
          {isLoading ? "A carregar…" : error ? "Erro ao carregar despesas" : `${data?.total ?? 0} despesas`}
        </p>
        {canDo("billing", "create") && (
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Despesa
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setStatusFilter(f.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === f.key
                ? "bg-brand-700 text-white shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                : "border border-dim-200 bg-white text-dim-600 hover:border-brand-400 hover:text-brand-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Descrição", "Categoria", "Fornecedor", "Valor", "Data", "Método", "Estado", "Recibo", ""].map((h) => (
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
                    <td colSpan={9} className="py-16 text-center">
                      <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-700">Erro ao carregar despesas</p>
                    </td>
                  </tr>
                )
                : data?.data.length === 0
                ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <TrendingDown className="w-6 h-6 text-dim-400" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-600">Nenhuma despesa encontrada</p>
                    </td>
                  </tr>
                )
                : data?.data.map((exp) => (
                    <tr key={exp.id} className="hover:bg-dim-50 transition-colors group">
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[13px] font-medium text-dim-900">{exp.description}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-600">{exp.category}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-600">{exp.supplier ?? "—"}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[13px] font-semibold text-dim-900 tabular-nums">
                        {Number(exp.amount).toLocaleString("pt-CV")}<span className="text-[10px] font-normal text-dim-400 ml-1">CVE</span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">
                        {format(new Date(exp.date), "d MMM yyyy", { locale: pt })}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 text-[12px] text-dim-600">{METHOD_LABEL[exp.method] ?? exp.method}</td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_META[exp.status]?.cls ?? "bg-dim-100 text-dim-600"}`}>
                          {STATUS_META[exp.status]?.label ?? exp.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <ReceiptCell expense={exp} />
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isAdmin && exp.status === "pending" && (
                            <>
                              <button onClick={() => decideMut.mutate({ id: exp.id, status: "approved" })} title="Aprovar"
                                className="w-6 h-6 flex items-center justify-center rounded-md border border-dim-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300 transition-colors">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => decideMut.mutate({ id: exp.id, status: "rejected" })} title="Rejeitar"
                                className="w-6 h-6 flex items-center justify-center rounded-md border border-dim-200 text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button onClick={() => deleteMut.mutate(exp.id)} title="Eliminar"
                              className="text-[11px] font-semibold text-dim-400 hover:text-red-600 transition-colors">
                              Eliminar
                            </button>
                          )}
                        </div>
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
              {data.total} despesas · Página <span className="font-semibold text-dim-700">{page}</span> de {data.totalPages}
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

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova Despesa" description="Regista uma nova despesa para aprovação" size="md">
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Descrição *</label>
            <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Ex: Material de escritório" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Categoria *</label>
            <input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Ex: Fornecimentos" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Valor (CVE) *</label>
            <input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Data *</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Método de Pagamento *</label>
            <select value={form.method} onChange={(e) => set("method", e.target.value)} className={inputCls}>
              <option value="cash">Numerário</option>
              <option value="bank_transfer">Transferência</option>
              <option value="health_plan">Plano de Saúde</option>
              <option value="vinti4">Vinti4</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Fornecedor</label>
            <input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="Opcional" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Referência</label>
            <input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Nº fatura/recibo" className={inputCls} />
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
            {createMut.isPending ? "A criar…" : "Registar Despesa"}
          </button>
          <button onClick={() => setNewOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Cancelar
          </button>
        </div>
      </Modal>
    </div>
  );
}
