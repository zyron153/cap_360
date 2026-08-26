"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, Plus, Pencil, Trash2, Check, X, Stethoscope, Info } from "lucide-react";
import type { ServiceEntry, ParametrizacaoEntry } from "@cap/types";
import { useMessage } from "../../../components/ui/message-handler";

/* ── Types ───────────────────────────────────────────────── */

type Entry = {
  id: number; nome: string; valor: string; codigo: string | null;
  descricao: string | null; ordem: number; ativo: boolean; createdAt: string;
};
type Group = { nome: string; count: number };

/* ── Sidebar sections ────────────────────────────────────── */

const SECTIONS: { label: string; nomes: string[] }[] = [
  { label: "Colaboradores", nomes: ["PROFILE_SETTINGS", "FUNCAO", "ESPECIALIDADE"] },
  { label: "Clínica",       nomes: ["TIPO_SERVICO", "TIPO_EXAME", "TIPO_CONSULTA"] },
  { label: "Planos",        nomes: ["TIPO_PLANO_SAUDE"] },
];
const DEFAULT_NOMES = SECTIONS.flatMap(s => s.nomes);

const NOME_RE = /^[A-Z][A-Z0-9_]{1,99}$/;

/* ── Toggle switch ───────────────────────────────────────── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        checked ? "bg-brand-600" : "bg-dim-200"
      }`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

/* ── Inline text input ───────────────────────────────────── */

const cellInput = "w-full border border-brand-300 rounded-[6px] px-2 py-1 text-[12px] bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_2px_rgba(19,163,163,.12)]";

/* ── Row form state ──────────────────────────────────────── */

const BLANK = { valor: "", codigo: "", descricao: "", ordem: "" };

/* ── Sidebar ─────────────────────────────────────────────── */

