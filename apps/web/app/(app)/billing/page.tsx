"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Plus, Receipt, ChevronLeft, ChevronRight, TrendingUp, AlertCircle, Clock, Shield } from "lucide-react";
import type { Invoice, PaginatedResponse, EFaturaStatus, EFaturaSubmission } from "@cms/types";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { usePermissions } from "../hooks/use-permissions";

async function fetchInvoices(page: number, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (status) params.set("status", status);
  const res = await fetch(`/api/invoices?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar faturas");
  return res.json() as Promise<PaginatedResponse<Invoice & { patient: { fullName: string } }>>;
}

interface BillingSummary {
  issuedCount: number;
  collectedAmount: number;
  overdueCount: number;
}

async function fetchBillingSummary(): Promise<BillingSummary> {
  const res = await fetch("/api/bff/billing-summary");
  if (!res.ok) throw new Error("Erro ao carregar resumo");
  return res.json();
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:          { label: "Rascunho",     cls: "bg-dim-100 text-dim-500"                               },
  issued:         { label: "Emitida",      cls: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/80"   },
  partially_paid: { label: "Pag. Parcial", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"   },
  paid:           { label: "Paga",         cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" },
  overdue:        { label: "Vencida",      cls: "bg-red-50 text-red-600 ring-1 ring-red-200/80"         },
  cancelled:      { label: "Cancelada",    cls: "bg-dim-100 text-dim-400"                               },
};

const FILTERS = [
  { key: "",               label: "Todas"    },
  { key: "issued",         label: "Emitidas" },
  { key: "partially_paid", label: "Parcial"  },
  { key: "paid",           label: "Pagas"    },
  { key: "overdue",        label: "Vencidas" },
];

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

const EFATURA_DOT: Record<string, string> = {
  pending:    "bg-dim-300",
  submitting: "bg-brand-400 animate-pulse",
  accepted:   "bg-emerald-500",
  rejected:   "bg-red-500",
  error:      "bg-amber-500",
  cancelled:  "bg-dim-300",
};

const EFATURA_LABEL: Record<string, string> = {
  pending:    "A aguardar emissão…",
  submitting: "A submeter à AT…",
  accepted:   "Aceite pela AT",
  rejected:   "Rejeitada pela AT",
  error:      "Erro na submissão",
  cancelled:  "Anulada",
};

function EFaturaBadge({ status, atcud }: { status: EFaturaStatus; atcud: string | null }) {
  const dot = EFATURA_DOT[status] ?? "bg-dim-300";
  return (
    <span title={atcud ? `ATCUD: ${atcud}` : status} className="inline-flex items-center gap-1">
      <Shield className="w-3 h-3 text-dim-400" />
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
    </span>
  );
}

const BLANK_FORM = { patientId: "", patient: "", serviceId: "", description: "", amount: "", notes: "" };

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[100, 140, 80, 80, 80, 70, 30, 50].map((w, i) => (
        <td key={i} className="px-5 py-3.5 border-b border-dim-100">
          <div className="h-3 bg-dim-100 rounded inline-block" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

/* ─── Fatura Preview (E-Fatura template) ─────────────────────────────── */

type PreviewInvoice = Invoice & {
  patient: { fullName: string; nif: string | null };
  items: { id: string; description: string; quantity: number; unitPrice: number; total: number }[];
};

async function fetchInvoicePreview(id: string) {
  const res = await fetch(`/api/invoices/${id}`);
  if (!res.ok) throw new Error("Erro ao carregar fatura");
  return res.json() as Promise<PreviewInvoice>;
}

async function fetchClinicEFaturaInfo() {
  const res = await fetch("/api/settings");
  if (!res.ok) return null;
  const all = (await res.json()) as Record<string, Record<string, string>>;
  const cfg = all["integration_efatura"];
  if (!cfg) return null;
  return { nif: cfg.nifContribuinte ?? "", nome: cfg.nomeEmpresa ?? "" };
}

async function fetchEFaturaSubmission(id: string) {
  const res = await fetch(`/api/invoices/${id}/efatura`);
  if (!res.ok) return null;
  return res.json() as Promise<EFaturaSubmission>;
}

function FaturaPreviewModal({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", invoiceId, "preview"],
    queryFn: () => fetchInvoicePreview(invoiceId as string),
    enabled: !!invoiceId,
  });

  const { data: clinic } = useQuery({
    queryKey: ["settings-efatura-display"],
    queryFn: fetchClinicEFaturaInfo,
    enabled: !!invoiceId,
    staleTime: 60_000,
  });

  const { data: submission } = useQuery({
    queryKey: ["efatura", invoiceId],
    queryFn: () => fetchEFaturaSubmission(invoiceId as string),
    enabled: !!invoiceId,
    refetchInterval: (q) =>
      q.state.data?.status === "submitting" || q.state.data?.status === "pending" ? 3_000 : false,
  });

  const status = submission?.status ?? "pending";

  return (
    <Modal open={!!invoiceId} onClose={onClose} title="Fatura Emitida" description="Documento eletrónico E-Fatura" size="lg">
      {isLoading || !invoice ? (
        <div className="px-6 py-10 text-center text-[13px] text-dim-400">A carregar fatura…</div>
      ) : (
        <div className="px-6 py-6 flex flex-col gap-6">
          {/* Clinic vs. document header */}
          <div className="flex items-start justify-between pb-4 border-b border-dim-100">
            <div>
              <p className="font-display font-bold text-[16px] text-dim-900">{clinic?.nome || "Clínica Mais Saúde"}</p>
              <p className="font-mono text-[11px] text-dim-500 mt-0.5">NIF: {clinic?.nif || "—"}</p>
            </div>
            <div className="text-right">
              <p className="font-display font-bold text-[18px] text-dim-900">FATURA</p>
              <p className="font-mono text-[11px] text-dim-500">{invoice.invoiceNumber}</p>
              {invoice.issuedAt && (
                <p className="font-mono text-[11px] text-dim-400">{format(new Date(invoice.issuedAt), "dd/MM/yyyy")}</p>
              )}
            </div>
          </div>

          {/* Customer + E-Fatura status */}
          <div className="grid grid-cols-2 gap-4 text-[12px]">
            <div>
              <p className="text-dim-400 uppercase text-[10px] font-bold tracking-[0.06em] mb-1">Cliente</p>
              <p className="text-dim-900 font-semibold">{invoice.patient.fullName}</p>
              <p className="font-mono text-dim-500 mt-0.5">NIF: {invoice.patient.nif || "Consumidor Final"}</p>
            </div>
            <div className="text-right">
              <p className="text-dim-400 uppercase text-[10px] font-bold tracking-[0.06em] mb-1">Estado E-Fatura</p>
              <p className="inline-flex items-center gap-1.5 justify-end text-dim-800 font-semibold">
                <span className={`w-1.5 h-1.5 rounded-full ${EFATURA_DOT[status] ?? "bg-dim-300"}`} />
                {EFATURA_LABEL[status] ?? status}
              </p>
              {submission?.atcud && <p className="font-mono text-dim-500 mt-0.5">ATCUD: {submission.atcud}</p>}
            </div>
          </div>

          {/* Line items */}
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["Descrição", "Qtd.", "Preço Unit.", "Total"].map((h, i) => (
                  <th key={h} className={`text-[10px] font-bold uppercase tracking-[0.06em] text-dim-400 py-1.5 border-b border-dim-200 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 border-b border-dim-50 text-dim-900">{item.description}</td>
                  <td className="py-2 border-b border-dim-50 text-right font-mono text-dim-600">{item.quantity}</td>
                  <td className="py-2 border-b border-dim-50 text-right font-mono text-dim-600">{Number(item.unitPrice).toLocaleString("pt-CV")}</td>
                  <td className="py-2 border-b border-dim-50 text-right font-mono font-semibold text-dim-900">{Number(item.total).toLocaleString("pt-CV")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex flex-col items-end gap-1 text-[12px]">
            <div className="flex gap-8">
              <span className="text-dim-500">Subtotal</span>
              <span className="font-mono text-dim-900 tabular-nums w-28 text-right">{Number(invoice.subtotal).toLocaleString("pt-CV")} CVE</span>
            </div>
            <div className="flex gap-8">
              <span className="font-bold text-brand-700">TOTAL</span>
              <span className="font-mono font-bold text-dim-900 tabular-nums w-28 text-right">{Number(invoice.total).toLocaleString("pt-CV")} CVE</span>
            </div>
          </div>

          {submission?.errorMessage && (
            <p className="text-[11px] text-red-600 p-2.5 bg-red-50 rounded-[8px]">{submission.errorMessage}</p>
          )}

          <p className="text-[10px] text-dim-400 text-center pt-2 border-t border-dim-100">
            Documento gerado eletronicamente — válido sem assinatura, nos termos da legislação de Cabo Verde.
          </p>
        </div>
      )}
      <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
        {invoiceId && (
          <Link href={`/billing/${invoiceId}`} className="text-[12px] font-semibold text-brand-700 hover:text-brand-900 transition-colors">
            Ver detalhes completos →
          </Link>
        )}
        <button onClick={onClose} className="ml-auto border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

export default function BillingPage() {
  const { isLoading: permLoading, can, canDo } = usePermissions();
  const router = useRouter();
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!permLoading && !can("billing")) router.replace("/dashboard");
  }, [permLoading, can, router]);

  function set(k: keyof typeof BLANK_FORM, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: form.patientId,
          items: [{ serviceId: form.serviceId, description: form.description, unitPrice: Number(form.amount) }],
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message ?? "Erro ao criar fatura"); }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["billing-summary"] });
      setForm(BLANK_FORM);
      setNewOpen(false);
      setPreviewInvoiceId(invoice.id);
      addMessage("Success", "Fatura emitida e enviada para E-Fatura!");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["invoices", page, statusFilter],
    queryFn: () => fetchInvoices(page, statusFilter || undefined),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: summary } = useQuery({
    queryKey: ["billing-summary"],
    queryFn: fetchBillingSummary,
    staleTime: 60_000,
  });

  const { data: patientsData } = useQuery<{ data: { id: string; fullName: string }[] }>({
    queryKey: ["patients-list"],
    queryFn: () => fetch("/api/patients?limit=100").then(r => { if (!r.ok) throw new Error("patients"); return r.json(); }),
    staleTime: 60_000,
  });
  const patientsList = patientsData?.data ?? [];

  const { data: servicesList = [] } = useQuery<{ id: string; name: string; price: number }[]>({
    queryKey: ["services-list"],
    queryFn: () => fetch("/api/services").then(r => r.json()),
    staleTime: 60_000,
  });

  return (
    <>
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Faturação</h1>
          <p className="text-[13px] text-dim-500 mt-0.5">
            {isLoading ? "A carregar…" : error ? "Erro ao carregar faturas" : `${data?.total ?? 0} faturas`}
          </p>
        </div>
        {canDo("billing", "create") && (
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Fatura
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Receipt,      label: "Total Faturas",    value: data?.total ?? "—",       sub: "este mês",          bg: "bg-dim-100",     cls: "text-dim-600"     },
          { icon: Clock,        label: "Emitidas",         value: summary ? summary.issuedCount : "—",                                                    sub: "aguardam pagamento", bg: "bg-brand-50",    cls: "text-brand-600"   },
          { icon: TrendingUp,   label: "Receita Cobrada",  value: summary ? summary.collectedAmount.toLocaleString("pt-CV") : "—",                         sub: "CVE recebidos",      bg: "bg-emerald-50",  cls: "text-emerald-600" },
          { icon: AlertCircle,  label: "Vencidas",         value: summary ? summary.overdueCount : "—",                                                    sub: "requerem atenção",   bg: "bg-red-50",      cls: "text-red-500"     },
        ].map((s) => (
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

      {/* Filter tabs */}
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

      {/* Table */}
      <div className={CARD}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Nº Fatura", "Paciente", "Data", "Total", "Em Dívida", "Estado", "e-Fatura", ""].map((h) => (
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
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : error
                ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="w-12 h-12 bg-red-50 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-700">Erro ao carregar faturas</p>
                    </td>
                  </tr>
                )
                : data?.data.length === 0
                ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="w-12 h-12 bg-dim-100 rounded-[16px] flex items-center justify-center mx-auto mb-3">
                        <Receipt className="w-6 h-6 text-dim-400" />
                      </div>
                      <p className="text-[13px] font-medium text-dim-600">Nenhuma fatura encontrada</p>
                    </td>
                  </tr>
                )
                : data?.data.map((inv) => {
                  const amountDue = Number(inv.total) - Number(inv.amountPaid);
                  return (
                    <tr key={inv.id} className="hover:bg-dim-50 transition-colors group">
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] font-semibold text-dim-900">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-800 text-[10px] font-semibold flex items-center justify-center shrink-0">
                            {inv.patient.fullName[0]?.toUpperCase()}
                          </div>
                          <span className="text-[13px] font-medium text-dim-900">{inv.patient.fullName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[11px] text-dim-500">
                        {inv.issuedAt ? format(new Date(inv.issuedAt), "d MMM yyyy", { locale: pt }) : "—"}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100 font-mono text-[13px] font-semibold text-dim-900 tabular-nums">
                        {Number(inv.total).toLocaleString("pt-CV")}
                        <span className="text-[10px] font-normal text-dim-400 ml-1">CVE</span>
                      </td>
                      <td className={`px-5 py-3.5 border-b border-dim-100 font-mono text-[12px] tabular-nums font-medium ${amountDue > 0 ? "text-red-600" : "text-dim-400"}`}>
                        {amountDue.toLocaleString("pt-CV")}
                        <span className="text-[10px] ml-1 opacity-60">CVE</span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_META[inv.status]?.cls ?? "bg-dim-100 text-dim-600"}`}>
                          {STATUS_META[inv.status]?.label ?? inv.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        {(inv as Invoice & { efaturaSubmission?: { status: EFaturaStatus; atcud: string | null } }).efaturaSubmission && (
                          <EFaturaBadge
                            status={(inv as Invoice & { efaturaSubmission?: { status: EFaturaStatus; atcud: string | null } }).efaturaSubmission!.status}
                            atcud={(inv as Invoice & { efaturaSubmission?: { status: EFaturaStatus; atcud: string | null } }).efaturaSubmission!.atcud}
                          />
                        )}
                      </td>
                      <td className="px-5 py-3.5 border-b border-dim-100">
                        <Link
                          href={`/billing/${inv.id}`}
                          className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Detalhes →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3.5 border-t border-dim-100 flex items-center justify-between">
            <span className="text-[12px] text-dim-500">
              {data.total} faturas · Página <span className="font-semibold text-dim-700">{page}</span> de {data.totalPages}
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
      </div>
    </div>

    <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova Fatura" description="Cria e emite a fatura, submetendo automaticamente à E-Fatura" size="md">
      <div className="px-6 py-5 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Paciente *</label>
          <select
            value={form.patientId}
            onChange={(e) => {
              const p = patientsList.find((pt) => pt.id === e.target.value);
              setForm((f) => ({ ...f, patientId: e.target.value, patient: p?.fullName ?? "" }));
            }}
            className={inputCls}
          >
            <option value="">Selecionar paciente…</option>
            {patientsList.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Serviço *</label>
          <select
            value={form.serviceId}
            onChange={(e) => {
              const s = servicesList.find((sv) => sv.id === e.target.value);
              setForm((f) => ({ ...f, serviceId: e.target.value, description: s?.name ?? "", amount: s ? String(s.price) : f.amount }));
            }}
            className={inputCls}
          >
            <option value="">Selecionar serviço…</option>
            {servicesList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Valor Total (CVE) *</label>
          <input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" className={inputCls} />
        </div>
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Notas</label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Observações opcionais…" className={`${inputCls} resize-none`} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
        <button
          onClick={() => createInvoiceMutation.mutate()}
          disabled={createInvoiceMutation.isPending || !form.patientId || !form.serviceId || !(Number(form.amount) > 0)}
          className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors disabled:opacity-50"
        >
          {createInvoiceMutation.isPending ? "A criar…" : "Criar Fatura"}
        </button>
        <button onClick={() => setNewOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
          Cancelar
        </button>
      </div>
    </Modal>

    <FaturaPreviewModal invoiceId={previewInvoiceId} onClose={() => setPreviewInvoiceId(null)} />
    </>
  );
}
