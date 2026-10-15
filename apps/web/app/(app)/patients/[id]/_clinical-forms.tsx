"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ClinicalNoteEntry } from "@cap/types";
import { Field } from "@/components/ui/field";
import { fetchJson, isDraft, sessionTypeLabel } from "../../records/_note-shared";

/** The per-patient lists come a page at a time (GET …?page=&limit=, a plain array newest first): a full page means there may be more. */
export const LIST_PAGE = 100;

export interface PagedList<T> {
  data: T[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
  hasNextPage: boolean;
  fetchNextPage: () => unknown;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
}

export function usePagedList<T extends { id: string }>(queryKey: unknown[], url: string, enabled = true): PagedList<T> {
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchJson<T[]>(`${url}?${new URLSearchParams({ page: String(pageParam), limit: String(LIST_PAGE) })}`),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length === LIST_PAGE ? all.length + 1 : undefined),
    enabled,
  });
  // Offset paging can repeat a row at a page boundary if one lands while browsing.
  const data = useMemo(() => {
    if (!q.data) return undefined;
    const seen = new Set<string>();
    return q.data.pages.flat().filter((x) => !seen.has(x.id) && seen.add(x.id));
  }, [q.data]);
  return {
    data, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch, hasNextPage: !!q.hasNextPage,
    fetchNextPage: q.fetchNextPage, isFetchingNextPage: q.isFetchingNextPage, isFetchNextPageError: q.isFetchNextPageError,
  };
}

/** "Carregar mais" under a list that has more pages. */
export function LoadMore({ list }: { list: Pick<PagedList<unknown>, "hasNextPage" | "fetchNextPage" | "isFetchingNextPage" | "isFetchNextPageError"> }) {
  if (!list.hasNextPage) return null;
  return (
    <div className="text-center pt-1">
      {list.isFetchNextPageError && <p role="alert" className="text-[12px] text-red-600 mb-1">Não foi possível carregar mais.</p>}
      <button
        type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}
        className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50 transition-colors"
      >
        {list.isFetchingNextPage ? "A carregar…" : "Carregar mais"}
      </button>
    </div>
  );
}

export const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans disabled:bg-dim-50 disabled:text-dim-600";
export const inputErrCls = "border-red-300 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,.12)]";
export const btnPrimary = "bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors";
export const btnSecondary = "border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors disabled:opacity-60";
export const btnNew = "self-end flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors";

export const noteDate = (n: ClinicalNoteEntry) => format(new Date(n.finalizedAt ?? n.createdAt), "d MMM yyyy", { locale: pt });
const noteLabel = (n: ClinicalNoteEntry) => `${noteDate(n)} · ${sessionTypeLabel(n.sessionType)}${isDraft(n) ? " (rascunho)" : ""}`;

/** The optional "which note is this from" select of the prescription and referral forms. */
export function NoteLinkSelect({ notes, value, onChange, disabled }: {
  notes: ClinicalNoteEntry[]; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  return (
    <Field label="Associar a uma nota" hint="Opcional">
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputCls}>
        <option value="">Sem nota associada</option>
        {notes.map((n) => <option key={n.id} value={n.id}>{noteLabel(n)}</option>)}
      </select>
    </Field>
  );
}

/** "Nota de 6 out 2026", linking to the note when the viewer may open it (their own); plain text otherwise. */
export function NoteLink({ noteId, notes, patientId }: { noteId: string | null; notes: ClinicalNoteEntry[]; patientId: string }) {
  if (!noteId) return null;
  const n = notes.find((x) => x.id === noteId);
  if (!n) return <span>Nota associada</span>;
  return (
    <Link href={`/records/note?noteId=${n.id}&returnTo=/patients/${patientId}`} className="text-brand-700 hover:text-brand-800 hover:underline font-medium">
      Nota de {noteDate(n)}
    </Link>
  );
}

/** Loading / failed-with-retry / empty — a failed fetch must not look like "nothing recorded". */
export function ListState({ query, empty, children }: { query: PagedList<unknown>; empty: string; children: React.ReactNode }) {
  if (query.isLoading) return <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>;
  if (query.isError) {
    return (
      <div className="text-center py-6">
        <p role="alert" className="text-[13px] text-red-600">Não foi possível carregar a lista.</p>
        <button type="button" onClick={() => query.refetch()} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 mt-1.5">Tentar novamente</button>
      </div>
    );
  }
  if (!query.data?.length) return <p className="text-[13px] text-dim-400 text-center py-6">{empty}</p>;
  return (
    <>
      {children}
      <LoadMore list={query} />
    </>
  );
}
