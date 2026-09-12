"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import { CheckCircle2, Wallet } from "lucide-react";
import type { PatientOutstandingBalance } from "@cap/types";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitida",
  partially_paid: "Pag. Parcial",
  overdue: "Vencida",
};

async function fetchBalance(patientId: string): Promise<PatientOutstandingBalance> {
  const res = await fetch(`/api/financeiro/saldos/${patientId}`);
  if (!res.ok) throw new Error("Erro ao carregar saldo");
  return res.json();
}

export function PatientBalancePanel({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["patient-balance", patientId],
    queryFn: () => fetchBalance(patientId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className={`${CARD} h-24 animate-pulse`} />;
  }
  if (!data) return null;

  return (
    <div className={CARD}>
      <div className="px-6 py-4 border-b border-dim-100 flex items-center justify-between">
        <h3 className="font-display font-semibold text-[15px] text-dim-900">Saldo em Aberto</h3>
        {data.totalDue > 0 && (
          <span className="font-mono text-[13px] font-bold text-red-600">
            {data.totalDue.toLocaleString("pt-CV")} <span className="text-[10px] font-normal text-dim-400">CVE</span>
          </span>
        )}
      </div>

      {data.totalDue <= 0 ? (
        <div className="px-6 py-5 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <p className="text-[13px] text-dim-600">Sem saldo em aberto.</p>
        </div>
      ) : (
        <div className="px-6 py-4 flex flex-col gap-2.5">
          {data.overdueCount > 0 && (
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <p className="text-[12px] text-red-600 font-medium">
                {data.overdueCount} fatura{data.overdueCount > 1 ? "s" : ""} vencida{data.overdueCount > 1 ? "s" : ""}
              </p>
            </div>
          )}
          {data.invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/billing/${inv.id}`}
              className="flex items-center justify-between text-[12px] hover:bg-dim-50 -mx-2 px-2 py-1.5 rounded-[8px] transition-colors"
            >
              <span className="text-dim-700 font-mono">{inv.invoiceNumber}</span>
              <span className="text-dim-400">
                {STATUS_LABEL[inv.status] ?? inv.status}
                {inv.dueDate && ` · venceu ${format(new Date(inv.dueDate), "d MMM", { locale: pt })}`}
              </span>
              <span className="font-mono font-semibold text-dim-900 tabular-nums">
                {inv.amountDue.toLocaleString("pt-CV")} CVE
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
