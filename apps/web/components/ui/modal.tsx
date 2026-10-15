"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** "alertdialog" for a confirmation that interrupts the user (announced immediately by screen readers). */
  role?: "dialog" | "alertdialog";
  /** false: a click on the backdrop does nothing (a form with typed text must not vanish on a stray click). Escape and the close button still call `onClose`. */
  dismissOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (el: HTMLElement) => el.getClientRects().length > 0;

/**
 * Accessible modal: `role="dialog"` + `aria-modal` named by its title, focus moves inside on open (to the
 * element marked `data-autofocus`, else the first field/button of the body, else the close button), Tab is kept
 * inside while it is open, Escape closes it, and focus goes back to whatever opened it.
 */
export function Modal({ open, onClose, title, description, children, size = "md", role = "dialog", dismissOnBackdrop = true }: Props) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline `() => setOpen(false)`: keep it in a ref so the effect below runs once per open,
  // not once per render (which would re-steal focus on every keystroke in a form inside the modal).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const pick = (sel: string) => [...panel.querySelectorAll<HTMLElement>(sel)].find(visible);
      (pick("[data-autofocus]") ?? pick(`[data-modal-body] :is(${FOCUSABLE})`) ?? pick(FOCUSABLE) ?? panel).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panelRef.current.contains(active)) {
        // Focus is outside (e.g. the backdrop was clicked): pull it back in — unless another dialog on top owns it.
        if (!active || active === document.body) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={dismissOnBackdrop ? () => onCloseRef.current() : undefined} />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative bg-white rounded-[20px] shadow-[0_24px_64px_rgba(0,0,0,.18)] w-full ${w} flex flex-col max-h-[90vh] overflow-hidden focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-dim-100 shrink-0">
          <div>
            <h2 id={titleId} className="font-display text-[16px] font-bold text-dim-900">{title}</h2>
            {description && <p id={descId} className="text-[12px] text-dim-500 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Fechar"
            className="w-8 h-8 flex items-center justify-center rounded-[8px] text-dim-400 hover:text-dim-700 hover:bg-dim-100 transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div data-modal-body className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
