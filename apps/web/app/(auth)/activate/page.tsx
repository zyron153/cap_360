"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Stethoscope, AlertCircle } from "lucide-react";
import type { PublicInvitationInfo } from "@cms/types";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", doctor: "Médico/a", nurse: "Enfermeiro/a",
  receptionist: "Recepcionista", lab_tech: "Lab Tech",
};

const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

const inputCls = "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

function ActivateCard() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [invite, setInvite] = useState<PublicInvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoadError("Convite inválido — falta o token."); setLoading(false); return; }
    fetch(`/api/public/invitations/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Este convite é inválido ou já foi utilizado.");
        return r.json() as Promise<PublicInvitationInfo>;
      })
      .then((data) => { setInvite(data); setFullName(data.fullName); })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!fullName.trim()) { setSubmitError("Indique o seu nome."); return; }
    if (!PASSWORD_RE.test(password)) { setSubmitError("A palavra-passe deve ter pelo menos 10 caracteres, uma maiúscula e um número."); return; }
    if (password !== confirm) { setSubmitError("As palavras-passe não coincidem."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/invitations/${token}/activate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), password }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao ativar a conta."); }
      router.push("/login?activated=1");
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Erro desconhecido.");
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
                <h1 className="text-xl font-bold text-slate-900">Ativar Conta</h1>
                <p className="text-sm text-slate-500 mt-0.5">Clínica Mais Saúde 360</p>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {loading ? (
              <p className="text-sm text-slate-500 text-center py-4">A verificar convite…</p>
            ) : loadError || invite?.expired ? (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{invite?.expired ? "Este convite expirou. Peça ao administrador para enviar um novo." : loadError}</p>
              </div>
            ) : invite ? (
              <form onSubmit={submit} className="space-y-3.5">
                <div className="bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-brand-800">
                    <strong>{invite.email}</strong> · {ROLE_LABELS[invite.role] ?? invite.role}
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Nome</label>
                  <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Palavra-passe</label>
                  <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
                  <p className="text-[10px] text-slate-400 mt-1">Mínimo 10 caracteres, com maiúscula e número.</p>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Confirmar Palavra-passe</label>
                  <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••••" />
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{submitError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center justify-center w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-all shadow-sm hover:shadow-md text-sm"
                >
                  {submitting ? "A ativar…" : "Ativar Conta"}
                </button>
              </form>
            ) : null}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">Palmarejo, Praia · Cabo Verde</p>
      </div>
    </main>
  );
}

export default function ActivatePage() {
  return (
    <Suspense>
      <ActivateCard />
    </Suspense>
  );
}
