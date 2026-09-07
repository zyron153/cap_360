"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, Plus, Check, Building2, Users,
  LayoutDashboard, CalendarDays, UserRound, HeartPulse,
  FlaskConical, Receipt, ClipboardList, UserCog,
  Home, BarChart2, Settings2, SlidersHorizontal,
} from "lucide-react";
import type { StaffInvitationEntry } from "@cap/types";
import { useMessage } from "../../../components/ui/message-handler";
import { Modal } from "../../../components/ui/modal";
import { defaultPerms, type PageKey, type PagePerms, type RolePerms, type AccessControl } from "../../../lib/access-control";
import { StaffForm, toApiBody, toFormValues, type ApiStaff, type ParamOption } from "../../../components/staff/StaffForm";

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
// Fixed set — per the decision to keep the 5 hardcoded StaffRole values rather than let admins
// create arbitrary custom profiles that could never actually be assigned to anyone (Staff.role is
// a Prisma enum, not free text). "Perfil" configures permissions for these 5, nothing else.
const ROLE_ORDER = ["admin", "doctor", "nurse", "receptionist", "lab_tech"];

const ACTION_LABELS: Record<keyof PagePerms, string> = {
  view: "Ver", create: "Criar", edit: "Editar", delete: "Eliminar",
};

function countEnabled(perms: RolePerms): number {
  return ACCESS_PAGES.filter(p => perms[p.key]?.view).length;
}

type Company = {
  id: string; name: string; taxId: string;
  email: string | null; phone: string | null; address: string | null; active: boolean;
};

