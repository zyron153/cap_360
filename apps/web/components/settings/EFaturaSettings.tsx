"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Link2, Receipt, ShieldCheck, Upload } from "lucide-react";
import type { EFaturaConfigView, UpdateEFaturaConfigDto } from "@cap/types";
import { CARD, inputCls, Field } from "./shared";
import { useMessage } from "../ui/message-handler";

// Admin screen for the direct integration with the Cabo Verde e-Fatura platform (DNRE).
// Everything secret is write-only: the API never sends the client secret, the refresh token
// or the certificate back — only whether each one is present.

type Form = Omit<EFaturaConfigView, "provider" | "hasTechplacePassword" | "hasTechplaceApiKey" | "hasClientSecret" | "connected" | "connectedAt" | "hasCertificate" | "certificateSubject" | "certificateNotAfter" | "clinicName" | "clinicNif" | "ready" | "missing">;

type TpRow = { id: string; name: string };
type Lookups = { tipos: TpRow[]; metodos: TpRow[]; condicoes: TpRow[] } | { error: string };

/** The CAP payment methods a Techplace payment-method id must be given for. */
const METHODS = [
  { k: "cash", label: "Dinheiro" },
  { k: "vinti4", label: "Cartão (Vinti4)" },
  { k: "bank_transfer", label: "Transferência bancária" },
  { k: "health_plan", label: "Plano de saúde" },
] as const;

const REPOSITORIES = [
  { v: 2, label: "Homologação (testes de integração)" },
  { v: 3, label: "Teste" },
  { v: 1, label: "Produção (documentos com validade legal)" },
] as const;

