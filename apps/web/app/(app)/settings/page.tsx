"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Bell, Plug, Shield,
  AlertCircle, Clock, Phone, Mail, Globe,
  Key, Lock, Eye, EyeOff, ExternalLink, Receipt,
} from "lucide-react";
import { useMessage } from "../../../components/ui/message-handler";
import { Modal } from "../../../components/ui/modal";
import { CARD, inputCls, Field } from "../../../components/settings/shared";

/* ── Types ───────────────────────────────────────────────── */

type Hour = { day: string; open: string; close: string; active: boolean };

type ClinicSettings = {
  name: string; nif: string; website: string; phone: string;
  email: string; address: string; country: string; hours: Hour[];
};

type NotifSettings = Record<string, boolean>;

/* ── Defaults (used when DB has no saved settings yet) ───── */

const DEFAULT_CLINIC: ClinicSettings = {
  name:    "CAP",
  address: "Palmarejo, Praia",
  country: "Cabo Verde",
  phone:   "+238 9743583",
  email:   "capjacobvicente@gmail.com",
  website: "www.cap.cv",
  nif:     "289959195",
  hours: [
    { day: "Segunda-feira", open: "08:00", close: "18:00", active: true  },
    { day: "Terça-feira",   open: "08:00", close: "18:00", active: true  },
    { day: "Quarta-feira",  open: "08:00", close: "18:00", active: true  },
    { day: "Quinta-feira",  open: "08:00", close: "18:00", active: true  },
    { day: "Sexta-feira",   open: "08:00", close: "17:00", active: true  },
    { day: "Sábado",        open: "09:00", close: "13:00", active: true  },
    { day: "Domingo",       open: "",      close: "",       active: false },
  ],
};

const NOTIF_DEFS = [
  { id: "wa_reminder",   group: "WhatsApp",      label: "Lembrete de consulta (24h antes)",   desc: "Enviado automaticamente ao paciente",             defaultOn: true  },
  { id: "wa_confirm",    group: "WhatsApp",      label: "Confirmação de marcação",             desc: "Quando o agendamento é criado",                   defaultOn: true  },
  { id: "wa_cancel",     group: "WhatsApp",      label: "Notificação de cancelamento",         desc: "Quando a consulta é cancelada ou reagendada",     defaultOn: true  },
  { id: "wa_result",     group: "WhatsApp",      label: "Resultado de exame disponível",       desc: "Quando os resultados são carregados no sistema",  defaultOn: false },
  { id: "email_daily",   group: "Email Interno", label: "Resumo diário da agenda",             desc: "Enviado à equipa às 07h30",                       defaultOn: true  },
  { id: "email_overdue", group: "Email Interno", label: "Faturas vencidas",                   desc: "Relatório semanal de faturas em atraso",          defaultOn: true  },
  { id: "email_new_pt",  group: "Email Interno", label: "Novo paciente registado",             desc: "Notificação para a direcção",                     defaultOn: false },
];

/* ── UI primitives ───────────────────────────────────────── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="w-9 h-5 bg-dim-200 rounded-full peer peer-checked:bg-brand-700 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
    </label>
  );
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]"
    >
      {saving ? "A guardar…" : "Guardar Alterações"}
    </button>
  );
}

/* ── Clinic Tab ──────────────────────────────────────────── */

