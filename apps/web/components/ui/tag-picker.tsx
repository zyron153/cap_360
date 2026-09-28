"use client";

import { useQuery } from "@tanstack/react-query";

type Entry = { id: number; valor: string; codigo: string | null };

/** Multi-select chip toggle over a Parametrizacao group. Stores codigo (falls back to valor). */
export function TagPicker({
  nome,
  value,
  onChange,
}: {
  nome: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { data = [] } = useQuery<Entry[]>({
    queryKey: ["parametrizacao", nome],
    queryFn: () => fetch(`/api/parametrizacao/${nome}`).then((r) => r.json()),
    staleTime: 120_000,
  });

  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter((v) => v !== code) : [...value, code]);
  }

  if (data.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {data.map((e) => {
        const code = e.codigo ?? e.valor;
        const active = value.includes(code);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => toggle(code)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
              active
                ? "bg-brand-700 border-brand-700 text-white"
                : "border-dim-200 text-dim-600 hover:border-brand-300 hover:text-brand-700"
            }`}
          >
            {e.valor}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only pills resolving stored tag codes back to their Parametrizacao labels. */
export function TagBadges({ nome, codes }: { nome: string; codes: string[] }) {
  const { data = [] } = useQuery<Entry[]>({
    queryKey: ["parametrizacao", nome],
    queryFn: () => fetch(`/api/parametrizacao/${nome}`).then((r) => r.json()),
    staleTime: 120_000,
  });

  if (codes.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((code) => (
        <span
          key={code}
          className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-100 text-brand-800"
        >
          {data.find((e) => (e.codigo ?? e.valor) === code)?.valor ?? code}
        </span>
      ))}
    </div>
  );
}
