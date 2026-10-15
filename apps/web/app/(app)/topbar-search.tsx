"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { usePermissions } from "./hooks/use-permissions";

type Result = { id: string; fullName: string | null; phone: string | null };

/**
 * Search-as-you-type over patients (name, phone or NIF); picking one opens their profile.
 *
 * From `md` it is the box in the topbar. Below that there is no room for a box, so a search icon opens a
 * bar that covers the topbar (with a Cancelar), and the results drop down full width under it. It is the
 * same input and the same list either way — only the classes change.
 */
export function TopbarSearch() {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false); // phone: the search bar is covering the topbar
  const [active, setActive] = useState(0);
  const dq = useDebouncedValue(q.trim(), 300);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const allowed = !isLoading && can("patients");
  const showList = open && dq.length >= 2;

  const { data: results = [], isFetching } = useQuery<Result[]>({
    queryKey: ["topbar-patient-search", dq],
    queryFn: async () => {
      const res = await fetch(`/api/patients?${new URLSearchParams({ page: "1", limit: "8", q: dq })}`);
      if (!res.ok) throw new Error("Erro");
      return ((await res.json()).data ?? []) as Result[];
    },
    enabled: allowed && showList,
  });

  useEffect(() => setActive(0), [dq]);
  useEffect(() => { if (sheet) inputRef.current?.focus(); }, [sheet]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setSheet(false); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setSheet(false);
  }

  function go(p: Result) {
    close();
    setQ("");
    router.push(`/patients/${p.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && showList && results[active]) { e.preventDefault(); go(results[active]); }
    else if (e.key === "Escape") close();
  }

  if (!allowed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { setSheet(true); setOpen(true); }}
        aria-label="Abrir pesquisa de pacientes"
        className="md:hidden w-9 h-9 rounded-md flex items-center justify-center text-dim-500 hover:bg-dim-100 hover:text-dim-700 transition-colors shrink-0"
      >
        <Search className="w-4 h-4" />
      </button>

      <div
        ref={boxRef}
        className={
          sheet
            ? "fixed inset-x-0 top-0 z-40 h-[60px] bg-white border-b border-dim-200 px-4 flex items-center gap-2 md:relative md:inset-auto md:z-auto md:h-auto md:border-0 md:bg-transparent md:px-0 md:block"
            : "relative hidden md:block"
        }
      >
        <div className="flex flex-1 items-center gap-2 bg-dim-100 border border-dim-200 rounded-[10px] px-3 py-1.5 md:flex-none md:w-48 xl:w-64 focus-within:border-brand-500 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all">
          <Search className="w-3.5 h-3.5 text-dim-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Abrir paciente"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Abrir paciente…"
            className="border-none bg-transparent text-[13px] text-dim-800 w-full outline-none placeholder:text-dim-400 font-sans"
          />
        </div>
        {sheet && (
          <button type="button" onClick={close} className="md:hidden text-[12px] font-semibold text-dim-600 hover:text-dim-900 px-1 shrink-0">
            Cancelar
          </button>
        )}
        {showList && (
          <div
            id={listId}
            role="listbox"
            className="fixed left-4 right-4 top-[64px] md:absolute md:left-auto md:right-0 md:top-full md:mt-1 md:w-80 z-30 max-h-72 overflow-y-auto bg-white rounded-[12px] border border-dim-200 shadow-[0_8px_24px_rgba(0,0,0,.12)]"
          >
            {isFetching ? (
              <p className="text-[12px] text-dim-400 text-center py-4">A pesquisar…</p>
            ) : results.length === 0 ? (
              <p className="text-[12px] text-dim-400 text-center py-4">Nenhum paciente encontrado.</p>
            ) : (
              results.map((p, i) => (
                <button
                  key={p.id}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(p)}
                  className={`w-full flex items-center justify-between gap-3 py-2.5 px-3 text-left transition-colors border-b border-dim-100 last:border-0 ${i === active ? "bg-dim-50" : ""}`}
                >
                  <span className="text-[13px] font-medium text-dim-900 truncate">{p.fullName ?? "Paciente"}</span>
                  {p.phone && <span className="text-[11px] text-dim-400 font-mono shrink-0">{p.phone}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
