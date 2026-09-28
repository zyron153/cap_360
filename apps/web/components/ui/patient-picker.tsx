"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDebouncedValue } from "../../lib/use-debounced-value";

type PatientSearchResult = { id: string; fullName: string; phone: string | null };

const DEFAULT_INPUT_CLS =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300";

/** Search-as-you-type replacement for a `<select>` fed by `/api/patients?limit=100` — any patient
 * outside that page was silently unreachable. Used anywhere a form needs to pick one patient
 * (appointment booking, invoice creation). */
export function PatientPicker({
  value,
  onSelect,
  className,
}: {
  value: string;
  onSelect: (id: string, name: string) => void;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [focused, setFocused] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: results = [], isFetching } = useQuery<PatientSearchResult[]>({
    queryKey: ["patient-search", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "10", q: debouncedSearch });
      const res = await fetch(`/api/patients?${params}`);
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: focused && debouncedSearch.length >= 2,
  });

  const showDropdown = focused && debouncedSearch.length >= 2;

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dim-400 pointer-events-none" />
      <input
        value={value && selectedName ? selectedName : search}
        onChange={(e) => { setSearch(e.target.value); setSelectedName(""); onSelect("", ""); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Nome, telefone ou NIF…"
        className={`${className ?? DEFAULT_INPUT_CLS} pl-9`}
      />
      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white rounded-[10px] border border-dim-200 shadow-[0_8px_24px_rgba(0,0,0,.12)] divide-y divide-dim-100">
          {isFetching ? (
            <p className="text-[12px] text-dim-400 text-center py-4">A pesquisar…</p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-dim-400 text-center py-4">Nenhum paciente encontrado.</p>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setSelectedName(p.fullName); setSearch(""); onSelect(p.id, p.fullName); setFocused(false); }}
                className="w-full flex items-center justify-between py-2 px-3 hover:bg-dim-50 transition-colors text-left"
              >
                <span className="text-[13px] font-medium text-dim-900">{p.fullName}</span>
                {p.phone && <span className="text-[11px] text-dim-400 font-mono">{p.phone}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
