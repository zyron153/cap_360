import { Check, Circle } from "lucide-react";
import type { PasswordRuleItem } from "../../lib/password-policy";

/** The rules for a new password, visible before the user submits — each one turns green as it's
 * met while they type. Purely informative: the form's submit button isn't gated on it. */
export function PasswordChecklist({ items, className = "" }: { items: PasswordRuleItem[]; className?: string }) {
  return (
    <ul aria-label="Requisitos da palavra-passe" className={`space-y-1 ${className}`}>
      {items.map(({ label, met }) => (
        <li key={label} className={`flex items-center gap-1.5 text-[11px] transition-colors ${met ? "text-emerald-700" : "text-slate-500"}`}>
          {met
            ? <Check className="w-3 h-3 shrink-0" strokeWidth={3} aria-hidden />
            : <Circle className="w-3 h-3 shrink-0 text-slate-300" aria-hidden />}
          <span>{label}</span>
          <span className="sr-only">{met ? "(cumprido)" : "(por cumprir)"}</span>
        </li>
      ))}
    </ul>
  );
}
