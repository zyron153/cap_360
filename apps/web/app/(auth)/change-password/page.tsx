"use client";

import { Suspense, useState } from "react";
import { Stethoscope, AlertCircle, KeyRound } from "lucide-react";
import { useSearchParams } from "next/navigation";

const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

const inputCls = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

/** Only same-origin relative paths — `next` comes from the query string, so it must never be able
 * to bounce the user to another site (or back to this very screen). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/change-password")) return "/dashboard";
  return next;
}

/** First-login screen for accounts created (or reset) by an admin with a temporary password.
 * Not a public route: it needs the session issued at login, and SessionAuthGuard refuses every
 * other API call until the password has been changed here. */
function ChangePasswordCard() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!PASSWORD_RE.test(newPassword)) { setError("A nova palavra-passe deve ter pelo menos 10 caracteres, uma maiúscula e um número."); return; }
    if (newPassword !== confirm) { setError("As palavras-passe não coincidem."); return; }
    if (newPassword === currentPassword) { setError("A nova palavra-passe tem de ser diferente da temporária."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(typeof e.message === "string" ? e.message : "Não foi possível atualizar a palavra-passe.");
      }
      // Full navigation (not router.push): drops the client-side query cache, which still holds
      // the pre-change profile with mustChangePassword = true.
      window.location.assign(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro desconhecido.");
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700" />

          <div className="px-8 py-8 space-y-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center shadow-sm">
                <Stethoscope className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Defina a sua palavra-passe</h1>
                <p className="text-sm text-slate-500 mt-0.5">CAP 360</p>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            <div className="flex items-start gap-2 bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-2.5">
              <KeyRound className="w-4 h-4 text-brand-700 shrink-0 mt-0.5" />
              <p className="text-xs text-brand-800">
                Iniciou sessão com uma palavra-passe temporária. Escolha uma nova palavra-passe para continuar.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-left bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Palavra-passe temporária</label>
                <input
                  type="password"
                  className={inputCls}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Nova palavra-passe</label>
                <input
                  type="password"
                  className={inputCls}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="new-password"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">Mínimo 10 caracteres, com maiúscula e número.</p>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Confirmar nova palavra-passe</label>
                <input
                  type="password"
                  className={inputCls}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="new-password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm"
              >
                {submitting ? "A guardar…" : "Guardar e continuar"}
              </button>
            </form>

            <button type="button" onClick={logout} className="block mx-auto text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
              Terminar sessão
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">Palmarejo, Praia · Cabo Verde</p>
      </div>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense>
      <ChangePasswordCard />
    </Suspense>
  );
}
