"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** What the show/hide button is announced as, e.g. "palavra-passe temporária" →
   * "Mostrar palavra-passe temporária". Several of these on one page need distinct names. */
  toggleLabel?: string;
  /** Optional controlled visibility, for a parent that also needs to reveal the field itself (the
   * "Gerar" button shows the password it just generated). Uncontrolled when omitted. */
  shown?: boolean;
  onShownChange?: (shown: boolean) => void;
};

/** Password field with a show/hide button, so a typo can be checked before submitting. `className`
 * styles the <input> itself (pass the page's own input class); room for the button is added here. */
export function PasswordInput({ className = "", toggleLabel = "palavra-passe", shown: shownProp, onShownChange, ...props }: Props) {
  const [shownState, setShownState] = useState(false);
  const shown = shownProp ?? shownState;
  const label = `${shown ? "Ocultar" : "Mostrar"} ${toggleLabel}`;

  function toggle() {
    setShownState(!shown);
    onShownChange?.(!shown);
  }

  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={shown}
        title={label}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors"
      >
        {shown ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
      </button>
    </div>
  );
}