/* ── Shared small pieces ─────────────────────────────────────────────────── */

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
        active ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose, pending }: {
  title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; pending?: boolean;
}) {
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="p-5 flex flex-col gap-4">
        <p className="text-[13px] text-dim-600">{message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-dim-600 hover:text-dim-900 transition-colors">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="px-4 py-2 text-[13px] font-semibold bg-red-600 text-white rounded-[10px] hover:bg-red-700 disabled:opacity-50 transition-colors">
            {pending ? "A processar…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Organização — Company entities ──────────────────────────────────────── */

function CompanyFormModal({ company, onClose, onSaved }: { company: Company | null; onClose: () => void; onSaved: () => void }) {
  const { addMessage } = useMessage();
  const [form, setForm] = useState({
    name: company?.name ?? "", taxId: company?.taxId ?? "",
    email: company?.email ?? "", phone: company?.phone ?? "", address: company?.address ?? "",
  });
  const mutation = useMutation({
    mutationFn: () => fetch(company ? `/api/companies/${company.id}` : "/api/companies", {
      method: company ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(), taxId: form.taxId.trim(),
        email: form.email.trim() || undefined, phone: form.phone.trim() || undefined, address: form.address.trim() || undefined,
      }),
    }).then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar empresa"); } }),
    onSuccess: () => { addMessage("Success", company ? "Empresa atualizada." : "Empresa criada."); onSaved(); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <Modal open onClose={onClose} title={company ? "Editar Empresa" : "Nova Empresa"}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="p-5 flex flex-col gap-4">
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Nome *</label>
          <input required className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Câmara Municipal da Praia" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">NIF *</label>
          <input required className={inputCls} value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Email</label>
            <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Telefone</label>
            <input className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">Morada</label>
          <input className={inputCls} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-dim-600 hover:text-dim-900 transition-colors">Cancelar</button>
          <button type="submit" disabled={mutation.isPending || !form.name.trim() || !form.taxId.trim()} className="px-4 py-2 text-[13px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 disabled:opacity-50 transition-colors">
            {mutation.isPending ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OrganicaSection() {
  const qc = useQueryClient();
  const { addMessage } = useMessage();
  const [addOpen, setAddOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deactivating, setDeactivating] = useState<Company | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: () => fetch("/api/companies?activeOnly=false").then((r) => r.json()),
    staleTime: 60_000,
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/companies/${id}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error("Erro ao desativar empresa"); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); addMessage("Success", "Empresa desativada."); setDeactivating(null); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/companies/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: true }),
    }).then((r) => { if (!r.ok) throw new Error("Erro ao reativar empresa"); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); addMessage("Success", "Empresa reativada."); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <div className={CARD}>
      <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
        <div>
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Organizações</h3>
          <p className="text-[11px] text-dim-400 mt-0.5">Empresas clientes (planos de saúde corporativos)</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 transition-colors">
          <Plus style={{ width: 14, height: 14 }} /> Nova Empresa
        </button>
      </div>

      {isLoading ? (
        <div className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar organizações…</div>
      ) : companies.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-dim-400">Nenhuma organização registada.</div>
      ) : (
        <div className="divide-y divide-dim-100">
          {companies.map((c) => (
            <div key={c.id} className="px-5 py-4 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${c.active ? "bg-dim-100" : "bg-dim-50"}`}>
                  <Building2 className={c.active ? "text-dim-500" : "text-dim-300"} style={{ width: 15, height: 15 }} />
                </div>
                <div>
                  <p className={`text-[13px] font-semibold ${c.active ? "text-dim-900" : "text-dim-400 line-through"}`}>{c.name}</p>
                  <p className="text-[11px] text-dim-400 mt-0.5">NIF: {c.taxId}{c.email ? ` · ${c.email}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!c.active && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-dim-100 text-dim-500">Inativa</span>}
                <button onClick={() => setEditingCompany(c)} className="px-3 py-1.5 text-[12px] font-semibold border border-dim-200 text-dim-700 rounded-[8px] hover:border-brand-400 hover:text-brand-700 transition-colors">
                  Editar
                </button>
                {c.active ? (
                  <button onClick={() => setDeactivating(c)} className="px-3 py-1.5 text-[12px] font-semibold border border-dim-200 text-dim-500 rounded-[8px] hover:border-red-300 hover:text-red-600 transition-colors">
                    Desativar
                  </button>
                ) : (
                  <button onClick={() => reactivateMut.mutate(c.id)} disabled={reactivateMut.isPending} className="px-3 py-1.5 text-[12px] font-semibold border border-dim-200 text-emerald-700 rounded-[8px] hover:border-emerald-400 hover:bg-emerald-50 transition-colors disabled:opacity-50">
                    Reativar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && <CompanyFormModal company={null} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["companies"] }); }} />}
      {editingCompany && <CompanyFormModal company={editingCompany} onClose={() => setEditingCompany(null)} onSaved={() => { setEditingCompany(null); qc.invalidateQueries({ queryKey: ["companies"] }); }} />}
      {deactivating && (
        <ConfirmModal
          title="Desativar Empresa"
          message={`Tem a certeza que quer desativar "${deactivating.name}"? Os planos de saúde já associados não são afetados.`}
          confirmLabel="Desativar"
          pending={deactivateMut.isPending}
          onConfirm={() => deactivateMut.mutate(deactivating.id)}
          onClose={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}

/* ── Perfis — permission matrix for the 5 real roles ─────────────────────── */

function PermsModal({ role, perms, onSave, onClose }: {
  role: { valor: string; codigo: string };
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
    <Modal open onClose={onClose} title={`Permissões — ${role.valor}`}>
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

function ProfilesSection() {
  const { addMessage } = useMessage();
  const qc = useQueryClient();
  const [editingRole, setEditingRole] = useState<{ valor: string; codigo: string } | null>(null);
  const [saving, setSaving] = useState(false);

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
      setEditingRole(null);
      addMessage("Success", "Permissões guardadas com sucesso!");
    } catch {
      addMessage("Error", "Erro ao guardar permissões.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={CARD}>
      <div className="px-5 py-4 border-b border-dim-100">
        <h3 className="font-display text-[14px] font-semibold text-dim-900">Perfis de Acesso</h3>
        <p className="text-[11px] text-dim-400 mt-0.5">Define permissões por página e ação para cada perfil</p>
      </div>

      <div className="divide-y divide-dim-100">
        {ROLE_ORDER.map((codigo) => {
          const isAdminProfile = codigo === "admin";
          const perms = getPerms(codigo);
          const enabled = countEnabled(perms);
          return (
            <div key={codigo} className="px-5 py-4 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-dim-100 rounded-[8px] flex items-center justify-center shrink-0">
                  <ShieldCheck className="text-dim-500" style={{ width: 15, height: 15 }} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-dim-900">{ROLE_LABELS[codigo]}</p>
                  <p className="text-[11px] text-dim-400 mt-0.5">
                    {isAdminProfile ? "Acesso total a todas as páginas" : `${enabled} de ${ACCESS_PAGES.length} páginas com acesso`}
                  </p>
                </div>
              </div>
              {isAdminProfile ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200/80">
                  <Check style={{ width: 10, height: 10 }} /> Acesso Total
                </span>
              ) : (
                <button
                  onClick={() => setEditingRole({ valor: ROLE_LABELS[codigo], codigo })}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-dim-200 text-dim-700 rounded-[8px] hover:border-brand-400 hover:text-brand-700 transition-colors"
                >
                  <ShieldCheck style={{ width: 13, height: 13 }} />
                  Permissões
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editingRole && (
        <PermsModal
          role={editingRole}
          perms={getPerms(editingRole.codigo)}
          onSave={(p) => handleSavePerms(editingRole.codigo, p)}
          onClose={() => setEditingRole(null)}
        />
      )}
    </div>
  );
}

/* ── Utilizadores — full lifecycle: invite, edit, deactivate ─────────────── */

function UsersSection() {
  const qc = useQueryClient();
  const { addMessage } = useMessage();
  const [addOpen, setAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<ApiStaff | null>(null);
  const [deactivating, setDeactivating] = useState<ApiStaff | null>(null);

  const { data: staffList = [], isLoading } = useQuery<ApiStaff[]>({
    queryKey: ["bff-staff"],
    queryFn: () => fetch("/api/bff/staff").then((r) => r.json()),
    staleTime: 60_000,
  });
  const { data: invitations = [] } = useQuery<StaffInvitationEntry[]>({
    queryKey: ["staff-invitations"],
    queryFn: () => fetch("/api/staff/invitations").then((r) => r.json()),
    staleTime: 30_000,
  });
  const { data: jobTitleOptions = [] } = useQuery<ParamOption[]>({
    queryKey: ["parametrizacao", "FUNCAO"],
    queryFn: () => fetch("/api/parametrizacao/FUNCAO").then((r) => r.json()),
    staleTime: 120_000,
  });
  const { data: specialtyOptions = [] } = useQuery<ParamOption[]>({
    queryKey: ["parametrizacao", "ESPECIALIDADE"],
    queryFn: () => fetch("/api/parametrizacao/ESPECIALIDADE").then((r) => r.json()),
    staleTime: 120_000,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => fetch("/api/staff/invite", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao enviar convite"); } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-invitations"] });
      addMessage("Success", "Convite enviado com sucesso! O colaborador vai receber um email para ativar a conta.");
      setAddOpen(false);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => fetch(`/api/staff/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar alterações"); } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bff-staff"] });
      addMessage("Success", "Alterações guardadas com sucesso!");
      setEditingStaff(null);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const cancelInviteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/staff/invitations/${id}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error("Erro ao cancelar convite"); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-invitations"] }); addMessage("Success", "Convite cancelado."); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/staff/${id}`, { method: "DELETE" })
      .then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao desativar"); } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bff-staff"] }); addMessage("Success", "Utilizador desativado."); setDeactivating(null); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const roleBadgeCls: Record<string, string> = {
    admin:        "bg-brand-50 text-brand-700 ring-brand-200/80",
    doctor:       "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
    nurse:        "bg-sky-50 text-sky-700 ring-sky-200/80",
    receptionist: "bg-violet-50 text-violet-700 ring-violet-200/80",
    lab_tech:     "bg-amber-50 text-amber-700 ring-amber-200/80",
    corporate_hr: "bg-dim-100 text-dim-600 ring-dim-200/80",
  };
  const totalRows = staffList.length + invitations.length;

  return (
    <div className={CARD}>
      <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
        <div>
          <h3 className="font-display text-[14px] font-semibold text-dim-900">Utilizadores</h3>
          <p className="text-[11px] text-dim-400 mt-0.5">
            {staffList.length} colaboradores{invitations.length > 0 ? ` · ${invitations.length} convite(s) pendente(s)` : ""}
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-brand-700 text-white rounded-[10px] hover:bg-brand-800 transition-colors">
          <Plus style={{ width: 14, height: 14 }} /> Adicionar Utilizador
        </button>
      </div>

      {isLoading ? (
        <div className="px-5 py-8 text-center text-[13px] text-dim-400">A carregar utilizadores…</div>
      ) : totalRows === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-dim-400">Sem utilizadores registados.</div>
      ) : (
        <div className="divide-y divide-dim-100">
          {invitations.map((inv) => {
            const initials = inv.fullName.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
            const expired = new Date(inv.expiresAt).getTime() < Date.now();
            return (
              <div key={`inv-${inv.id}`} className="px-5 py-3.5 flex items-center justify-between hover:bg-dim-50/60 transition-colors opacity-80">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-dim-100 text-dim-500 font-semibold text-[11px] flex items-center justify-center shrink-0 border border-dashed border-dim-300">{initials}</div>
                  <div>
                    <p className="text-[13px] font-medium text-dim-700">{inv.fullName}</p>
                    <p className="text-[11px] text-dim-400">{inv.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${expired ? "bg-red-50 text-red-600 ring-1 ring-red-200/80" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${expired ? "bg-red-400" : "bg-amber-400 animate-pulse"}`} />
                    {expired ? "Convite Expirado" : "Convite Pendente"}
                  </span>
                  <button onClick={() => cancelInviteMut.mutate(inv.id)} disabled={cancelInviteMut.isPending} className="text-[11px] font-semibold px-3 py-1.5 border border-dim-200 text-dim-500 rounded-[8px] hover:border-red-300 hover:text-red-600 transition-colors">
                    Cancelar Convite
                  </button>
                </div>
              </div>
            );
          })}
          {staffList.map((s) => {
            const initials = s.fullName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
            return (
              <div key={s.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-dim-50/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">{initials}</div>
                  <div>
                    <p className="text-[13px] font-semibold text-dim-900">{s.fullName}</p>
                    <p className="text-[11px] text-dim-400">{s.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${roleBadgeCls[s.role] ?? "bg-dim-100 text-dim-500"}`}>
                    {ROLE_LABELS[s.role] ?? s.role}
                  </span>
                  <button onClick={() => setEditingStaff(s)} className="text-[11px] font-semibold px-3 py-1.5 border border-dim-200 text-dim-600 rounded-[8px] hover:border-brand-400 hover:text-brand-700 transition-colors">
                    Editar
                  </button>
                  <button onClick={() => setDeactivating(s)} className="text-[11px] font-semibold px-3 py-1.5 border border-dim-200 text-dim-500 rounded-[8px] hover:border-red-300 hover:text-red-600 transition-colors">
                    Desativar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Adicionar Utilizador" description="Envia um convite por email para ativar a conta" size="lg">
        <StaffForm
          onSave={(form) => createMut.mutate(toApiBody(form))}
          onCancel={() => setAddOpen(false)}
          submitLabel="Enviar Convite"
          saving={createMut.isPending}
          jobTitleOptions={jobTitleOptions}
          specialtyOptions={specialtyOptions}
        />
      </Modal>

      <Modal open={!!editingStaff} onClose={() => setEditingStaff(null)} title="Editar Utilizador" description={editingStaff?.fullName} size="lg">
        {editingStaff && (
          <StaffForm
            initialValues={toFormValues(editingStaff)}
            onSave={(form) => editMut.mutate({ id: editingStaff.id, body: toApiBody(form) })}
            onCancel={() => setEditingStaff(null)}
            submitLabel="Guardar Alterações"
            saving={editMut.isPending}
            jobTitleOptions={jobTitleOptions}
            specialtyOptions={specialtyOptions}
          />
        )}
      </Modal>

      {deactivating && (
        <ConfirmModal
          title="Desativar Utilizador"
          message={`Tem a certeza que quer desativar "${deactivating.fullName}"? A conta deixa de conseguir iniciar sessão; o histórico é mantido.`}
          confirmLabel="Desativar"
          pending={deactivateMut.isPending}
          onConfirm={() => deactivateMut.mutate(deactivating.id)}
          onClose={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}

/* ── Main page — 3 levels: Organização, Perfis, Utilizadores ─────────────── */

export default function AccessPageContent() {
  const [tab, setTab] = useState<"organica" | "perfis" | "utilizadores">("utilizadores");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900 flex items-center gap-2">
            <Users className="text-brand-600" style={{ width: 22, height: 22 }} />
            Gestão de Acesso
          </h1>
          <p className="text-[13px] text-dim-500 mt-0.5">Organizações, perfis de permissões e utilizadores</p>
        </div>
        <div className="flex items-center gap-1 bg-dim-100 rounded-[10px] p-1">
          <TabButton active={tab === "organica"} onClick={() => setTab("organica")} icon={Building2}>Organização</TabButton>
          <TabButton active={tab === "perfis"} onClick={() => setTab("perfis")} icon={ShieldCheck}>Perfis</TabButton>
          <TabButton active={tab === "utilizadores"} onClick={() => setTab("utilizadores")} icon={Users}>Utilizadores</TabButton>
        </div>
      </div>

      {tab === "organica" && <OrganicaSection />}
      {tab === "perfis" && <ProfilesSection />}
      {tab === "utilizadores" && <UsersSection />}
    </div>
  );
}
