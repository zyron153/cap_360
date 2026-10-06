"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";
import { sendJson } from "./_note-shared";

type Failed = { id: string; patientName: string };

/**
 * Completing a Consulta (checked_in → completed) from Registos Clínicos, shared by the day queue
 * and the note editor.
 *
 * The completion endpoint's auto-draft-invoice step is best-effort — a failure only ever surfaced
 * as a transient toast, with no way back to it: the appointment leaves the "Em consulta" list the
 * moment it's completed regardless of invoice outcome. So failures are kept here (same-session
 * state, not a system of record — the invoice can always be generated later from Faturas) and
 * rendered by <FailedInvoicesBanner> with a retry button.
 */
export function useConcludeAppointment() {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [failedInvoices, setFailedInvoices] = useState<Failed[]>([]);

  const conclude = useMutation({
    mutationFn: ({ id, durationMinutes }: { id: string; durationMinutes: number; patientName: string }) =>
      sendJson<{ invoiceWarning?: string }>(`/api/appointments/${id}/status`, "PATCH", { status: "completed", durationMinutes }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      if (data?.invoiceWarning) setFailedInvoices((prev) => [...prev, { id: variables.id, patientName: variables.patientName }]);
      addMessage(data?.invoiceWarning ? "Warning" : "Success", data?.invoiceWarning ?? "Consulta concluída e fatura gerada com sucesso!");
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  const retryInvoice = useMutation({
    mutationFn: (id: string) => sendJson(`/api/appointments/${id}/invoice`, "POST"),
    onSuccess: (_data, id) => {
      setFailedInvoices((prev) => prev.filter((f) => f.id !== id));
      addMessage("Success", "Fatura gerada com sucesso!");
    },
    onError: (err: Error) => addMessage("Error", err.message),
  });

  return { conclude, retryInvoice, failedInvoices };
}

export function FailedInvoicesBanner({ failed, onRetry, pending }: { failed: Failed[]; onRetry: (id: string) => void; pending: boolean }) {
  if (!failed.length) return null;
  return (
    <div role="alert" className="bg-amber-50 border border-amber-200 rounded-[14px] px-5 py-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <p className="text-[12px] font-semibold text-amber-800">
          Consulta{failed.length > 1 ? "s" : ""} concluída{failed.length > 1 ? "s" : ""} sem fatura gerada automaticamente
        </p>
      </div>
      {failed.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-3 pl-6">
          <span className="text-[12px] text-dim-700">{f.patientName}</span>
          <button
            disabled={pending}
            onClick={() => onRetry(f.id)}
            className="text-[11px] font-semibold px-3 py-1 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50 shrink-0"
          >
            {pending ? "…" : "Gerar Fatura"}
          </button>
        </div>
      ))}
    </div>
  );
}
