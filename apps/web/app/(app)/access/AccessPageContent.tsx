"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, Plus, Check,
  LayoutDashboard, CalendarDays, UserRound, HeartPulse,
  FlaskConical, Receipt, ClipboardList, UserCog,
  Home, BarChart2, Settings2, SlidersHorizontal, Users,
} from "lucide-react";
import { useMessage } from "../../../components/ui/message-handler";
import { Modal } from "../../../components/ui/modal";
import { defaultPerms, type PageKey, type PagePerms, type RolePerms, type AccessControl } from "../../../lib/access-control";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans placeholder:text-dim-400";

const ACCESS_PAGES: { key: PageKey; label: string; icon: React.ElementType }[] = [
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
];

const ROLE_LABELS: Record<string, string> = {
  admin:        "Admin",
  doctor:       "Médico/a",
  nurse:        "Enfermeiro/a",
  receptionist: "Recepcionista",
  lab_tech:     "Técnico de Lab.",
};

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const ACTION_LABELS: Record<keyof PagePerms, string> = {
  view: "Ver", create: "Criar", edit: "Editar", delete: "Eliminar",
};

type Perfil = { id: number; valor: string; codigo: string | null };
type StaffMember = { id: string; fullName: string; email: string; role: string; jobTitle: string | null };

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
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Nome do Perfil</label>
          <input autoFocus className={inputCls} placeholder="Ex: Farmacêutico/a" value={name} onChange={e => setName(e.target.value)} />
        </div>
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

