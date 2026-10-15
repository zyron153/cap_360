"use client";

import { useState } from "react";
import { NOTE_FINALIZED_CODE, NOTE_HAS_LINKED_RECORDS_CODE } from "@cap/types";
import { Modal } from "@/components/ui/modal";
import { HttpError, sendJson } from "./_note-shared";

/** Why a discard did not go through, in words the doctor can act on (the API's own messages are English). */
export class DiscardError extends Error {
  constructor(message: string, readonly kind: "gone" | "blocked" | "other") {
    super(message);
  }
}

/** `DELETE /clinical-notes/:id` — drafts only, author or admin. 404 = not visible/already gone, 409 = no longer discardable. */
export async function deleteDraft(noteId: string): Promise<void> {
  try {
    await sendJson(`/api/clinical-notes/${noteId}`, "DELETE");
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new DiscardError("Este rascunho já não existe — pode ter sido descartado noutro separador ou dispositivo.", "gone");
    }
    if (e instanceof HttpError && e.status === 409) {
      const code = (e.body as { code?: string } | null)?.code;
      const why =
        code === NOTE_HAS_LINKED_RECORDS_CODE ? "tem prescrições ou referenciações associadas"
        : code === NOTE_FINALIZED_CODE ? "já foi finalizado (por exemplo, noutro separador)"
        : "já foi finalizado ou tem prescrições/referenciações associadas";
      throw new DiscardError(`Não foi possível descartar: este rascunho ${why}. Atualize a página para ver o estado atual da nota.`, "blocked");
    }
    throw new DiscardError(e instanceof Error && e.message ? `Não foi possível descartar o rascunho: ${e.message}` : "Não foi possível descartar o rascunho. Tente novamente.", "other");
  }
}

/**
 * The confirmation for throwing a draft away. Focus lands on "Cancelar" (the safe choice), Escape closes it, and a
 * refusal from the API (already finalized, linked prescriptions, gone) is shown inside the dialog as an alert.
 * `onConfirm` does the discarding (and whatever should follow); throwing keeps the dialog open with the message.
 */
export function DiscardDraftModal({ open, onClose, onConfirm, what }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** e.g. "o rascunho de Maria Silva" */
  what: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return; // a double click must not send two deletes
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível descartar o rascunho.");
    } finally {
      setPending(false);
    }
  }
  const close = () => { if (!pending) { setError(null); onClose(); } };

  return (
    <Modal open={open} onClose={close} role="alertdialog" size="sm" title="Descartar rascunho?" description={`Vai apagar ${what}. O texto escrito perde-se e não pode ser recuperado.`}>
      {error && (
        <p role="alert" className="mx-6 mt-5 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">{error}</p>
      )}
      <div className="px-6 py-4 flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={close} disabled={pending} data-autofocus
          className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button" onClick={confirm} disabled={pending}
          className="bg-red-600 hover:bg-red-700 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors"
        >
          {pending ? "A descartar…" : "Descartar rascunho"}
        </button>
      </div>
    </Modal>
  );
}