function ClinicTab({ initial }: { initial: ClinicSettings }) {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClinicSettings>(initial);

  useEffect(() => { setForm(initial); }, [JSON.stringify(initial)]); // eslint-disable-line

  function setField(k: keyof Omit<ClinicSettings, "hours">, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }
  function setHour(i: number, patch: Partial<Hour>) {
    setForm(f => ({ ...f, hours: f.hours.map((h, idx) => idx === i ? { ...h, ...patch } : h) }));
  }

  const mutation = useMutation({
    mutationFn: () => fetch("/api/settings/clinic", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar"); } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      addMessage("Success", "Configurações da clínica guardadas com sucesso!");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Informação da Clínica</h3>
        </div>
        <div className="px-5 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Nome da Clínica">
              <input className={inputCls} value={form.name} onChange={e => setField("name", e.target.value)} />
            </Field>
          </div>
          <Field label="NIF">
            <input className={`${inputCls} font-mono`} value={form.nif} onChange={e => setField("nif", e.target.value)} />
          </Field>
          <Field label="Website">
            <input className={inputCls} value={form.website} onChange={e => setField("website", e.target.value)} />
          </Field>
          <Field label="Telefone Principal">
            <input className={`${inputCls} font-mono`} value={form.phone} onChange={e => setField("phone", e.target.value)} />
          </Field>
          <Field label="Email Geral">
            <input type="email" className={inputCls} value={form.email} onChange={e => setField("email", e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Endereço">
              <input className={inputCls} value={form.address} onChange={e => setField("address", e.target.value)} />
            </Field>
          </div>
          <Field label="País / Região">
            <select className={inputCls} value={form.country} onChange={e => setField("country", e.target.value)}>
              <option>Cabo Verde</option>
              <option>Portugal</option>
            </select>
          </Field>
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Horário de Funcionamento</h3>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          {form.hours.map((h, i) => (
            <div key={h.day} className="flex items-center gap-4 py-2 border-b border-dim-50 last:border-0">
              <div className="w-36 shrink-0">
                <span className={`text-[13px] font-medium ${h.active ? "text-dim-800" : "text-dim-400"}`}>{h.day}</span>
              </div>
              {h.active ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="time"
                    value={h.open}
                    onChange={e => setHour(i, { open: e.target.value })}
                    className="w-24 border border-dim-200 rounded-[8px] px-2.5 py-1.5 text-[12px] font-mono text-dim-700 focus:outline-none focus:border-brand-500 bg-white"
                  />
                  <span className="text-dim-300 text-[12px]">–</span>
                  <input
                    type="time"
                    value={h.close}
                    onChange={e => setHour(i, { close: e.target.value })}
                    className="w-24 border border-dim-200 rounded-[8px] px-2.5 py-1.5 text-[12px] font-mono text-dim-700 focus:outline-none focus:border-brand-500 bg-white"
                  />
                </div>
              ) : (
                <span className="flex-1 text-[12px] text-dim-400 italic">Encerrado</span>
              )}
              <Toggle checked={h.active} onChange={v => setHour(i, { active: v, open: v ? "08:00" : "", close: v ? "17:00" : "" })} />
            </div>
          ))}
        </div>
      </div>

      <SaveButton saving={mutation.isPending} onClick={() => mutation.mutate()} />
    </div>
  );
}

/* ── Notifications Tab ───────────────────────────────────── */

function NotificationsTab({ initial }: { initial: NotifSettings }) {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [state, setState] = useState<NotifSettings>(() =>
    Object.fromEntries(NOTIF_DEFS.map(n => [n.id, initial[n.id] ?? n.defaultOn]))
  );

  useEffect(() => {
    setState(Object.fromEntries(NOTIF_DEFS.map(n => [n.id, initial[n.id] ?? n.defaultOn])));
  }, [JSON.stringify(initial)]); // eslint-disable-line

  const groups = [...new Set(NOTIF_DEFS.map(n => n.group))];

  const mutation = useMutation({
    mutationFn: () => fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro"); } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      addMessage("Success", "Preferências de notificação guardadas!");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className="flex flex-col gap-4">
      {groups.map(group => (
        <div key={group} className={CARD}>
          <div className="px-5 py-4 border-b border-dim-100">
            <h3 className="font-display text-[14px] font-semibold text-dim-900">{group}</h3>
          </div>
          <div className="divide-y divide-dim-100">
            {NOTIF_DEFS.filter(n => n.group === group).map(n => (
              <div key={n.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium text-dim-900">{n.label}</p>
                  <p className="text-[11px] text-dim-400 mt-0.5">{n.desc}</p>
                </div>
                <Toggle checked={state[n.id] ?? n.defaultOn} onChange={v => setState(s => ({ ...s, [n.id]: v }))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <SaveButton saving={mutation.isPending} onClick={() => mutation.mutate()} />
    </div>
  );
}

/* ── Integrations Tab ────────────────────────────────────── */

type IntgStatus = "connected" | "pending" | "disconnected";
type FieldDef = { key: string; label: string; placeholder: string; type?: string; hint?: string };

const INTEGRATIONS_DEF = [
  {
    key: "whatsapp",
    name: "WhatsApp Business",
    desc: "Mensagens automáticas aos pacientes",
    icon: Phone, color: "text-emerald-600", bg: "bg-emerald-50",
    defaultStatus: "connected" as IntgStatus,
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID",       placeholder: "123456789012345"                                      },
      { key: "accessToken",   label: "Access Token",          placeholder: "EAAxxxxx…",             type: "password"               },
      { key: "webhookToken",  label: "Webhook Verify Token",  placeholder: "token_secreto",         type: "password"               },
      { key: "webhookUrl",    label: "Webhook URL (receber)", placeholder: "https://api.cap.cv/v1/whatsapp/webhook", hint: "Configure este URL no Meta Business Manager" },
    ] as FieldDef[],
  },
  {
    key: "cloudflare_r2",
    name: "Cloudflare R2",
    desc: "Armazenamento de exames e documentos",
    icon: Globe, color: "text-amber-600", bg: "bg-amber-50",
    defaultStatus: "connected" as IntgStatus,
    fields: [
      { key: "accountId",    label: "Account ID",       placeholder: "abc123def456"              },
      { key: "accessKeyId",  label: "Access Key ID",    placeholder: "R2_ACCESS_KEY"             },
      { key: "secretKey",    label: "Secret Access Key",placeholder: "••••••••", type: "password" },
      { key: "bucketName",   label: "Bucket",           placeholder: "cms-exames"                },
      { key: "publicUrl",    label: "URL Pública",      placeholder: "https://r2.cap.cv"   },
    ] as FieldDef[],
  },
  {
    key: "email_smtp",
    name: "Email (SMTP)",
    desc: "Notificações por email",
    icon: Mail, color: "text-violet-600", bg: "bg-violet-50",
    defaultStatus: "connected" as IntgStatus,
    fields: [
      { key: "host",     label: "Host SMTP",      placeholder: "smtp.mailgun.org"          },
      { key: "port",     label: "Porta",          placeholder: "587"                        },
      { key: "username", label: "Utilizador",     placeholder: "noreply@cap.cv"      },
      { key: "password", label: "Palavra-passe",  placeholder: "••••••••", type: "password" },
      { key: "fromName", label: "Nome do remetente", placeholder: "CAP"     },
    ] as FieldDef[],
  },
  {
    key: "cvlab",
    name: "Laboratório CVLab",
    desc: "Integração de resultados de exames",
    icon: Plug, color: "text-dim-400", bg: "bg-dim-100",
    defaultStatus: "disconnected" as IntgStatus,
    fields: [
      { key: "apiUrl", label: "API URL",  placeholder: "https://api.cvlab.cv/v1"        },
      { key: "apiKey", label: "API Key",  placeholder: "cvlab_••••••••", type: "password" },
    ] as FieldDef[],
  },
  {
    key: "portal_saude",
    name: "Portal de Saúde CV",
    desc: "Comunicação com o SNS nacional",
    icon: Globe, color: "text-amber-600", bg: "bg-amber-50",
    defaultStatus: "pending" as IntgStatus,
    fields: [
      { key: "apiUrl",      label: "API URL",     placeholder: "https://portal.saude.gov.cv/api" },
      { key: "apiKey",      label: "API Key",     placeholder: "••••••••", type: "password"       },
      { key: "entityCode",  label: "Código Entidade", placeholder: "CV-CLINIC-0001"              },
    ] as FieldDef[],
  },
] as const;

type IntgKey = typeof INTEGRATIONS_DEF[number]["key"];

const LS_INTG_STATUS = "cms:intg-status";
const LS_INTG_CONFIG = "cms:intg-config";

function loadIntgStatus(): Record<IntgKey, IntgStatus> {
  try { const r = localStorage.getItem(LS_INTG_STATUS); if (r) return JSON.parse(r); } catch {}
  return Object.fromEntries(INTEGRATIONS_DEF.map(i => [i.key, i.defaultStatus])) as Record<IntgKey, IntgStatus>;
}
function loadIntgConfig(): Record<string, Record<string, string>> {
  try { const r = localStorage.getItem(LS_INTG_CONFIG); if (r) return JSON.parse(r); } catch {}
  return {};
}

function EFaturaSection() {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [vals, setVals] = useState({
    enabled: false, sandbox: true,
    apiKey: "", endpoint: "",
  });

  const { data: allSettings } = useQuery<Record<string, Record<string, string>>>({
    queryKey: ["settings-all"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });

  // nif/nome are no longer stored here — Configurações → Clínica is the single source
  const clinic = allSettings?.["clinic"] as unknown as { name?: string; nif?: string } | undefined;
  const clinicReady = !!clinic?.name && !!clinic?.nif;

  useEffect(() => {
    const saved = allSettings?.["integration_efatura"];
    if (!saved || !Object.keys(saved).length) return;
    setVals({
      enabled: saved.enabled === "true",
      sandbox: saved.sandbox !== "false",
      apiKey: saved.apiKey ?? "",
      endpoint: saved.endpoint ?? "",
    });
  }, [allSettings]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/integration/efatura", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: vals.enabled ? "true" : "false",
          sandbox: vals.sandbox ? "true" : "false",
          apiKey: vals.apiKey,
          endpoint: vals.endpoint,
        }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      addMessage("Success", "Configuração E-Fatura guardada.");
    } catch {
      addMessage("Error", "Erro ao guardar configuração E-Fatura.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${CARD} mt-6`}>
      <div className="px-6 py-5 border-b border-dim-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-sky-50 rounded-[10px] flex items-center justify-center shrink-0">
          <Receipt className="text-sky-600" style={{ width: 18, height: 18 }} />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-dim-900">E-Fatura CV</p>
          <p className="text-[11px] text-dim-400">Submissão eletrónica de faturas — AT Cabo Verde</p>
        </div>
      </div>

      <div className="px-6 py-5 flex flex-col gap-4">
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-[13px] font-semibold text-dim-800">Ativar integração</p>
            <p className="text-[11px] text-dim-400">Submete automaticamente cada fatura emitida</p>
          </div>
          <Toggle checked={vals.enabled} onChange={v => setVals(p => ({ ...p, enabled: v }))} />
        </div>
        <div className="flex items-center justify-between py-1 border-t border-dim-100">
          <div>
            <p className="text-[13px] font-semibold text-dim-800">Modo sandbox</p>
            <p className="text-[11px] text-dim-400">Usar ambiente de testes (sandbox.mw.efatura.cv)</p>
          </div>
          <Toggle checked={vals.sandbox} onChange={v => setVals(p => ({ ...p, sandbox: v }))} />
        </div>

        <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] border ${clinicReady ? "bg-dim-50 border-dim-100" : "bg-amber-50 border-amber-200"}`}>
          {clinicReady ? (
            <p className="text-[12px] text-dim-600">
              NIF e nome usados na fatura: <strong className="text-dim-800">{clinic!.name}</strong> · <span className="font-mono">{clinic!.nif}</span>
              <span className="text-dim-400"> — definidos em </span>
              <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('[data-settings-tab="clinic"]')?.click()} className="text-brand-600 hover:text-brand-800 font-semibold underline underline-offset-2">Clínica</button>
            </p>
          ) : (
            <p className="text-[12px] text-amber-700">
              NIF e nome da clínica ainda não estão configurados — vá a{" "}
              <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('[data-settings-tab="clinic"]')?.click()} className="font-semibold underline underline-offset-2">Clínica → Informação da Clínica</button>{" "}
              antes de ativar a integração.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-1 border-t border-dim-100">
          <Field label="API Key">
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={vals.apiKey} placeholder="••••••••"
                onChange={e => setVals(p => ({ ...p, apiKey: e.target.value }))}
                className={`${inputCls} pr-9`} autoComplete="off" />
              <button type="button" onClick={() => setShowKey(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dim-400 hover:text-dim-700 transition-colors">
                {showKey ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
              </button>
            </div>
          </Field>
          <Field label="Endpoint produção">
            <input type="url" value={vals.endpoint} placeholder="https://mw.efatura.cv"
              onChange={e => setVals(p => ({ ...p, endpoint: e.target.value }))}
              className={inputCls} />
            <p className="text-[10px] text-dim-400 mt-1 flex items-center gap-1">
              <ExternalLink style={{ width: 9, height: 9 }} />
              Deixe em branco para usar o sandbox em testes
            </p>
          </Field>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-dim-100">
        <SaveButton saving={saving} onClick={handleSave} />
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { addMessage } = useMessage();
  const [statuses, setStatuses] = useState<Record<IntgKey, IntgStatus>>(loadIntgStatus);
  const [config, setConfig] = useState<Record<string, Record<string, string>>>(loadIntgConfig);
  const [configuring, setConfiguring] = useState<IntgKey | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<IntgKey | null>(null);

  const activeIntg = INTEGRATIONS_DEF.find(i => i.key === configuring);

  // hydrate from backend on mount
  const { data: allSettings } = useQuery<Record<string, Record<string, string>>>({
    queryKey: ["settings-all"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!allSettings) return;
    const backendConfig: Record<string, Record<string, string>> = {};
    const backendStatuses: Record<string, IntgStatus> = { ...loadIntgStatus() };
    for (const intg of INTEGRATIONS_DEF) {
      const saved = allSettings[`integration_${intg.key}`] as Record<string, string> | undefined;
      if (saved && Object.keys(saved).length > 0) {
        backendConfig[intg.key] = saved;
        backendStatuses[intg.key] = "connected";
      }
    }
    if (Object.keys(backendConfig).length > 0) {
      setConfig(prev => ({ ...prev, ...backendConfig }));
      setStatuses(prev => ({ ...prev, ...(backendStatuses as Record<IntgKey, IntgStatus>) }));
    }
  }, [allSettings]);

  function saveStatuses(next: Record<IntgKey, IntgStatus>) {
    setStatuses(next);
    localStorage.setItem(LS_INTG_STATUS, JSON.stringify(next));
  }

  async function handleSaveConfig(key: IntgKey, values: Record<string, string>) {
    try {
      const res = await fetch(`/api/settings/integration/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error();
    } catch {
      addMessage("Error", "Erro ao guardar configuração no servidor.");
      return;
    }
    const nextConfig = { ...config, [key]: values };
    setConfig(nextConfig);
    localStorage.setItem(LS_INTG_CONFIG, JSON.stringify(nextConfig));
    const next = { ...statuses, [key]: "connected" as IntgStatus };
    saveStatuses(next);
    setConfiguring(null);
    addMessage("Success", "Integração configurada e ligada com sucesso!");
  }

  function handleDisconnect(key: IntgKey) {
    saveStatuses({ ...statuses, [key]: "disconnected" });
    setConfirmDisconnect(null);
    addMessage("Info", "Integração desligada.");
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {INTEGRATIONS_DEF.map(intg => {
          const Icon = intg.icon;
          const status = statuses[intg.key];
          const isConnected = status === "connected";
          const isPending   = status === "pending";
          const isConfirming = confirmDisconnect === intg.key;

          return (
            <div key={intg.key} className={CARD}>
              <div className="px-5 py-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 ${isConnected ? intg.bg : "bg-dim-100"} rounded-[10px] flex items-center justify-center transition-colors`}>
                    <Icon className={isConnected ? intg.color : "text-dim-400"} style={{ width: 18, height: 18 }} />
                  </div>
                  <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    isConnected ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80" :
                    isPending   ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"       :
                                  "bg-dim-100 text-dim-400"
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500" : isPending ? "bg-amber-400 animate-pulse" : "bg-dim-300"}`} />
                    {isConnected ? "Ligado" : isPending ? "Pendente" : "Desligado"}
                  </div>
                </div>

                <p className="text-[14px] font-semibold text-dim-900">{intg.name}</p>
                <p className="text-[11px] text-dim-400 mt-0.5">{intg.desc}</p>

                {isConfirming ? (
                  <div className="mt-4 flex items-center gap-2 p-2.5 bg-red-50 rounded-[8px] border border-red-100">
                    <p className="text-[11px] text-red-700 flex-1 font-medium">Confirmar desligamento?</p>
                    <button onClick={() => handleDisconnect(intg.key)} className="text-[11px] font-bold text-red-600 hover:text-red-800 transition-colors">Sim</button>
                    <button onClick={() => setConfirmDisconnect(null)} className="text-[11px] text-dim-500 hover:text-dim-700 transition-colors ml-1">Não</button>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => setConfiguring(intg.key)}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-[8px] border transition-colors ${
                        isConnected
                          ? "border-dim-200 text-dim-600 hover:border-brand-400 hover:text-brand-700"
                          : "border-brand-500 text-brand-700 bg-brand-50 hover:bg-brand-100"
                      }`}
                    >
                      {isConnected ? "Configurar" : "Ligar"}
                    </button>
                    {isConnected && (
                      <button
                        onClick={() => setConfirmDisconnect(intg.key)}
                        className="text-[11px] font-semibold text-dim-400 hover:text-red-500 transition-colors"
                      >
                        Desligar
                      </button>
                    )}
                    {isPending && (
                      <button
                        onClick={() => setConfiguring(intg.key)}
                        className="text-[11px] font-semibold text-amber-600 hover:text-amber-800 transition-colors"
                      >
                        Completar configuração
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {activeIntg && (
        <IntegrationConfigModal
          intg={activeIntg}
          initial={config[activeIntg.key] ?? {}}
          onSave={(vals) => handleSaveConfig(activeIntg.key, vals)}
          onClose={() => setConfiguring(null)}
        />
      )}

      <EFaturaSection />
    </>
  );
}

function IntegrationConfigModal({
  intg,
  initial,
  onSave,
  onClose,
}: {
  intg: typeof INTEGRATIONS_DEF[number];
  initial: Record<string, string>;
  onSave: (vals: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    () => Object.fromEntries(intg.fields.map(f => [f.key, initial[f.key] ?? ""]))
  );
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});

  return (
    <Modal open onClose={onClose} title={`Configurar — ${intg.name}`} description="Preencha as credenciais de ligação" size="md">
      <div className="px-6 py-5 flex flex-col gap-4">
        {intg.fields.map(f => {
          const isPassword = f.type === "password";
          const isToggle = f.type === "toggle";
          const revealed = showPw[f.key];
          return (
            <div key={f.key}>
              <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">{f.label}</label>
              {isToggle ? (
                <div className="flex items-center gap-3 py-1">
                  <Toggle
                    checked={vals[f.key] === "true"}
                    onChange={v => setVals(prev => ({ ...prev, [f.key]: v ? "true" : "false" }))}
                  />
                  <span className="text-[12px] text-dim-500">{vals[f.key] === "true" ? "Ativo" : "Inativo"}</span>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type={isPassword && !revealed ? "password" : f.type === "url" ? "url" : "text"}
                    value={vals[f.key] ?? ""}
                    onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className={`${inputCls} ${isPassword ? "pr-9" : ""}`}
                    autoComplete="off"
                  />
                  {isPassword && (
                    <button type="button" onClick={() => setShowPw(s => ({ ...s, [f.key]: !s[f.key] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-dim-400 hover:text-dim-700 transition-colors">
                      {revealed ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                    </button>
                  )}
                </div>
              )}
              {f.hint && <p className="text-[10px] text-dim-400 mt-1 flex items-center gap-1"><ExternalLink style={{ width: 9, height: 9 }} />{f.hint}</p>}
            </div>
          );
        })}
      </div>
      <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
        <button
          onClick={() => onSave(vals)}
          className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
        >
          Guardar e Ligar
        </button>
        <button onClick={onClose} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

/* ── Security Tab ─────────────────────────────────────────── */

function SecurityTab() {
  const [showPw, setShowPw] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { addMessage } = useMessage();

  const changePw = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/staff/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? "Não foi possível atualizar a palavra-passe.");
      }
    },
    onSuccess: () => {
      addMessage("Success", "Palavra-passe atualizada com sucesso.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  function submitPasswordChange() {
    if (!currentPassword || !newPassword) { addMessage("Error", "Preencha todos os campos."); return; }
    if (newPassword !== confirmPassword) { addMessage("Error", "As palavras-passe novas não coincidem."); return; }
    changePw.mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Alterar Palavra-passe</h3>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4 max-w-md">
          <Field label="Palavra-passe actual">
            <div className="relative">
              <input type={showPw ? "text" : "password"} className={inputCls} placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim-400 hover:text-dim-700 transition-colors">
                {showPw ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}
              </button>
            </div>
          </Field>
          <Field label="Nova palavra-passe">
            <input type="password" className={inputCls} placeholder="Mín. 10 caracteres, maiúscula e número" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirmar nova palavra-passe">
            <input type="password" className={inputCls} placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <button
            onClick={submitPasswordChange}
            disabled={changePw.isPending}
            className="flex items-center gap-2 w-fit bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
          >
            <Key className="w-3.5 h-3.5" />
            {changePw.isPending ? "A atualizar…" : "Actualizar Palavra-passe"}
          </button>
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Autenticação de Dois Factores</h3>
        </div>
        <div className="px-5 py-5 flex items-start justify-between gap-6">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-violet-50 rounded-[10px] flex items-center justify-center shrink-0">
              <Lock className="text-violet-600" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-dim-900">2FA via aplicação autenticadora</p>
              <p className="text-[11px] text-dim-400 mt-0.5">Proteja a sua conta com TOTP (Google Authenticator, Authy, etc.)</p>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-dim-400 font-medium">
                <AlertCircle style={{ width: 12, height: 12 }} />
                Em breve
              </div>
            </div>
          </div>
          <button
            disabled
            className="text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border border-dim-200 text-dim-400 cursor-not-allowed shrink-0"
          >
            Configurar 2FA
          </button>
        </div>
      </div>

      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100">
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Sessões Activas</h3>
          <p className="text-[11px] text-dim-400 mt-1">Gestão detalhada de sessões (por dispositivo) ainda não disponível — cada sessão expira automaticamente ao fim de 8h de inactividade.</p>
        </div>
        <div className="divide-y divide-dim-100">
          {[
            { device: "Esta sessão", location: "Praia, Cabo Verde", time: "Agora",       current: true  },
          ].map(s => (
            <div key={s.device} className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${s.current ? "bg-emerald-500" : "bg-dim-300"}`} />
                <div>
                  <p className="text-[13px] font-medium text-dim-900">{s.device}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-dim-400">
                    <Clock style={{ width: 9, height: 9 }} />
                    {s.time} · {s.location}
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Esta sessão</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */

// Utilizadores and Gestão de Acesso tabs were removed from here — all of that now lives at the
// dedicated /access page (Organização / Perfis / Utilizadores), one canonical place instead of
// three independently-duplicated implementations (this file had its own, so did AccessTab.tsx,
// so did AccessPageContent.tsx).
const TABS = [
  { key: "clinic",        label: "Clínica",         icon: Building2  },
  { key: "notifs",        label: "Notificações",     icon: Bell       },
  { key: "integrations",  label: "Integrações",      icon: Plug       },
  { key: "security",      label: "Segurança",        icon: Shield     },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("clinic");

  const { data: settings = {}, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: ["settings"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });

  const clinic = settings.clinic ? (settings.clinic as ClinicSettings) : DEFAULT_CLINIC;
  const notifs = settings.notifications ? (settings.notifications as NotifSettings) : {};

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900">Configurações</h1>
        <p className="text-[13px] text-dim-500 mt-0.5">Gestão da clínica, notificações, integrações e segurança</p>
      </div>

      <div className="flex gap-5 items-start">
        <nav className="w-48 shrink-0 flex flex-col gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                data-settings-tab={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 rounded-[10px] text-[13px] font-medium transition-colors cursor-pointer ${
                  active ? "bg-brand-700 text-white shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                         : "text-dim-600 hover:bg-dim-100 hover:text-dim-900"
                }`}
              >
                <Icon style={{ width: 15, height: 15 }} className={active ? "opacity-90" : "opacity-60"} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className={`${CARD} animate-pulse`}>
              <div className="px-5 py-5 flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 bg-dim-100 rounded-[10px]" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {activeTab === "clinic"        && <ClinicTab initial={clinic} />}
              {activeTab === "notifs"        && <NotificationsTab initial={notifs} />}
              {activeTab === "integrations"  && <IntegrationsTab />}
              {activeTab === "security"      && <SecurityTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