const REASONS = ["2", "3", "6", "7", "8", "9", "DRP", "IN"];

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const txt = (v: string): string | null => (v.trim() === "" ? null : v.trim());

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = body?.message;
    throw new Error(Array.isArray(m) ? m.map((x: { message: string }) => x.message).join("; ") : (m ?? "Erro"));
  }
  return body as T;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="w-9 h-5 bg-dim-200 rounded-full peer peer-checked:bg-brand-700 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 border-t border-dim-100 first:border-0 first:pt-0">
      <p className="text-[12px] font-semibold text-dim-800">{title}</p>
      {hint && <p className="text-[11px] text-dim-400 mt-0.5 mb-3">{hint}</p>}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 ${hint ? "" : "mt-3"}`}>{children}</div>
    </div>
  );
}

/** base64 of the raw bytes, or the text itself for a PEM file. */
async function readCertificate(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const asText = new TextDecoder().decode(buf);
  if (asText.includes("-----BEGIN")) return asText;
  let bin = "";
  buf.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function EFaturaSettings() {
  const { addMessage } = useMessage();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [tpPassword, setTpPassword] = useState("");
  const [tpApiKey, setTpApiKey] = useState("");
  const [lookups, setLookups] = useState<Lookups | null>(null);

  const { data: view, error } = useQuery<EFaturaConfigView>({
    queryKey: ["efatura-config"],
    queryFn: () => api("/api/efatura/config"),
    retry: false,
  });

  useEffect(() => {
    if (!view) return;
    const { provider, hasTechplacePassword, hasTechplaceApiKey, hasClientSecret, connected, connectedAt, hasCertificate, certificateSubject, certificateNotAfter, clinicName, clinicNif, ready, missing, ...f } = view;
    void [provider, hasTechplacePassword, hasTechplaceApiKey, hasClientSecret, connected, connectedAt, hasCertificate, certificateSubject, certificateNotAfter, clinicName, clinicNif, ready, missing];
    setForm(f);
  }, [view]);

  // Back from the DNRE consent screen: /settings?efatura=connected|error&msg=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const status = q.get("efatura");
    if (!status) return;
    if (status === "connected") addMessage("Success", "Ligação à Plataforma Eletrónica autorizada.");
    else addMessage("Error", q.get("msg") ?? "Não foi possível autorizar a ligação.");
    window.history.replaceState({}, "", window.location.pathname);
    qc.invalidateQueries({ queryKey: ["efatura-config"] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const onDone = (v: EFaturaConfigView, msg: string) => {
    qc.setQueryData(["efatura-config"], v);
    addMessage("Success", msg);
  };
  const onFail = (e: Error) => addMessage("Error", e.message);

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateEFaturaConfigDto = { ...(form as Form) };
      if (clientSecret) body.oauthClientSecret = clientSecret;
      if (tpPassword) body.techplacePassword = tpPassword;
      if (tpApiKey) body.techplaceApiKey = tpApiKey;
      return api<EFaturaConfigView>("/api/efatura/config", { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: (v) => { setClientSecret(""); setTpPassword(""); setTpApiKey(""); onDone(v, "Configuração e-Fatura guardada."); },
    onError: onFail,
  });

  const testTechplace = useMutation({
    mutationFn: () => api<Lookups>("/api/efatura/techplace/test", { method: "POST" }),
    onSuccess: (r) => { setLookups(r); if ("error" in r) addMessage("Error", r.error); },
    onError: onFail,
  });

  const authorize = useMutation({
    mutationFn: () => api<{ url?: string; error?: string }>("/api/efatura/oauth/authorize", { method: "POST" }),
    onSuccess: (r) => (r.url ? (window.location.href = r.url) : addMessage("Error", r.error ?? "Não foi possível iniciar a autorização.")),
    onError: onFail,
  });

  const disconnect = useMutation({
    mutationFn: () => api<EFaturaConfigView>("/api/efatura/oauth/disconnect", { method: "POST" }),
    onSuccess: (v) => onDone(v, "Ligação terminada."),
    onError: onFail,
  });

  const uploadCert = useMutation({
    mutationFn: async () =>
      api<EFaturaConfigView>("/api/efatura/certificate", {
        method: "POST",
        body: JSON.stringify({ file: await readCertificate(certFile as File), password: certPassword }),
      }),
    onSuccess: (v) => { setCertFile(null); setCertPassword(""); onDone(v, "Certificado guardado."); },
    onError: onFail,
  });

  const removeCert = useMutation({
    mutationFn: () => api<EFaturaConfigView>("/api/efatura/certificate", { method: "DELETE" }),
    onSuccess: (v) => onDone(v, "Certificado removido."),
    onError: onFail,
  });

  const head = (
    <div className="px-6 py-5 border-b border-dim-100 flex items-center gap-3">
      <div className="w-9 h-9 bg-sky-50 rounded-[10px] flex items-center justify-center shrink-0">
        <Receipt className="text-sky-600" style={{ width: 18, height: 18 }} />
      </div>
      <div className="flex-1">
        <p className="text-[14px] font-semibold text-dim-900">E-Fatura CV</p>
        <p className="text-[11px] text-dim-400">
          {view?.provider === "techplace" ? "Comunicação eletrónica de faturas à DNRE — através do Techplace" : "Comunicação eletrónica de faturas à DNRE — ligação direta à Plataforma Eletrónica"}
        </p>
      </div>
      {view && (
        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${view.ready ? "bg-emerald-50 text-emerald-700" : view.enabled ? "bg-amber-50 text-amber-700" : "bg-dim-100 text-dim-500"}`}>
          {view.ready ? "Ativa" : view.enabled ? "Incompleta" : "Desativada"}
        </span>
      )}
    </div>
  );

  if (error) {
    return <div className={`${CARD} mt-6`}>{head}<p className="px-6 py-5 text-[12px] text-dim-500">{(error as Error).message === "Forbidden resource" ? "Apenas administradores podem configurar a e-Fatura." : (error as Error).message}</p></div>;
  }
  if (!view || !form) return <div className={`${CARD} mt-6`}>{head}<p className="px-6 py-5 text-[12px] text-dim-400">A carregar…</p></div>;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const certExpired = view.certificateNotAfter ? new Date(view.certificateNotAfter) <= new Date() : false;
  const tp = view.provider === "techplace";
  const lists: [string, TpRow[]][] =
    lookups && !("error" in lookups)
      ? [["Tipos de documento", lookups.tipos], ["Métodos de pagamento", lookups.metodos], ["Condições de pagamento", lookups.condicoes]]
      : [];

  return (
    <div className={`${CARD} mt-6`}>
      {head}
      <div className="px-6 py-5 flex flex-col gap-5">
        {view.missing.length > 0 && (
          <div className="flex gap-2.5 px-3.5 py-3 rounded-[10px] border bg-amber-50 border-amber-200">
            <AlertCircle className="text-amber-600 shrink-0 mt-0.5" style={{ width: 14, height: 14 }} />
            <div className="text-[12px] text-amber-800">
              <p className="font-semibold">Falta configurar para poder comunicar faturas:</p>
              <ul className="list-disc ml-4 mt-1">{view.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-dim-800">Ativar integração</p>
            <p className="text-[11px] text-dim-400">Comunica à DNRE cada fatura emitida a partir da data de arranque</p>
          </div>
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} />
        </div>

        {tp && (
          <>
            <Section title="Arranque" hint="Faturas anteriores a esta data nunca são comunicadas.">
              <Field label="Data de arranque">
                <input type="datetime-local" className={inputCls}
                  value={form.goLiveAt ? new Date(form.goLiveAt).toISOString().slice(0, 16) : ""}
                  onChange={(e) => set("goLiveAt", e.target.value ? new Date(e.target.value).toISOString() : null)} />
              </Field>
            </Section>

            <Section title="Ligação ao Techplace" hint="Dados fornecidos pelo Techplace. A chave e a palavra-passe nunca voltam a ser mostradas.">
              <Field label="Chave de API">
                <input type="password" autoComplete="off" className={inputCls} value={tpApiKey}
                  placeholder={view.hasTechplaceApiKey ? "•••••••• (guardada — preencha para substituir)" : ""}
                  onChange={(e) => setTpApiKey(e.target.value)} />
              </Field>
              <Field label="Utilizador (início de sessão, se pedido)">
                <input className={inputCls} autoComplete="off" value={form.techplaceUsername ?? ""} onChange={(e) => set("techplaceUsername", txt(e.target.value))} />
              </Field>
              <Field label="Palavra-passe">
                <input type="password" autoComplete="off" className={inputCls} value={tpPassword}
                  placeholder={view.hasTechplacePassword ? "•••••••• (guardada — preencha para substituir)" : ""}
                  onChange={(e) => setTpPassword(e.target.value)} />
              </Field>
              <Field label="ID da entidade">
                <input className={`${inputCls} font-mono`} value={form.techplaceEntityId ?? ""} onChange={(e) => set("techplaceEntityId", txt(e.target.value))} />
              </Field>
              <Field label="ID do utilizador que emite">
                <input className={`${inputCls} font-mono`} value={form.techplaceUserId ?? ""} onChange={(e) => set("techplaceUserId", txt(e.target.value))} />
              </Field>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="button" onClick={() => testTechplace.mutate()} disabled={testTechplace.isPending}
                  className="inline-flex items-center gap-2 border border-brand-600 text-brand-700 hover:bg-brand-50 font-semibold px-4 py-2 rounded-[10px] text-[12px] disabled:opacity-60">
                  <Link2 style={{ width: 13, height: 13 }} />{testTechplace.isPending ? "A testar…" : "Testar ligação"}
                </button>
                <p className="text-[10px] text-dim-400">Guarde a configuração antes de testar. Lista os códigos a copiar para os campos abaixo.</p>
              </div>
              {lists.length > 0 && (
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-[10px] border border-dim-100 bg-dim-50 p-3.5">
                  {lists.map(([title, rows]) => (
                    <div key={title}>
                      <p className="text-[11px] font-semibold text-dim-700 mb-1.5">{title}</p>
                      <ul className="flex flex-col gap-1 max-h-40 overflow-auto">
                        {rows.map((r) => (
                          <li key={r.id} className="text-[11px] text-dim-600"><span className="font-mono text-dim-900 select-all break-all">{r.id}</span>{r.name ? ` — ${r.name}` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Documentos" hint="Só faturas pagas na totalidade são comunicadas; as restantes ficam pendentes até o Techplace as suportar.">
              <Field label="Tipo: Fatura-Recibo">
                <input className={`${inputCls} font-mono`} value={form.techplaceTypeFR ?? ""} onChange={(e) => set("techplaceTypeFR", txt(e.target.value))} />
              </Field>
              <Field label="Tipo: Talão de Venda">
                <input className={`${inputCls} font-mono`} value={form.techplaceTypeTV ?? ""} onChange={(e) => set("techplaceTypeTV", txt(e.target.value))} />
              </Field>
              <Field label="Condição de pagamento">
                <input className={`${inputCls} font-mono`} value={form.techplaceConditionId ?? ""} onChange={(e) => set("techplaceConditionId", txt(e.target.value))} />
              </Field>
            </Section>

            <Section title="Métodos de pagamento" hint="ID do método no Techplace para cada forma de pagamento da CAP.">
              {METHODS.map((m) => (
                <Field key={m.k} label={m.label}>
                  <input className={`${inputCls} font-mono`} value={form.techplaceMethods[m.k] ?? ""}
                    onChange={(e) => {
                      const next = { ...form.techplaceMethods };
                      const v = e.target.value.trim();
                      if (v) next[m.k] = v;
                      else delete next[m.k];
                      set("techplaceMethods", next);
                    }} />
                </Field>
              ))}
            </Section>

            <Section title="Produtos" hint="Cada serviço é registado no Techplace na primeira fatura em que aparece. IDs fornecidos pelo Techplace.">
              <Field label="IVA dos produtos">
                <input className={`${inputCls} font-mono`} value={form.techplaceIvaId ?? ""} onChange={(e) => set("techplaceIvaId", txt(e.target.value))} />
              </Field>
              <Field label="Unidade dos produtos">
                <input className={`${inputCls} font-mono`} value={form.techplaceUnitId ?? ""} onChange={(e) => set("techplaceUnitId", txt(e.target.value))} />
              </Field>
              <Field label="Produto genérico (linhas sem serviço)">
                <input className={`${inputCls} font-mono`} value={form.techplaceProductId ?? ""} onChange={(e) => set("techplaceProductId", txt(e.target.value))} />
              </Field>
            </Section>
          </>
        )}

        {!tp && (
          <>
        <Section title="Ambiente" hint="Comece em Homologação. Só passe a Produção depois de a DNRE validar os testes.">
          <Field label="Repositório">
            <select className={inputCls} value={form.repositoryCode} onChange={(e) => set("repositoryCode", Number(e.target.value) as 1 | 2 | 3)}>
              {REPOSITORIES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Data de arranque">
            <input type="datetime-local" className={inputCls}
              value={form.goLiveAt ? new Date(form.goLiveAt).toISOString().slice(0, 16) : ""}
              onChange={(e) => set("goLiveAt", e.target.value ? new Date(e.target.value).toISOString() : null)} />
            <p className="text-[10px] text-dim-400 mt-1">Faturas anteriores nunca são comunicadas.</p>
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-dim-800">Marcar documentos como amostra</p>
              <p className="text-[11px] text-dim-400">A DNRE apaga as amostras ao fim de 24 horas — permite um teste real em Produção</p>
            </div>
            <Toggle checked={form.isSpecimen} onChange={(v) => set("isSpecimen", v)} />
          </div>
        </Section>

        <Section title="Emissor" hint={`Nome e NIF vêm de Configurações → Clínica: ${view.clinicName ?? "—"} · ${view.clinicNif ?? "—"}`}>
          <Field label="Código do LED">
            <input className={`${inputCls} font-mono`} inputMode="numeric" value={form.ledCode ?? ""} onChange={(e) => set("ledCode", num(e.target.value))} />
          </Field>
          <Field label="Série">
            <input className={`${inputCls} font-mono`} value={form.serie ?? ""} onChange={(e) => set("serie", txt(e.target.value))} />
          </Field>
          <Field label="Morada">
            <input className={inputCls} value={form.emitterAddressDetail ?? ""} onChange={(e) => set("emitterAddressDetail", txt(e.target.value))} />
          </Field>
          <Field label="Código de endereço (CV + 18 dígitos)">
            <input className={`${inputCls} font-mono`} placeholder="CV774741741037410321" value={form.emitterAddressCode ?? ""} onChange={(e) => set("emitterAddressCode", txt(e.target.value))} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={form.emitterEmail ?? ""} onChange={(e) => set("emitterEmail", txt(e.target.value))} />
          </Field>
          <Field label="Telefone (apenas dígitos)">
            <input className={`${inputCls} font-mono`} inputMode="numeric" value={form.emitterPhone ?? ""} onChange={(e) => set("emitterPhone", txt(e.target.value))} />
          </Field>
        </Section>

        <Section title="Software" hint="Tal como registado em Proprietário de Software na Plataforma Eletrónica.">
          <Field label="Código do software">
            <input className={`${inputCls} font-mono`} value={form.softwareCode ?? ""} onChange={(e) => set("softwareCode", txt(e.target.value.toUpperCase()))} />
          </Field>
          <Field label="NIF do transmissor">
            <input className={`${inputCls} font-mono`} inputMode="numeric" value={form.transmitterTaxId ?? ""} onChange={(e) => set("transmitterTaxId", txt(e.target.value))} />
          </Field>
          <Field label="Nome do software">
            <input className={inputCls} value={form.softwareName ?? ""} onChange={(e) => set("softwareName", txt(e.target.value))} />
          </Field>
          <Field label="Versão">
            <input className={`${inputCls} font-mono`} value={form.softwareVersion ?? ""} onChange={(e) => set("softwareVersion", txt(e.target.value))} />
          </Field>
        </Section>

        <Section title="IVA" hint="Os preços da CAP são tratados como já com IVA incluído. Confirme o tratamento com o contabilista.">
          <Field label="Tratamento">
            <select className={inputCls} value={form.taxTypeCode ?? ""} onChange={(e) => set("taxTypeCode", (e.target.value || null) as "NA" | "IVA" | null)}>
              <option value="">— escolher —</option>
              <option value="NA">Isento / não liquidado</option>
              <option value="IVA">IVA liquidado</option>
            </select>
          </Field>
          {form.taxTypeCode === "IVA" && (
            <Field label="Taxa de IVA (%)">
              <input className={`${inputCls} font-mono`} inputMode="decimal" value={form.taxPercentage ?? ""} onChange={(e) => set("taxPercentage", num(e.target.value))} />
            </Field>
          )}
          {form.taxTypeCode === "NA" && (
            <Field label="Motivo de não liquidação (1–21)">
              <input className={`${inputCls} font-mono`} inputMode="numeric" value={form.taxExemptionReasonCode ?? ""} onChange={(e) => set("taxExemptionReasonCode", num(e.target.value))} />
              <p className="text-[10px] text-dim-400 mt-1">Código da lista oficial “Motivos de Não Liquidação” (efatura.cv).</p>
            </Field>
          )}
          <Field label="Motivo das notas de crédito">
            <select className={inputCls} value={form.creditNoteReasonCode} onChange={(e) => set("creditNoteReasonCode", e.target.value as Form["creditNoteReasonCode"])}>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Ligação à Plataforma Eletrónica" hint="Credenciais do transmissor (Proprietário de Software). O Client Secret nunca volta a ser mostrado.">
          <Field label="Client ID">
            <input className={`${inputCls} font-mono`} value={form.oauthClientId ?? ""} onChange={(e) => set("oauthClientId", txt(e.target.value))} />
          </Field>
          <Field label="Client Secret">
            <input type="password" autoComplete="off" className={inputCls} value={clientSecret}
              placeholder={view.hasClientSecret ? "•••••••• (guardado — preencha para substituir)" : ""}
              onChange={(e) => setClientSecret(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Redirect URI (igual ao registado na Plataforma)">
              <input type="url" className={`${inputCls} font-mono`} placeholder={`${origin}/api/efatura/oauth/callback`}
                value={form.oauthRedirectUri ?? ""} onChange={(e) => set("oauthRedirectUri", txt(e.target.value))} />
            </Field>
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            {view.connected ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 font-semibold"><CheckCircle2 style={{ width: 14, height: 14 }} />Ligação autorizada{view.connectedAt ? ` em ${new Date(view.connectedAt).toLocaleDateString("pt-CV")}` : ""}</span>
                <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="text-[12px] font-semibold text-dim-500 hover:text-red-600 underline underline-offset-2">Terminar ligação</button>
              </>
            ) : (
              <button type="button" onClick={() => authorize.mutate()} disabled={authorize.isPending}
                className="inline-flex items-center gap-2 border border-brand-600 text-brand-700 hover:bg-brand-50 font-semibold px-4 py-2 rounded-[10px] text-[12px] disabled:opacity-60">
                <Link2 style={{ width: 13, height: 13 }} />Autorizar ligação
              </button>
            )}
            <p className="text-[10px] text-dim-400">Guarde a configuração antes de autorizar.</p>
          </div>
        </Section>

        <Section title="Certificado digital de assinatura" hint="Certificado ICP-CV do emissor (.p12 / .pfx, ou PEM com chave e certificado). Guardado cifrado e nunca devolvido.">
          {view.hasCertificate && (
            <div className={`sm:col-span-2 flex items-center justify-between px-3.5 py-2.5 rounded-[10px] border ${certExpired ? "bg-red-50 border-red-200" : "bg-dim-50 border-dim-100"}`}>
              <p className="text-[12px] text-dim-700 flex items-center gap-2">
                <ShieldCheck style={{ width: 14, height: 14 }} className={certExpired ? "text-red-600" : "text-emerald-600"} />
                <span><strong>{view.certificateSubject}</strong>{view.certificateNotAfter ? ` · ${certExpired ? "expirou" : "válido até"} ${new Date(view.certificateNotAfter).toLocaleDateString("pt-CV")}` : ""}</span>
              </p>
              <button type="button" onClick={() => removeCert.mutate()} className="text-[11px] font-semibold text-dim-500 hover:text-red-600 underline underline-offset-2">Remover</button>
            </div>
          )}
          <Field label="Ficheiro">
            <input type="file" accept=".p12,.pfx,.pem,.crt" className={`${inputCls} file:mr-3 file:border-0 file:bg-dim-100 file:rounded-md file:px-2 file:py-1 file:text-[11px]`}
              onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Palavra-passe do certificado">
            <input type="password" autoComplete="off" className={inputCls} value={certPassword} onChange={(e) => setCertPassword(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <button type="button" onClick={() => uploadCert.mutate()} disabled={!certFile || uploadCert.isPending}
              className="inline-flex items-center gap-2 border border-dim-300 hover:bg-dim-50 font-semibold px-4 py-2 rounded-[10px] text-[12px] disabled:opacity-50">
              <Upload style={{ width: 13, height: 13 }} />{uploadCert.isPending ? "A validar…" : view.hasCertificate ? "Substituir certificado" : "Carregar certificado"}
            </button>
          </div>
        </Section>
          </>
        )}
      </div>

      <div className="px-6 py-4 border-t border-dim-100">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="flex items-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]">
          {save.isPending ? "A guardar…" : "Guardar Alterações"}
        </button>
      </div>
    </div>
  );
}
