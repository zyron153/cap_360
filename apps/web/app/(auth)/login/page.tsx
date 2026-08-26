"use client";

import { Suspense } from "react";
import { Stethoscope, AlertCircle, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

const ERROR_LABELS: Record<string, string> = {
  invalid_state: "Sessão de autenticação inválida ou expirada. Tente novamente.",
  token_exchange_failed: "Não foi possível concluir a autenticação. Tente novamente.",
};

function LoginCard() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const error = params.get("error");
  const activated = params.get("activated") === "1";
  const loginUrl = `/api/auth/login?next=${encodeURIComponent(next)}`;

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Top accent */}
          <div className="h-1.5 bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700" />

          <div className="px-8 py-8 text-center space-y-6">
            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center shadow-sm">
                <Stethoscope className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">CAP</h1>
                <p className="text-sm text-slate-500 mt-0.5">Sistema de Gestão 360</p>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100" />

            {error && (
              <div className="flex items-start gap-2 text-left bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{ERROR_LABELS[error] ?? "Ocorreu um erro ao iniciar sessão."}</p>
              </div>
            )}
            {activated && !error && (
              <div className="flex items-start gap-2 text-left bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700">Conta ativada com sucesso! Inicie sessão para continuar.</p>
              </div>
            )}

            {/* Sign in */}
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Inicie sessão com a sua conta institucional para aceder ao sistema.
              </p>
              <a
                href={loginUrl}
                className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm cursor-pointer"
              >
                Entrar com a sua conta
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
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
