"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Stethoscope, AlertCircle } from "lucide-react";

const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{10,}$/;
const inputCls = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

function ResetPasswordCard() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!token) { setError("Link de recuperação inválido — falta o token."); return; }
    if (!PASSWORD_RE.test(password)) { setError("A palavra-passe deve ter pelo menos 10 caracteres, uma maiúscula e um número."); return; }
    if (password !== confirm) { setError("As palavras-passe não coincidem."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? "Este link é inválido ou expirou. Peça um novo.");
      }
      router.push("/login?reset=1");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro desconhecido.");
    } finally {
      setSubmitting(false);
    }
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
                <h1 className="text-xl font-bold text-slate-900">Nova Palavra-passe</h1>
                <p className="text-sm text-slate-500 mt-0.5">CAP 360</p>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            <form onSubmit={submit} className="space-y-3.5">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Nova Palavra-passe</label>
                <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="new-password" />
                <p className="text-[10px] text-slate-400 mt-1">Mínimo 10 caracteres, com maiúscula e número.</p>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Confirmar Palavra-passe</label>
                <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••••" autoComplete="new-password" />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm"
              >
                {submitting ? "A atualizar…" : "Atualizar Palavra-passe"}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">Palmarejo, Praia · Cabo Verde</p>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordCard />
    </Suspense>
  );
}