function Sidebar({
  groups, selected, onSelect,
}: {
  groups: Group[]; selected: string | null; onSelect: (nome: string) => void;
}) {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();
  const [newNome, setNewNome] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const countMap = Object.fromEntries(groups.map(g => [g.nome, g.count]));
  const allNomes = [...new Set([...DEFAULT_NOMES, ...groups.map(g => g.nome)])];

  // Build sections + Outros
  const inSections = new Set(SECTIONS.flatMap(s => s.nomes));
  const outros = allNomes.filter(n => !inSections.has(n));
  const rendered = [...SECTIONS, ...(outros.length ? [{ label: "Outros", nomes: outros }] : [])];

  function confirmNewGroup() {
    if (!NOME_RE.test(newNome)) {
      addMessage("Error", "Nome inválido — use SCREAMING_SNAKE_CASE (ex: MINHA_LISTA)");
      return;
    }
    queryClient.setQueryData(["parametrizacao-groups"], (old: Group[] = []) =>
      old.some(g => g.nome === newNome) ? old : [...old, { nome: newNome, count: 0 }],
    );
    onSelect(newNome);
    setNewNome("");
    setAddingGroup(false);
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col gap-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-dim-400">Grupos</span>
        <button
          onClick={() => { setAddingGroup(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-800 transition-colors"
        >
          <Plus style={{ width: 12, height: 12 }} />
          Novo
        </button>
      </div>

      {addingGroup && (
        <div className="mx-3 mb-3 flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={newNome}
            onChange={e => setNewNome(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") confirmNewGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewNome(""); } }}
            placeholder="NOVO_GRUPO"
            className="flex-1 border border-dim-200 rounded-[7px] px-2.5 py-1.5 text-[11px] font-mono text-dim-900 bg-white focus:outline-none focus:border-brand-500"
          />
          <button onClick={confirmNewGroup} className="text-brand-600 hover:text-brand-800"><Check style={{ width: 14, height: 14 }} /></button>
          <button onClick={() => { setAddingGroup(false); setNewNome(""); }} className="text-dim-400 hover:text-dim-700"><X style={{ width: 14, height: 14 }} /></button>
        </div>
      )}

      <div className="flex flex-col gap-3 overflow-y-auto">
        {rendered.map(section => (
          <div key={section.label}>
            <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-dim-400">{section.label}</div>
            {section.nomes.map(nome => {
              const count = countMap[nome] ?? 0;
              const active = selected === nome;
              return (
                <button
                  key={nome}
                  onClick={() => onSelect(nome)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors rounded-[8px] mx-0 ${
                    active ? "bg-brand-700 text-white" : "text-dim-600 hover:bg-dim-100 hover:text-dim-900"
                  }`}
                >
                  <span className="text-[11px] font-mono font-semibold truncate">{nome}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-1.5 ${active ? "bg-white/20 text-white" : "bg-dim-100 text-dim-500"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ── Values table ────────────────────────────────────────── */

function ValuesPanel({ nome }: { nome: string }) {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();

  const { data: entries = [], isLoading, isError } = useQuery<Entry[]>({
    queryKey: ["parametrizacao-admin", nome],
    queryFn: () =>
      fetch(`/api/parametrizacao/${nome}?includeInactive=true`).then(r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      }),
    staleTime: 30_000,
    retry: 3,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 5000),
  });

  /* ── Add row ── */
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState(BLANK);

  /* ── Edit row ── */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState(BLANK);

  /* ── Mutations ── */
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["parametrizacao-admin", nome] });
    queryClient.invalidateQueries({ queryKey: ["parametrizacao", nome] });
    queryClient.invalidateQueries({ queryKey: ["parametrizacao-groups"] });
  }

  const createMut = useMutation({
    mutationFn: (body: object) =>
      fetch("/api/parametrizacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro"); } return r.json(); }),
    onSuccess: () => { invalidate(); addMessage("Success", "Valor criado!"); setAddingRow(false); setNewRow(BLANK); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      fetch(`/api/parametrizacao/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro"); } return r.json(); }),
    onSuccess: () => { invalidate(); addMessage("Success", "Guardado!"); setEditingId(null); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/parametrizacao/${id}`, { method: "DELETE" })
        .then(async r => { if (!r.ok) throw new Error("Erro ao eliminar"); return r.json(); }),
    onSuccess: () => { invalidate(); addMessage("Success", "Eliminado!"); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      fetch(`/api/parametrizacao/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo }) })
        .then(r => r.json()),
    onSuccess: () => invalidate(),
    onError: (e: Error) => addMessage("Error", e.message),
  });

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setEditRow({ valor: e.valor, codigo: e.codigo ?? "", descricao: e.descricao ?? "", ordem: String(e.ordem) });
  }

  function saveEdit(id: number) {
    updateMut.mutate({ id, body: {
      valor: editRow.valor.trim() || undefined,
      codigo: editRow.codigo.trim() || null,
      descricao: editRow.descricao.trim() || null,
      ordem: editRow.ordem !== "" ? Number(editRow.ordem) : undefined,
    }});
  }

  function saveNew() {
    if (!newRow.valor.trim()) return;
    createMut.mutate({
      nome,
      valor: newRow.valor.trim(),
      codigo: newRow.codigo.trim() || null,
      descricao: newRow.descricao.trim() || null,
      ordem: newRow.ordem !== "" ? Number(newRow.ordem) : undefined,
    });
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-CV", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="flex-1 min-w-0 bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-dim-100">
        <div>
          <h2 className="font-mono text-[15px] font-bold text-dim-900">{nome}</h2>
          <p className="text-[11px] text-dim-400 mt-0.5">{entries.length} valores</p>
        </div>
        {!addingRow && (
          <button
            onClick={() => { setNewRow(BLANK); setAddingRow(true); setEditingId(null); }}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors"
          >
            <Plus style={{ width: 13, height: 13 }} />
            + Valor
          </button>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["#", "VALOR", "CÓDIGO", "DESCRIÇÃO", "ACTIVO", "CRIADO", ""].map(h => (
              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-4 py-2.5 border-b border-dim-100 bg-dim-50">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* New inline row */}
          {addingRow && (
            <tr className="bg-brand-50/50 border-b-2 border-brand-200">
              <td className="px-4 py-2 text-[11px] text-dim-400">—</td>
              <td className="px-4 py-2"><input autoFocus className={cellInput} placeholder="Valor *" value={newRow.valor} onChange={e => setNewRow(r => ({ ...r, valor: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") setAddingRow(false); }} /></td>
              <td className="px-4 py-2"><input className={`${cellInput} font-mono`} placeholder="código" value={newRow.codigo} onChange={e => setNewRow(r => ({ ...r, codigo: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") setAddingRow(false); }} /></td>
              <td className="px-4 py-2"><input className={cellInput} placeholder="Descrição" value={newRow.descricao} onChange={e => setNewRow(r => ({ ...r, descricao: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") setAddingRow(false); }} /></td>
              <td className="px-4 py-2"><Toggle checked={true} onChange={() => {}} /></td>
              <td className="px-4 py-2 text-[11px] text-dim-300">—</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <button onClick={saveNew} disabled={createMut.isPending || !newRow.valor.trim()} className="text-[11px] font-semibold bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-[7px] transition-colors">{createMut.isPending ? "…" : "Guardar"}</button>
                  <button onClick={() => setAddingRow(false)} className="text-[11px] text-dim-400 hover:text-dim-700 px-2 py-1.5">Cancelar</button>
                </div>
              </td>
            </tr>
          )}

          {isLoading && !addingRow && (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[20, 120, 80, 160, 40, 80, 80].map((w, j) => (
                  <td key={j} className="px-4 py-3.5 border-b border-dim-100"><div className="h-3 bg-dim-100 rounded" style={{ width: w }} /></td>
                ))}
              </tr>
            ))
          )}

          {isError && !addingRow && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-red-500">Erro ao carregar dados. Verifique se a API está em execução e recarregue a página.</td></tr>
          )}

          {!isLoading && !isError && entries.length === 0 && !addingRow && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-dim-400">Nenhum valor. Clique em "+ Valor" para adicionar.</td></tr>
          )}

          {entries.map((e, idx) => (
            <tr key={e.id} className={`hover:bg-dim-50 transition-colors group ${!e.ativo ? "opacity-40" : ""}`}>
              <td className="px-4 py-3 border-b border-dim-100 text-[11px] text-dim-300 font-mono">{idx}</td>

              {editingId === e.id ? (
                <>
                  <td className="px-4 py-2 border-b border-dim-100"><input autoFocus className={cellInput} value={editRow.valor} onChange={v => setEditRow(r => ({ ...r, valor: v.target.value }))} onKeyDown={k => { if (k.key === "Escape") setEditingId(null); }} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><input className={`${cellInput} font-mono`} value={editRow.codigo} onChange={v => setEditRow(r => ({ ...r, codigo: v.target.value }))} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><input className={cellInput} value={editRow.descricao} onChange={v => setEditRow(r => ({ ...r, descricao: v.target.value }))} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><Toggle checked={e.ativo} onChange={() => toggleMut.mutate({ id: e.id, ativo: !e.ativo })} /></td>
                  <td className="px-4 py-3 border-b border-dim-100 text-[11px] text-dim-400">{fmt(e.createdAt)}</td>
                  <td className="px-4 py-2 border-b border-dim-100">
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(e.id)} disabled={updateMut.isPending} className="text-[11px] font-semibold bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-[7px] transition-colors">{updateMut.isPending ? "…" : "Guardar"}</button>
                      <button onClick={() => setEditingId(null)} className="text-[11px] text-dim-400 hover:text-dim-700 px-2 py-1.5">Cancelar</button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 border-b border-dim-100 text-[13px] font-medium text-dim-900">{e.valor}</td>
                  <td className="px-4 py-3 border-b border-dim-100 font-mono text-[11px] text-dim-500">{e.codigo ?? <span className="text-dim-300">—</span>}</td>
                  <td className="px-4 py-3 border-b border-dim-100 text-[12px] text-dim-500 max-w-[220px] truncate">{e.descricao ?? <span className="text-dim-300">—</span>}</td>
                  <td className="px-4 py-3 border-b border-dim-100"><Toggle checked={e.ativo} onChange={() => toggleMut.mutate({ id: e.id, ativo: !e.ativo })} /></td>
                  <td className="px-4 py-3 border-b border-dim-100 text-[11px] text-dim-400">{fmt(e.createdAt)}</td>
                  <td className="px-4 py-3 border-b border-dim-100">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { startEdit(e); setAddingRow(false); }} className="text-dim-400 hover:text-brand-600 transition-colors" title="Editar"><Pencil style={{ width: 13, height: 13 }} /></button>
                      <button onClick={() => deleteMut.mutate(e.id)} className="text-dim-400 hover:text-red-500 transition-colors" title="Eliminar"><Trash2 style={{ width: 13, height: 13 }} /></button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Services panel (Gestão de Serviços) ─────────────────── */
/* List is sourced from the TIPO_SERVICO parametrização group (the same list the */
/* Agendamentos form reads). Per the existing seed convention, codigo on a */
/* TIPO_SERVICO entry holds the linked Service's UUID (not a human code) — see */
/* packages/database/src/seed.ts. A TIPO_SERVICO entry with no codigo yet is a */
/* valid "draft" state: it shows a passive "Preço por definir" badge until an */
/* admin sets a price, which creates the Service row and backfills codigo. */

type MergedService = {
  paramId: number;
  serviceId: string | null;
  name: string;
  serviceCode: string | null;
  ativo: boolean;
  durationMinutes: number | null;
  price: number | null;
  createdAt: string;
};

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function suggestServiceCode(name: string) {
  return name
    .toUpperCase()
    .normalize("NFD").replace(DIACRITICS_RE, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

const BLANK_NEW = { name: "" };
const BLANK_EDIT = { name: "", code: "", durationMinutes: "30", price: "" };

function ServicesPanel() {
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();

  const { data: paramEntries = [], isLoading: paramLoading, isError: paramError } = useQuery<ParametrizacaoEntry[]>({
    queryKey: ["parametrizacao-admin", "TIPO_SERVICO"],
    queryFn: () =>
      fetch("/api/parametrizacao/TIPO_SERVICO?includeInactive=true").then(r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      }),
    staleTime: 30_000,
    retry: 3,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 5000),
  });

  const { data: services = [], isLoading: servicesLoading, isError: servicesError } = useQuery<ServiceEntry[]>({
    queryKey: ["services-admin"],
    queryFn: () =>
      fetch("/api/services?includeInactive=true").then(r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      }),
    staleTime: 30_000,
    retry: 3,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 5000),
  });

  const isLoading = paramLoading || servicesLoading;
  const isError = paramError || servicesError;

  const merged: MergedService[] = paramEntries.map(p => {
    const svc = p.codigo ? services.find(s => s.id === p.codigo) : undefined;
    return {
      paramId: p.id,
      serviceId: svc?.id ?? null,
      name: p.valor,
      serviceCode: svc?.code ?? null,
      ativo: p.ativo,
      durationMinutes: svc?.durationMinutes ?? null,
      price: svc ? Number(svc.price) : null,
      createdAt: p.createdAt,
    };
  });

  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState(BLANK_NEW);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState(BLANK_EDIT);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["parametrizacao-admin", "TIPO_SERVICO"] });
    queryClient.invalidateQueries({ queryKey: ["parametrizacao", "TIPO_SERVICO"] });
    queryClient.invalidateQueries({ queryKey: ["parametrizacao-groups"] });
    queryClient.invalidateQueries({ queryKey: ["services-admin"] });
    queryClient.invalidateQueries({ queryKey: ["services-list"] });
    queryClient.invalidateQueries({ queryKey: ["services"] });
  }

  const createMut = useMutation({
    mutationFn: (body: object) =>
      fetch("/api/parametrizacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro"); } return r.json(); }),
    onSuccess: () => { invalidate(); addMessage("Success", "Serviço criado! Defina o preço para o disponibilizar em Faturação."); setAddingRow(false); setNewRow(BLANK_NEW); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const saveEditMut = useMutation({
    mutationFn: async (vars: { m: MergedService; name: string; code: string; duration: string; price: string }) => {
      const { m, name, code, duration, price } = vars;

      // Name lives on the parametrização entry — codigo is UUID-managed below, never edited directly here.
      if (name.trim() !== m.name) {
        const paramRes = await fetch(`/api/parametrizacao/${m.paramId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valor: name.trim() }),
        });
        if (!paramRes.ok) { const e = await paramRes.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar nome"); }
      }

      if (price === "") return; // still a draft — nothing more to do

      const svcBody = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        price: Number(price),
        durationMinutes: duration !== "" ? Number(duration) : undefined,
      };

      if (m.serviceId) {
        const svcRes = await fetch(`/api/services/${m.serviceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(svcBody) });
        if (!svcRes.ok) { const e = await svcRes.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar preço"); }
      } else {
        // First time this draft gets a price: create the Service, then link it by UUID.
        const svcRes = await fetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(svcBody) });
        if (!svcRes.ok) { const e = await svcRes.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao guardar preço"); }
        const newService = await svcRes.json();
        const linkRes = await fetch(`/api/parametrizacao/${m.paramId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: newService.id }) });
        if (!linkRes.ok) throw new Error("Preço guardado, mas falhou a ligação ao serviço");
      }
    },
    onSuccess: () => { invalidate(); addMessage("Success", "Guardado!"); setEditingId(null); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const toggleMut = useMutation({
    mutationFn: async (vars: { m: MergedService; ativo: boolean }) => {
      await fetch(`/api/parametrizacao/${vars.m.paramId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: vars.ativo }) });
      if (vars.m.serviceId) {
        await fetch(`/api/services/${vars.m.serviceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: vars.ativo }) });
      }
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => addMessage("Error", e.message),
  });

  function startEdit(m: MergedService) {
    setEditingId(m.paramId);
    setEditRow({
      name: m.name, code: m.serviceCode ?? suggestServiceCode(m.name),
      durationMinutes: m.durationMinutes != null ? String(m.durationMinutes) : "30",
      price: m.price != null ? String(m.price) : "",
    });
  }

  function saveEdit(m: MergedService) {
    if (!editRow.name.trim()) return;
    if (editRow.price !== "" && !editRow.code.trim()) return; // code is required once a price is set
    saveEditMut.mutate({ m, name: editRow.name, code: editRow.code, duration: editRow.durationMinutes, price: editRow.price });
  }

  function saveNew() {
    if (!newRow.name.trim()) return;
    createMut.mutate({ nome: "TIPO_SERVICO", valor: newRow.name.trim() });
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-CV", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="flex-1 min-w-0 bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-dim-100">
        <div>
          <h2 className="font-display text-[15px] font-bold text-dim-900">Gestão de Serviços</h2>
          <p className="text-[11px] text-dim-400 mt-0.5">{merged.length} serviços (TIPO_SERVICO) · defina o preço para disponibilizar em Faturação e Agendamentos</p>
        </div>
        {!addingRow && (
          <button
            onClick={() => { setNewRow(BLANK_NEW); setAddingRow(true); setEditingId(null); }}
            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors"
          >
            <Plus style={{ width: 13, height: 13 }} />
            + Serviço
          </button>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["NOME", "CÓDIGO", "DURAÇÃO", "PREÇO (CVE)", "ATIVO", "CRIADO", ""].map(h => (
              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-[0.07em] text-dim-400 px-4 py-2.5 border-b border-dim-100 bg-dim-50">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {addingRow && (
            <tr className="bg-brand-50/50 border-b-2 border-brand-200">
              <td className="px-4 py-2" colSpan={2}><input autoFocus className={cellInput} placeholder="Nome do serviço *" value={newRow.name} onChange={e => setNewRow({ name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") saveNew(); if (e.key === "Escape") setAddingRow(false); }} /></td>
              <td className="px-4 py-2 text-[11px] text-dim-300">—</td>
              <td className="px-4 py-2 text-[11px] text-dim-300">definir a seguir</td>
              <td className="px-4 py-2"><Toggle checked={true} onChange={() => {}} /></td>
              <td className="px-4 py-2 text-[11px] text-dim-300">—</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <button onClick={saveNew} disabled={createMut.isPending || !newRow.name.trim()} className="text-[11px] font-semibold bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-[7px] transition-colors">{createMut.isPending ? "…" : "Guardar"}</button>
                  <button onClick={() => setAddingRow(false)} className="text-[11px] text-dim-400 hover:text-dim-700 px-2 py-1.5">Cancelar</button>
                </div>
              </td>
            </tr>
          )}

          {isLoading && !addingRow && (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[140, 80, 60, 80, 40, 80, 80].map((w, j) => (
                  <td key={j} className="px-4 py-3.5 border-b border-dim-100"><div className="h-3 bg-dim-100 rounded" style={{ width: w }} /></td>
                ))}
              </tr>
            ))
          )}

          {isError && !addingRow && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-red-500">Erro ao carregar serviços. Verifique se a API está em execução e recarregue a página.</td></tr>
          )}

          {!isLoading && !isError && merged.length === 0 && !addingRow && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-dim-400">Nenhum serviço. Clique em "+ Serviço" para adicionar.</td></tr>
          )}

          {merged.map(m => (
            <tr key={m.paramId} className={`hover:bg-dim-50 transition-colors group ${!m.ativo ? "opacity-40" : ""}`}>
              {editingId === m.paramId ? (
                <>
                  <td className="px-4 py-2 border-b border-dim-100"><input autoFocus className={cellInput} value={editRow.name} onChange={v => setEditRow(r => ({ ...r, name: v.target.value }))} onKeyDown={k => { if (k.key === "Escape") setEditingId(null); }} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><input className={`${cellInput} font-mono`} value={editRow.code} onChange={v => setEditRow(r => ({ ...r, code: v.target.value.toUpperCase() }))} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><input type="number" min="1" className={`${cellInput} font-mono`} value={editRow.durationMinutes} onChange={v => setEditRow(r => ({ ...r, durationMinutes: v.target.value }))} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><input type="number" min="0" step="0.01" placeholder="0.00" className={`${cellInput} font-mono`} value={editRow.price} onChange={v => setEditRow(r => ({ ...r, price: v.target.value }))} /></td>
                  <td className="px-4 py-2 border-b border-dim-100"><Toggle checked={m.ativo} onChange={() => toggleMut.mutate({ m, ativo: !m.ativo })} /></td>
                  <td className="px-4 py-3 border-b border-dim-100 text-[11px] text-dim-400">{fmt(m.createdAt)}</td>
                  <td className="px-4 py-2 border-b border-dim-100">
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(m)} disabled={saveEditMut.isPending} className="text-[11px] font-semibold bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-[7px] transition-colors">{saveEditMut.isPending ? "…" : "Guardar"}</button>
                      <button onClick={() => setEditingId(null)} className="text-[11px] text-dim-400 hover:text-dim-700 px-2 py-1.5">Cancelar</button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 border-b border-dim-100 text-[13px] font-medium text-dim-900">{m.name}</td>
                  <td className="px-4 py-3 border-b border-dim-100 font-mono text-[11px] text-dim-500">{m.serviceCode ?? <span className="text-dim-300">—</span>}</td>
                  <td className="px-4 py-3 border-b border-dim-100 font-mono text-[11px] text-dim-500">{m.durationMinutes != null ? `${m.durationMinutes} min` : <span className="text-dim-300">—</span>}</td>
                  <td className="px-4 py-3 border-b border-dim-100">
                    {m.price != null ? (
                      <span className="font-mono text-[12px] font-semibold text-dim-900">{m.price.toLocaleString("pt-CV")}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/80">
                        <Info style={{ width: 10, height: 10 }} /> Preço por definir
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 border-b border-dim-100"><Toggle checked={m.ativo} onChange={() => toggleMut.mutate({ m, ativo: !m.ativo })} /></td>
                  <td className="px-4 py-3 border-b border-dim-100 text-[11px] text-dim-400">{fmt(m.createdAt)}</td>
                  <td className="px-4 py-3 border-b border-dim-100">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { startEdit(m); setAddingRow(false); }} className="text-dim-400 hover:text-brand-600 transition-colors" title="Editar"><Pencil style={{ width: 13, height: 13 }} /></button>
                      <button onClick={() => toggleMut.mutate({ m, ativo: false })} className="text-dim-400 hover:text-red-500 transition-colors" title="Desativar"><Trash2 style={{ width: 13, height: 13 }} /></button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default function ParametrizacoesPage() {
  const [view, setView] = useState<"generic" | "services">("generic");
  const [selected, setSelected] = useState<string | null>(DEFAULT_NOMES[0]);

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["parametrizacao-groups"],
    queryFn: () =>
      fetch("/api/parametrizacao").then(r => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      }),
    staleTime: 30_000,
    retry: 3,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 5000),
  });

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-[10px] flex items-center justify-center shrink-0">
            <SlidersHorizontal className="text-brand-600" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <h1 className="font-display text-[22px] font-bold text-dim-900">Parametrizações</h1>
            <p className="text-[13px] text-dim-500 mt-0.5">
              {view === "generic" ? "Tabela de lookup genérica · alimenta todos os dropdowns da aplicação" : "Nome, duração e preço dos serviços clínicos"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-dim-100 p-1 rounded-[10px]">
          <button
            onClick={() => setView("generic")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold transition-colors ${
              view === "generic" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-800"
            }`}
          >
            <SlidersHorizontal style={{ width: 13, height: 13 }} />
            Parametrização Genérica
          </button>
          <button
            onClick={() => setView("services")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold transition-colors ${
              view === "services" ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-800"
            }`}
          >
            <Stethoscope style={{ width: 13, height: 13 }} />
            Gestão de Serviços
          </button>
        </div>
      </div>

      {view === "generic" ? (
        <div className="flex gap-5 items-start flex-1">
          <div className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] p-3 shrink-0">
            <Sidebar groups={groups} selected={selected} onSelect={setSelected} />
          </div>
          {selected ? (
            <ValuesPanel key={selected} nome={selected} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[13px] text-dim-400">
              Seleccione um grupo à esquerda
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1">
          <ServicesPanel />
        </div>
      )}
    </div>
  );
}