function PermsModal({ perfil, perms, onSave, onClose }: {
  perfil: { valor: string; codigo: string };
  perms: RolePerms;
  onSave: (p: RolePerms) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RolePerms>(() => JSON.parse(JSON.stringify(perms)));

  function toggleAction(page: PageKey, action: keyof PagePerms) {
    setDraft((d: RolePerms) => {
      const cur = { ...d[page] };
      if (action === "view" && cur.view) {
        cur.view = false; cur.create = false; cur.edit = false; cur.delete = false;
      } else if (action !== "view" && !cur.view) {
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
                  <th key={String(a)} className="px-3 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 border-b border-dim-100 text-center">{ACTION_LABELS[a]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACCESS_PAGES.map(page => {
                const Icon = page.icon;
                const pp = draft[page.key];
                return (
                  <tr key={page.key} className="hover:bg-dim-50/60 transition-colors">
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
                        <td key={String(action)} className="px-3 py-3 border-b border-dim-100 text-center">
                          <button
                            type="button"
                            onClick={() => toggleAction(page.key, action)}
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                              on ? "bg-brand-700 text-white hover:bg-brand-800" : "bg-dim-100 text-dim-300 hover:bg-dim-200"
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

function ChangeRoleModal({ staff, onClose, onSaved }: {
  staff: StaffMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addMessage } = useMessage();
  const [role, setRole] = useState(staff.role);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/staff/${staff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error();
      addMessage("Success", "Perfil do utilizador atualizado.");
      onSaved();
    } catch {
      addMessage("Error", "Erro ao atualizar perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Alterar Perfil — ${staff.fullName}`}>
      <div className="p-5 flex flex-col gap-4">
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Perfil / Função</label>
          <select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
            {ROLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-dim-600 hover:text-dim-900 transition-colors">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || role === staff.role} className="px-4 py-2 text-[13px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 disabled:opacity-50 transition-colors">
            {saving ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProfilesSection() {
  const { addMessage } = useMessage();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editingPerfil, setEditingPerfil] = useState<{ valor: string; codigo: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: perfis = [], isLoading } = useQuery<Perfil[]>({
    queryKey: ["parametrizacao", "PROFILE_SETTINGS"],
    queryFn: () => fetch("/api/parametrizacao/PROFILE_SETTINGS").then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: allSettings } = useQuery<Record<string, unknown>>({
    queryKey: ["settings-all"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });

  const accessControl = (allSettings?.access_control ?? {}) as AccessControl;

  function getPerms(codigo: string): RolePerms {
    return (accessControl[codigo] as RolePerms | undefined) ?? defaultPerms(codigo);
  }

  async function handleSavePerms(codigo: string, perms: RolePerms) {
    const next = { ...accessControl, [codigo]: perms };
    setSaving(true);
    try {
      const res = await fetch("/api/settings/access-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
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
            const isAdminProfile = codigo === "admin";
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
                      {isAdminProfile ? "Acesso total a todas as páginas" : `${enabled} de ${ACCESS_PAGES.length} páginas com acesso`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isAdminProfile ? (
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
            <div className="px-5 py-8 text-center text-[13px] text-dim-400">Nenhum perfil encontrado.</div>
          )}
        </div>
      )}

      {addOpen && (
        <AddPerfilModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["parametrizacao", "PROFILE_SETTINGS"] }); }}
        />
      )}
      {editingPerfil && (
        <PermsModal
          perfil={editingPerfil}
          perms={getPerms(editingPerfil.codigo)}
          onSave={p => handleSavePerms(editingPerfil.codigo, p)}
          onClose={() => setEditingPerfil(null)}
        />
      )}
    </div>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);

  const { data: staffList = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ["staff"],
    queryFn: () => fetch("/api/staff").then(r => r.json()),
    staleTime: 60_000,
  });

  const roleBadgeCls: Record<string, string> = {
    admin:        "bg-brand-50 text-brand-700 ring-brand-200/80",
    doctor:       "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
    nurse:        "bg-sky-50 text-sky-700 ring-sky-200/80",
    receptionist: "bg-violet-50 text-violet-700 ring-violet-200/80",
    lab_tech:     "bg-amber-50 text-amber-700 ring-amber-200/80",
  };

  return (
    <div className={CARD}>
      <div className="px-5 py-4 border-b border-dim-100">
        <h3 className="font-display text-[14px] font-semibold text-dim-900">Utilizadores e Perfis</h3>
        <p className="text-[11px] text-dim-400 mt-0.5">Atribui um perfil de acesso a cada membro da equipa</p>
      </div>

      {isLoading ? (
        <div className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar utilizadores…</div>
      ) : (
        <div className="divide-y divide-dim-100">
          {staffList.map(s => {
            const initials = s.fullName.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
            const badgeCls = roleBadgeCls[s.role] ?? "bg-dim-100 text-dim-500";
            return (
              <div key={s.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                    {initials}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-dim-900">{s.fullName}</p>
                    <p className="text-[11px] text-dim-400">{s.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${badgeCls}`}>
                    {ROLE_LABELS[s.role] ?? s.role}
                  </span>
                  <button
                    onClick={() => setEditingStaff(s)}
                    className="text-[11px] font-semibold px-3 py-1.5 border border-dim-200 text-dim-600 rounded-[8px] hover:border-brand-400 hover:text-brand-700 transition-colors"
                  >
                    Alterar Perfil
                  </button>
                </div>
              </div>
            );
          })}
          {staffList.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-dim-400">
              Sem utilizadores registados. Adicione colaboradores em <strong>Equipa &amp; Turnos</strong>.
            </div>
          )}
        </div>
      )}

      {editingStaff && (
        <ChangeRoleModal
          staff={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSaved={() => {
            setEditingStaff(null);
            qc.invalidateQueries({ queryKey: ["staff"] });
            qc.invalidateQueries({ queryKey: ["staff-me"] });
          }}
        />
      )}
    </div>
  );
}

export default function AccessPageContent() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900 flex items-center gap-2">
          <Users className="text-brand-600" style={{ width: 22, height: 22 }} />
          Gestão de Acesso
        </h1>
        <p className="text-[13px] text-dim-500 mt-0.5">Perfis de permissões e atribuição de acessos por utilizador</p>
      </div>
      <ProfilesSection />
      <UsersSection />
    </div>
  );
}
