"use client";

import { Suspense, useState } from "react";
import { Stethoscope, AlertCircle, CheckCircle2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const inputCls = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

function LoginCard() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") ?? "/dashboard";
  const activated = params.get("activated") === "1";
  const reset = params.get("reset") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? "Não foi possível iniciar sessão.");
      }
      router.push(next);
      router.refresh();
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
                <h1 className="text-xl font-bold text-slate-900">CAP</h1>
                <p className="text-sm text-slate-500 mt-0.5">Sistema de Gestão 360</p>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {error && (
              <div className="flex items-start gap-2 text-left bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
            {activated && !error && (
              <div className="flex items-start gap-2 text-left bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700">Conta ativada com sucesso! Inicie sessão para continuar.</p>
              </div>
            )}
            {reset && !error && (
              <div className="flex items-start gap-2 text-left bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700">Palavra-passe atualizada com sucesso! Inicie sessão.</p>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@cap.cv"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[12px] font-semibold text-slate-700">Palavra-passe</label>
                  <a href="/forgot-password" className="text-[11px] text-brand-600 hover:text-brand-700 font-medium">
                    Esqueceu-se?
                  </a>
                </div>
                <input
                  type="password"
                  className={inputCls}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm"
              >
                {submitting ? "A entrar…" : "Entrar"}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">
          Palmarejo, Praia · Cabo Verde
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
