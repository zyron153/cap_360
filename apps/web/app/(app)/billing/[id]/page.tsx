"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import { ArrowLeft, Download, CheckCircle2, Clock, AlertCircle, RefreshCw, Shield } from "lucide-react";
import { RecordPaymentSchema, type RecordPaymentDto, type Invoice, type EFaturaSubmission } from "@cap/types";

async function fetchInvoice(id: string) {
  const res = await fetch(`/api/invoices/${id}`);
  if (!res.ok) throw new Error("Fatura não encontrada");
  return res.json() as Promise<Invoice & { patient: { fullName: string } }>;
}

async function recordPayment(id: string, data: RecordPaymentDto) {
  const res = await fetch(`/api/invoices/${id}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message ?? "Erro ao registar pagamento");
  }
  return res.json();
}

async function getReceiptUrl(id: string) {
  const res = await fetch(`/api/invoices/${id}/receipt`);
  if (!res.ok) throw new Error("Erro ao obter recibo");
  return res.json() as Promise<{ url: string }>;
}

async function fetchEFaturaStatus(id: string) {
  const res = await fetch(`/api/invoices/${id}/efatura`);
  if (!res.ok) return null;
  return res.json() as Promise<EFaturaSubmission>;
}

async function retryEFatura(id: string) {
  const res = await fetch(`/api/invoices/${id}/efatura/retry`, { method: "POST" });
  if (!res.ok) throw new Error("Erro ao retentar submissão");
  return res.json();
}

const EFATURA_META: Record<string, { label: string; cls: string; dot: string }> = {
  pending:    { label: "Pendente",    cls: "bg-dim-100 text-dim-500",                                       dot: "bg-dim-400"    },
  submitting: { label: "A enviar…",  cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80",            dot: "bg-brand-500"  },
  accepted:   { label: "Aceite",     cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",      dot: "bg-emerald-500"},
  rejected:   { label: "Rejeitada",  cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80",                  dot: "bg-red-500"    },
  cancelled:  { label: "Cancelada",  cls: "bg-dim-100 text-dim-400",                                        dot: "bg-dim-300"    },
  error:      { label: "Erro",       cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",             dot: "bg-amber-500"  },
};

function EFaturaPanel({ invoiceId }: { invoiceId: string }) {
  const qc = useQueryClient();
  const { data: submission, isLoading } = useQuery({
    queryKey: ["efatura", invoiceId],
    queryFn: () => fetchEFaturaStatus(invoiceId),
    refetchInterval: (q) =>
      q.state.data?.status === "submitting" || q.state.data?.status === "pending"
        ? 4_000
        : false,
  });

  const retryMutation = useMutation({
    mutationFn: () => retryEFatura(invoiceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["efatura", invoiceId] });
    },
  });

  if (isLoading) return null;
  if (!submission) return null;

  const meta = EFATURA_META[submission.status] ?? EFATURA_META.pending;
  const canRetry = submission.status === "error" || submission.status === "rejected";

  return (
    <div className="px-6 py-5 border-t border-dim-100 bg-dim-50/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-dim-500" />
          <h3 className="font-display text-[13px] font-semibold text-dim-900">E-Factura</h3>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {submission.atcud && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dim-500">ATCUD</span>
            <span className="font-mono text-[11px] text-dim-900 font-semibold">{submission.atcud}</span>
          </div>
        )}
        {submission.efaturaRef && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dim-500">Referência</span>
            <span className="font-mono text-[11px] text-dim-900">{submission.efaturaRef}</span>
          </div>
        )}
        {submission.submittedAt && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dim-500">Enviado em</span>
            <span className="font-mono text-[11px] text-dim-600">
              {format(new Date(submission.submittedAt), "d MMM yyyy HH:mm", { locale: pt })}
            </span>
          </div>
        )}
        {submission.errorMessage && (
          <p className="text-[11px] text-red-600 mt-1 p-2 bg-red-50 rounded-[8px]">
            {submission.errorMessage}
          </p>
        )}
        {submission.retryCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dim-500">Tentativas</span>
            <span className="font-mono text-[11px] text-dim-500">{submission.retryCount}</span>
          </div>
        )}
      </div>

      {canRetry && (
        <button
          onClick={() => retryMutation.mutate()}
          disabled={retryMutation.isPending}
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${retryMutation.isPending ? "animate-spin" : ""}`} />
          {retryMutation.isPending ? "A retentar…" : "Retentar submissão"}
        </button>
      )}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  draft:          { label: "Rascunho",     cls: "bg-dim-100 text-dim-500",                              icon: Clock         },
  issued:         { label: "Emitida",      cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80",  icon: Clock         },
  partially_paid: { label: "Pag. Parcial", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",  icon: Clock         },
  paid:           { label: "Paga",         cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80", icon: CheckCircle2  },
  overdue:        { label: "Vencida",      cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80",        icon: AlertCircle   },
  cancelled:      { label: "Cancelada",    cls: "bg-dim-100 text-dim-400",                              icon: AlertCircle   },
};

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => fetchInvoice(id),
    staleTime: 60_000,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RecordPaymentDto>({
    resolver: zodResolver(RecordPaymentSchema),
    defaultValues: { method: "cash" },
  });

  // One key per payment attempt — stable across retries of the same submit (double-click, a
  // client timeout retry), regenerated once the form resets for the next, separate payment.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const payMutation = useMutation({
    mutationFn: (data: RecordPaymentDto) => recordPayment(id, { ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["billing-summary"] });
      reset();
      setIdempotencyKey(crypto.randomUUID());
    },
  });

  const receiptMutation = useMutation({
    mutationFn: () => getReceiptUrl(id),
    onSuccess: ({ url }) => window.open(url, "_blank"),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl flex flex-col gap-5 animate-pulse">
        <div className="w-24 h-3 bg-dim-100 rounded" />
        <div className="bg-dim-100 rounded-[16px] h-96" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="py-16 text-center">
        <p className="text-[13px] text-red-600">Fatura não encontrada.</p>
      </div>
    );
  }

  const amountDue = Number(invoice.total) - Number(invoice.amountPaid);
  const statusMeta = STATUS_META[invoice.status];
  const StatusIcon = statusMeta?.icon ?? Clock;
  const paidPercent = invoice.total > 0
    ? Math.min(100, Math.round((Number(invoice.amountPaid) / Number(invoice.total)) * 100))
    : 0;

  return (
    <div className="max-w-3xl flex flex-col gap-5">

      {/* Nav + actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/billing"
          className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Faturação
        </Link>
        <button
          onClick={() => receiptMutation.mutate()}
          disabled={receiptMutation.isPending}
          className="flex items-center gap-2 border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 text-[13px] font-medium px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-colors cursor-pointer disabled:opacity-60"
        >
          <Download className="w-3.5 h-3.5" />
          {receiptMutation.isPending ? "A obter…" : "Recibo PDF"}
        </button>
      </div>

      {/* Invoice card */}
      <div className={CARD}>
        {/* Header */}
        <div className="px-6 py-6 border-b border-dim-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold text-dim-400 uppercase tracking-[0.1em] mb-1">Fatura</p>
              <h1 className="font-display text-[24px] font-bold text-dim-900 font-mono">{invoice.invoiceNumber}</h1>
              <div className="flex items-center gap-2.5 mt-2">
                <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-800 font-semibold text-[11px] flex items-center justify-center">
                  {invoice.patient.fullName?.[0]?.toUpperCase()}
                </div>
                <span className="text-[13px] font-medium text-dim-700">{invoice.patient.fullName}</span>
              </div>
              {invoice.issuedAt && (
                <p className="font-mono text-[11px] text-dim-400 mt-1.5">
                  {format(new Date(invoice.issuedAt), "d 'de' MMMM 'de' yyyy", { locale: pt })}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="font-display font-bold text-[32px] text-dim-900 tabular-nums leading-none">
                {Number(invoice.total).toLocaleString("pt-CV")}
                <span className="text-[14px] font-normal text-dim-400 ml-1.5">CVE</span>
              </p>
              {amountDue > 0 && (
                <p className="text-[12px] text-red-600 font-medium mt-1">
                  Em dívida: <span className="font-mono">{amountDue.toLocaleString("pt-CV")} CVE</span>
                </p>
              )}
              <div className="mt-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${statusMeta?.cls}`}>
                  <StatusIcon className="w-3 h-3" />
                  {statusMeta?.label ?? invoice.status}
                </span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {paidPercent > 0 && paidPercent < 100 && (
            <div className="mt-5">
              <div className="flex justify-between text-[11px] text-dim-500 mb-1.5">
                <span className="font-mono">{paidPercent}% pago</span>
                <span className="font-mono">{100 - paidPercent}% em dívida</span>
              </div>
              <div className="h-1.5 bg-dim-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${paidPercent}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="px-6 py-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Descrição", "Qtd.", "Preço Unit.", "Total"].map((h, i) => (
                  <th
                    key={h}
                    className={`text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 py-2 pb-3 border-b border-dim-100 ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item) => (
                <tr key={item.id} className="border-b border-dim-50">
                  <td className="py-3 text-[13px] text-dim-900">{item.description}</td>
                  <td className="py-3 text-right font-mono text-[12px] text-dim-600 tabular-nums">{item.quantity}</td>
                  <td className="py-3 text-right font-mono text-[12px] text-dim-600 tabular-nums">{Number(item.unitPrice).toLocaleString("pt-CV")} CVE</td>
                  <td className="py-3 text-right font-mono text-[13px] font-semibold text-dim-900 tabular-nums">{Number(item.total).toLocaleString("pt-CV")} CVE</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-dim-200">
                <td colSpan={3} className="py-3 text-[13px] font-semibold text-dim-700 text-right pr-4">Total</td>
                <td className="py-3 text-right font-mono text-[14px] font-bold text-dim-900 tabular-nums">{Number(invoice.total).toLocaleString("pt-CV")} CVE</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Payments */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/40">
            <h3 className="font-display text-[13px] font-semibold text-dim-900 mb-3">Pagamentos Registados</h3>
            <div className="flex flex-col gap-2">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex justify-between items-center">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 bg-emerald-100 rounded-md flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <span className="text-[12px] text-dim-600">
                      <span className="font-mono">{format(new Date(p.paidAt), "d MMM yyyy", { locale: pt })}</span>
                      {" · "}<span className="capitalize">{p.method?.replace("_", " ")}</span>
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-emerald-700 tabular-nums">
                    +{Number(p.amount).toLocaleString("pt-CV")} CVE
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* E-Factura status panel */}
        <EFaturaPanel invoiceId={id} />

        {/* Record payment form */}
        {!["paid", "cancelled"].includes(invoice.status) && (
          <form
            onSubmit={handleSubmit((data) => payMutation.mutate(data))}
            className="px-6 py-5 border-t border-dim-100"
          >
            <h3 className="font-display text-[14px] font-semibold text-dim-900 mb-4">Registar Pagamento</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
                  Valor (CVE) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  {...register("amount", { valueAsNumber: true })}
                  defaultValue={amountDue}
                  className={inputCls}
                />
                {errors.amount && <p className="text-[11px] text-red-600 mt-1">{errors.amount.message}</p>}
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
                  Método <span className="text-red-500">*</span>
                </label>
                <select {...register("method")} className={inputCls}>
                  <option value="cash">Numerário</option>
                  <option value="bank_transfer">Transferência</option>
                  <option value="health_plan">Plano de Saúde</option>
                  <option value="vinti4">Vinti4</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Referência</label>
                <input {...register("reference")} className={inputCls} placeholder="Opcional" />
              </div>
            </div>

            {payMutation.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-[10px]">
                <p className="text-[12px] text-red-700">{(payMutation.error as Error).message}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={payMutation.isPending}
              className="mt-4 bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)] cursor-pointer"
            >
              {payMutation.isPending ? "A registar…" : "Registar Pagamento"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
