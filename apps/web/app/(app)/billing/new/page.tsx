"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, Trash2, ArrowLeft } from "lucide-react";

// price arrives as a string — it's a Prisma Decimal, serialized to JSON as text to avoid float rounding.
type ServiceOption = { id: string; name: string; price: string };
type LineItem = { serviceId: string; description: string; quantity: number; unitPrice: number };

const inputCls =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

const cellInput =
  "w-full border border-dim-200 rounded-[8px] px-2.5 py-1.5 text-[12px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 transition-all";

function blank(): LineItem {
  return { serviceId: "", description: "", quantity: 1, unitPrice: 0 };
}

export default function BillingNewPage() {
  const router = useRouter();
  const [patientId, setPatientId] = useState("");
  const [items, setItems] = useState<LineItem[]>([blank()]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: patients } = useQuery<{ data: { id: string; fullName: string }[] }>({
    queryKey: ["patients-list"],
    queryFn: () => fetch("/api/patients?limit=100").then((r) => r.json()),
    staleTime: 60_000,
  });
  const { data: services } = useQuery<ServiceOption[]>({
    queryKey: ["services-list"],
    queryFn: () => fetch("/api/services").then((r) => r.json()),
    staleTime: 60_000,
  });

  function setItem(i: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function pickService(i: number, serviceId: string) {
    const svc = services?.find((s) => s.id === serviceId);
    setItem(i, { serviceId, description: svc?.name ?? "", unitPrice: svc ? Number(svc.price) : 0 });
  }

  const total = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  const canSubmit =
    !!patientId &&
    items.length > 0 &&
    items.every((it) => it.serviceId && it.quantity > 0 && it.unitPrice > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, items, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Erro ao criar fatura");
      }
      const inv = await res.json();
      router.push(`/billing/${inv.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/billing"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-dim-200 hover:bg-dim-50 transition-colors text-dim-500"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Nova Fatura</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">Crie uma fatura para um paciente</p>
        </div>
      </div>

      {/* Form card */}
      <div className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Patient */}
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
              Paciente <span className="text-red-500">*</span>
            </label>
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className={inputCls}>
              <option value="">Selecionar paciente…</option>
              {patients?.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName}</option>
              ))}
            </select>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-dim-700">
                Serviços <span className="text-red-500">*</span>
              </span>
              <button
                onClick={() => setItems((prev) => [...prev, blank()])}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Adicionar linha
              </button>
            </div>

            <div className="border border-dim-200 rounded-[10px] overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-dim-50 border-b border-dim-200">
                    <th className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-dim-400 px-3 py-2">Serviço</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-[0.06em] text-dim-400 px-3 py-2 w-16">Qtd</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-[0.06em] text-dim-400 px-3 py-2 w-28">Preço Unit.</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-[0.06em] text-dim-400 px-3 py-2 w-28">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b border-dim-100 last:border-b-0">
                      <td className="px-3 py-2">
                        <select
                          value={item.serviceId}
                          onChange={(e) => pickService(i, e.target.value)}
                          className={cellInput}
                        >
                          <option value="">Selecionar…</option>
                          {services?.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => setItem(i, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                          className={`${cellInput} text-right`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => setItem(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                          className={`${cellInput} text-right`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[12px] font-semibold text-dim-900 whitespace-nowrap">
                        {(item.quantity * item.unitPrice).toLocaleString("pt-PT")} CVE
                      </td>
                      <td className="px-2 py-2">
                        {items.length > 1 && (
                          <button
                            onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                            className="w-6 h-6 flex items-center justify-center rounded text-dim-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-dim-50 border-t border-dim-200">
                    <td colSpan={3} className="px-3 py-2.5 text-right text-[12px] font-bold text-dim-700">
                      Total
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[14px] font-bold text-dim-900 whitespace-nowrap">
                      {total.toLocaleString("pt-PT")} CVE
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observações opcionais…"
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/60 flex items-center gap-3">
          {error && <p className="text-[12px] text-red-600 flex-1">{error}</p>}
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/billing"
              className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
            >
              Cancelar
            </Link>
            <button
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]"
            >
              {submitting ? "A guardar…" : "Emitir Fatura"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
