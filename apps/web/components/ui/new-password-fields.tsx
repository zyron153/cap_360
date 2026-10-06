"use client";

import { useId, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { PasswordInput } from "./password-input";
import { PasswordChecklist } from "./password-checklist";
import { PASSWORD_MAX_LENGTH, generatePassword, passwordPolicyItems } from "../../lib/password-policy";

const smallBtn =
  "inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold border border-dim-200 bg-white text-dim-600 rounded-[7px] hover:border-brand-400 hover:text-brand-700 disabled:opacity-40 disabled:hover:border-dim-200 disabled:hover:text-dim-600 transition-colors";

/** "Palavra-passe" + "Confirmar palavra-passe" for an admin setting a user's password (create user,
 * "Alterar senha"). Each field has its own show/hide eye and the rules list is visible from the
 * start, ticking off as the admin types. "Gerar" fills both fields with a random strong password and
 * reveals it; "Copiar" puts it on the clipboard so it can be passed on to the user. Controlled — the
 * parent owns the values and decides what happens on submit. */
export function NewPasswordFields({ password, confirm, onChange, inputCls, errors = {} }: {
  password: string;
  confirm: string;
  onChange: (next: { password: string; confirm: string }) => void;
  inputCls: string;
  errors?: { password?: string; confirm?: string };
}) {
  const id = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  function generate() {
    const generated = generatePassword();
    onChange({ password: generated, confirm: generated });
    setShowPassword(true); // the admin has to see what was generated
    setCopied(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the field can be revealed and selected.
    }
  }

  const labelCls = "text-[12px] font-semibold text-dim-700";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={`${id}-password`} className={labelCls}>
            Palavra-passe<span className="text-red-500 ml-0.5">*</span>
          </label>
          <span className="flex items-center gap-1.5">
            <button type="button" onClick={generate} className={smallBtn} title="Gerar uma palavra-passe forte">
              <RefreshCw style={{ width: 11, height: 11 }} /> Gerar
            </button>
            <button type="button" onClick={copy} disabled={!password} className={smallBtn} title="Copiar a palavra-passe">
              {copied ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
              {copied ? "Copiada" : "Copiar"}
            </button>
          </span>
        </div>
        <PasswordInput
          id={`${id}-password`}
          className={inputCls}
          toggleLabel="palavra-passe"
          shown={showPassword}
          onShownChange={setShowPassword}
          value={password}
          onChange={(e) => onChange({ password: e.target.value, confirm })}
          placeholder="Defina a palavra-passe"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
        />
        {errors.password && <p className="text-[11px] text-red-600 mt-1.5">{errors.password}</p>}
        <PasswordChecklist items={passwordPolicyItems(password)} className="mt-2.5" />
      </div>

      <div>
        <div className="flex items-center mb-1.5 min-h-[26px]">
          <label htmlFor={`${id}-confirm`} className={labelCls}>
            Confirmar palavra-passe<span className="text-red-500 ml-0.5">*</span>
          </label>
        </div>
        <PasswordInput
          id={`${id}-confirm`}
          className={inputCls}
          toggleLabel="confirmação da palavra-passe"
          value={confirm}
          onChange={(e) => onChange({ password, confirm: e.target.value })}
          placeholder="Repita a palavra-passe"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
        />
        {errors.confirm && <p className="text-[11px] text-red-600 mt-1.5">{errors.confirm}</p>}
        <PasswordChecklist
          items={[{ label: "As duas palavras-passe coincidem", met: confirm.length > 0 && confirm === password }]}
          className="mt-2.5"
        />
      </div>
    </div>
  );
}
