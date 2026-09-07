import type { ReactNode } from "react";

/**
 * The one shared form-field wrapper for the whole app.
 *
 * Renders an implicit `<label>` around its control so the label/input association is reliable for
 * both screen readers and `testing-library`'s `getByLabel()` — the control does not need its own
 * `id`/`htmlFor`. Previously this ~15-line label+error block was copy-pasted into nine pages with
 * drifting prop signatures (see `Docs/REVIEW.md` §4.1).
 */
export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block cursor-default">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-dim-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {hint && <span className="text-[10px] text-dim-400">{hint}</span>}
      </span>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </label>
  );
}
