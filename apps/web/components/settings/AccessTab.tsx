"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, Plus, Check,
  LayoutDashboard, CalendarDays, UserRound, HeartPulse,
  FlaskConical, Receipt, ClipboardList, UserCog,
  Home, BarChart2, Settings2, SlidersHorizontal,
} from "lucide-react";
import { useMessage } from "../ui/message-handler";
import { Modal } from "../ui/modal";
import { CARD, inputCls, Field } from "./shared";

/* ── Gestão de Acesso ─────────────────────────────────────── */

const ACCESS_PAGES = [
  { key: "dashboard",    label: "Dashboard",            icon: LayoutDashboard   },
  { key: "appointments", label: "Agendamentos",          icon: CalendarDays      },
  { key: "patients",     label: "Pacientes CRM",         icon: UserRound         },
  { key: "health_plans", label: "Planos de Saúde",       icon: HeartPulse        },
  { key: "exams",        label: "Exames & Resultados",   icon: FlaskConical      },
  { key: "billing",      label: "Financeiro",            icon: Receipt           },
  { key: "records",      label: "Registos Clínicos",     icon: ClipboardList     },
  { key: "staff",        label: "Equipa & Turnos",       icon: UserCog           },
  { key: "visits",       label: "Visitas Domiciliárias", icon: Home              },
  { key: "analytics",    label: "Analytics",             icon: BarChart2         },
  { key: "settings",     label: "Configurações",         icon: Settings2         },
  { key: "params",       label: "Parametrizações",       icon: SlidersHorizontal },
] as const;

type PageKey = typeof ACCESS_PAGES[number]["key"];
type PagePerms = { view: boolean; create: boolean; edit: boolean; delete: boolean };
type RolePerms = Record<PageKey, PagePerms>;
type AccessControl = Record<string, RolePerms>;

const FULL_PAGE: PagePerms = { view: true, create: true, edit: true, delete: true };
const NO_PAGE:   PagePerms = { view: false, create: false, edit: false, delete: false };

function defaultPerms(codigo: string): RolePerms {
  const all  = Object.fromEntries(ACCESS_PAGES.map(p => [p.key, FULL_PAGE])) as RolePerms;
  const none = Object.fromEntries(ACCESS_PAGES.map(p => [p.key, NO_PAGE]))  as RolePerms;
  switch (codigo) {
    case "admin":        return all;
    case "doctor":       return Object.fromEntries(ACCESS_PAGES.map(p => [p.key, ["billing","staff","settings","params"].includes(p.key) ? NO_PAGE : FULL_PAGE])) as RolePerms;
    case "nurse":        return Object.fromEntries(ACCESS_PAGES.map(p => [p.key, ["health_plans","billing","staff","settings","params"].includes(p.key) ? NO_PAGE : FULL_PAGE])) as RolePerms;
    case "receptionist": return Object.fromEntries(ACCESS_PAGES.map(p => [p.key, ["exams","records","staff","visits","analytics","settings","params"].includes(p.key) ? NO_PAGE : FULL_PAGE])) as RolePerms;
    case "lab_tech":     return Object.fromEntries(ACCESS_PAGES.map(p => [p.key, ["appointments","health_plans","billing","records","staff","visits","analytics","settings","params"].includes(p.key) ? NO_PAGE : FULL_PAGE])) as RolePerms;
    default:             return none;
  }
}

function countEnabled(perms: RolePerms): number {
  return ACCESS_PAGES.filter(p => perms[p.key]?.view).length;
}

function AddPerfilModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { addMessage } = useMessage();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/parametrizacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "PROFILE_SETTINGS", valor: name.trim(), codigo: name.trim().toLowerCase().replace(/\s+/g, "_") }),
      });
      if (!res.ok) throw new Error();
      addMessage("Success", "Perfil criado com sucesso!");
      onCreated();
    } catch {
      addMessage("Error", "Erro ao criar perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Novo Perfil">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <Field label="Nome do Perfil">
          <input
            autoFocus
            className={inputCls}
            placeholder="Ex: Farmacêutico/a"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-dim-600 hover:text-dim-900 transition-colors">Cancelar</button>
          <button type="submit" disabled={saving || !name.trim()} className="px-4 py-2 text-[13px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 disabled:opacity-50 transition-colors">
            {saving ? "A criar…" : "Criar Perfil"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Permissions modal ────────────────────────────────────── */

const ACTION_LABELS: Record<keyof PagePerms, string> = {
  view: "Ver", create: "Criar", edit: "Editar", delete: "Eliminar",
};

function PermsModal({ perfil, perms, onSave, onClose }: {
  perfil: { valor: string; codigo: string };
  perms: RolePerms;
  onSave: (p: RolePerms) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RolePerms>(() => JSON.parse(JSON.stringify(perms)));

  function toggleAction(page: PageKey, action: keyof PagePerms) {
    setDraft(d => {
      const cur = { ...d[page] };
      if (action === "view" && cur.view) {
        // turning off view disables all
        cur.view = false; cur.create = false; cur.edit = false; cur.delete = false;
      } else if (action !== "view" && !cur.view) {
        // turning on any action requires view
        cur.view = true; cur[action] = true;
      } else {
        cur[action] = !cur[action];
      }
      return { ...d, [page]: cur };
    });
  }

  return (
    <Modal open onClose={onClose} title={`Permissões — ${perfil.valor}`}>
      <div className="flex flex-col" style={{ maxHeight: "70vh" }}>
        <div className="overflow-y-auto flex-1">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-dim-50">
              <tr>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 border-b border-dim-100">Página</th>
                {(Object.keys(ACTION_LABELS) as (keyof PagePerms)[]).map(a => (
                  <th key={a} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 border-b border-dim-100 text-center">{ACTION_LABELS[a]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACCESS_PAGES.map(page => {
                const Icon = page.icon;
                const pp = draft[page.key];
                return (
                  <tr key={page.key} className="hover:bg-dim-50/60 transition-colors group">
                    <td className="px-5 py-3 border-b border-dim-100">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 bg-dim-100 rounded-[6px] flex items-center justify-center shrink-0">
                          <Icon className="text-dim-500" style={{ width: 12, height: 12 }} />
                        </div>
                        <span className="text-[13px] font-medium text-dim-800">{page.label}</span>
                      </div>
                    </td>
                    {(Object.keys(ACTION_LABELS) as (keyof PagePerms)[]).map(action => {
                      const on = pp?.[action] ?? false;
                      return (
                        <td key={action} className="px-3 py-3 border-b border-dim-100 text-center">
                          <button
                            type="button"
                            onClick={() => toggleAction(page.key, action)}
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                              on
                                ? "bg-brand-700 text-white shadow-[0_1px_2px_rgba(0,0,0,.1)] hover:bg-brand-800"
                                : "bg-dim-100 text-dim-300 hover:bg-dim-200"
                            }`}
                          >
                            {on ? <Check style={{ width: 10, height: 10 }} /> : <span className="text-[10px] font-bold">—</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-dim-100 flex justify-end gap-2 bg-white">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-dim-600 hover:text-dim-900 transition-colors">Cancelar</button>
          <button type="button" onClick={() => onSave(draft)} className="px-4 py-2 text-[13px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 transition-colors">Guardar Permissões</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── AccessTab ────────────────────────────────────────────── */

export function AccessTab() {
  const { addMessage } = useMessage();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editingPerfil, setEditingPerfil] = useState<{ valor: string; codigo: string } | null>(null);
  const [accessControl, setAccessControl] = useState<AccessControl>({});
  const [saving, setSaving] = useState(false);

  const { data: perfis = [], isLoading } = useQuery<{ id: number; valor: string; codigo: string | null }[]>({
    queryKey: ["parametrizacao", "PROFILE_SETTINGS"],
    queryFn: () => fetch("/api/parametrizacao/PROFILE_SETTINGS").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: allSettings } = useQuery<Record<string, unknown>>({
    queryKey: ["settings-all"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!allSettings?.access_control) return;
    setAccessControl(allSettings.access_control as AccessControl);
  }, [allSettings]);

  function getPerms(codigo: string): RolePerms {
    return (accessControl[codigo] as RolePerms | undefined) ?? defaultPerms(codigo);
  }

  async function handleSavePerms(perfilCodigo: string, perms: RolePerms) {
    const next = { ...accessControl, [perfilCodigo]: perms };
    setSaving(true);
    try {
      const res = await fetch("/api/settings/access-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      setAccessControl(next);
      qc.invalidateQueries({ queryKey: ["settings-all"] });
      setEditingPerfil(null);
      addMessage("Success", "Permissões guardadas com sucesso!");
    } catch {
      addMessage("Error", "Erro ao guardar permissões.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
          <div>
            <h3 className="font-display text-[14px] font-semibold text-dim-900">Perfis de Acesso</h3>
            <p className="text-[11px] text-dim-400 mt-0.5">Define permissões por página e ação para cada perfil</p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 transition-colors"
          >
            <Plus style={{ width: 14, height: 14 }} />
            Adicionar Perfil
          </button>
        </div>

        {isLoading ? (
          <div className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar perfis…</div>
        ) : (
          <div className="divide-y divide-dim-100">
            {perfis.map(p => {
              const codigo = p.codigo ?? p.valor.toLowerCase().replace(/\s+/g, "_");
              const isAdmin = codigo === "admin";
              const perms = getPerms(codigo);
              const enabled = countEnabled(perms);

              return (
                <div key={p.id} className="px-5 py-4 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-dim-100 rounded-[8px] flex items-center justify-center shrink-0">
                      <ShieldCheck className="text-dim-500" style={{ width: 15, height: 15 }} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-dim-900">{p.valor}</p>
                      <p className="text-[11px] text-dim-400 mt-0.5">
                        {isAdmin ? "Acesso total a todas as páginas" : `${enabled} de ${ACCESS_PAGES.length} páginas com acesso`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isAdmin ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200/80">
                        <Check style={{ width: 10, height: 10 }} /> Acesso Total
                      </span>
                    ) : (
                      <button
                        onClick={() => setEditingPerfil({ valor: p.valor, codigo })}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-dim-200 text-dim-700 rounded-[8px] hover:border-brand-400 hover:text-brand-700 transition-colors"
                      >
                        <ShieldCheck style={{ width: 13, height: 13 }} />
                        Permissões
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {perfis.length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-dim-400">
                Nenhum perfil encontrado. Adicione um perfil para começar.
              </div>
            )}
          </div>
        )}
      </div>

      {addOpen && (
        <AddPerfilModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["parametrizacao", "PROFILE_SETTINGS"] });
          }}
        />
      )}

      {editingPerfil && (
        <PermsModal
          perfil={editingPerfil}
          perms={getPerms(editingPerfil.codigo)}
          onSave={(p) => handleSavePerms(editingPerfil.codigo, p)}
          onClose={() => setEditingPerfil(null)}
        />
      )}
    </div>
  );
}
