"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { format, isToday } from "date-fns";
import { Search, Send, Check, CheckCheck, MessageCircle, AlertCircle, UserPlus, CheckCircle2, Plus } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";
import { Modal } from "@/components/ui/modal";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type Person = { id: string; fullName: string | null };
type ConversationSummary = {
  id: string;
  phone: string;
  status: "open" | "resolved";
  unreadCount: number;
  lastMessageAt: string;
  windowExpiresAt: string | null;
  patient: Person | null;
  assignedTo: Person | null;
  lastMessage: { direction: string; body: string } | null;
};
type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  createdAt: string;
  sentBy: Person | null;
};
type ConversationDetail = Omit<ConversationSummary, "lastMessage"> & { messages: Message[] };

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all placeholder:text-dim-400";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(Array.isArray(err.message) ? "Pedido inválido" : (err.message ?? "Erro no pedido"));
  }
  return res.json();
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const patch = (body?: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

const displayName = (c: { phone: string; patient: Person | null }) => c.patient?.fullName ?? c.phone;
const isWindowOpen = (c: { windowExpiresAt: string | null }) => !!c.windowExpiresAt && new Date(c.windowExpiresAt) > new Date();
const shortTime = (iso: string) => (isToday(new Date(iso)) ? format(new Date(iso), "HH:mm") : format(new Date(iso), "dd/MM"));

function Ticks({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle className="w-3 h-3 text-red-300" aria-label="Falhou" />;
  if (status === "read") return <CheckCheck className="w-3 h-3 text-sky-300" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="w-3 h-3 text-brand-200" aria-label="Entregue" />;
  return <Check className="w-3 h-3 text-brand-200" aria-label="Enviada" />;
}

function LinkPatientModal({ conversationId, onClose, onLinked }: { conversationId: string; onClose: () => void; onLinked: () => void }) {
  const { addMessage } = useMessage();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);

  const { data: results = [], isFetching } = useQuery<{ id: string; fullName: string; phone: string }[]>({
    queryKey: ["patient-search", debounced],
    queryFn: async () => (await api<{ data: never[] }>(`/api/patients?${new URLSearchParams({ page: "1", limit: "10", q: debounced })}`)).data ?? [],
    enabled: debounced.length >= 2,
  });

  const link = useMutation({
    mutationFn: (patientId: string) => api(`/api/whatsapp/conversations/${conversationId}/link-patient`, patch({ patientId })),
    onSuccess: () => { addMessage("Success", "Paciente associado."); onLinked(); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  return (
    <Modal open onClose={onClose} title="Associar paciente" description="Pesquise o paciente a quem pertence este número">
      <div className="p-5 flex flex-col gap-3">
        <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, telefone ou NIF…" className={inputCls} />
        <div className="max-h-64 overflow-y-auto divide-y divide-dim-100">
          {debounced.length < 2 ? (
            <p className="text-[12px] text-dim-400 text-center py-6">Escreva pelo menos 2 caracteres.</p>
          ) : isFetching ? (
            <p className="text-[12px] text-dim-400 text-center py-6">A pesquisar…</p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-dim-400 text-center py-6">Nenhum paciente encontrado.</p>
          ) : (
            results.map((p) => (
              <button key={p.id} onClick={() => link.mutate(p.id)} disabled={link.isPending} className="w-full flex items-center justify-between py-2.5 px-2 rounded-[8px] hover:bg-dim-50 text-left disabled:opacity-50">
                <span>
                  <span className="block text-[13px] font-medium text-dim-900">{p.fullName}</span>
                  <span className="block text-[11px] text-dim-400 font-mono">{p.phone}</span>
                </span>
                <Plus className="w-3.5 h-3.5 text-brand-600" />
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { addMessage } = useMessage();
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved">("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [linking, setLinking] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: ["whatsapp", "conversations", statusFilter],
    queryFn: () => api<{ data: ConversationSummary[] }>(`/api/whatsapp/conversations?status=${statusFilter}&limit=100`),
    refetchInterval: 60_000,
  });
  const conversations = (list.data?.data ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    return !q || displayName(c).toLowerCase().includes(q) || c.phone.includes(q);
  });

  const detail = useQuery({
    queryKey: ["whatsapp", "conversation", selectedId],
    queryFn: () => api<ConversationDetail>(`/api/whatsapp/conversations/${selectedId}`),
    enabled: !!selectedId,
  });
  const conv = detail.data;

  const staff = useQuery({
    queryKey: ["staff-list"],
    queryFn: async () => {
      const res = await api<Person[] | { data: Person[] }>("/api/staff");
      return Array.isArray(res) ? res : res.data;
    },
    staleTime: 5 * 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["whatsapp"] });

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const socket = io(`${apiUrl}/whatsapp`, { path: "/socket.io", reconnectionAttempts: 3 });
    socket.on("whatsapp:updated", () => queryClient.invalidateQueries({ queryKey: ["whatsapp"] }));
    return () => { socket.disconnect(); };
  }, [queryClient]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [conv?.messages.length, selectedId]);

  const send = useMutation({
    mutationFn: (body: string) => api(`/api/whatsapp/conversations/${selectedId}/messages`, json({ body, idempotencyKey: idempotencyKey.current })),
    onSuccess: () => { setDraft(""); idempotencyKey.current = crypto.randomUUID(); refresh(); },
    onError: (e: Error) => { addMessage("Error", e.message); refresh(); },
  });
  const assign = useMutation({
    mutationFn: (staffId: string | null) => api(`/api/whatsapp/conversations/${selectedId}/assign`, patch({ staffId })),
    onSuccess: refresh,
    onError: (e: Error) => addMessage("Error", e.message),
  });
  const resolve = useMutation({
    mutationFn: () => api(`/api/whatsapp/conversations/${selectedId}/resolve`, patch()),
    onSuccess: () => { addMessage("Success", "Conversa resolvida."); setSelectedId(null); refresh(); },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const windowOpen = conv ? isWindowOpen(conv) : false;
  const totalUnread = (list.data?.data ?? []).reduce((s, c) => s + c.unreadCount, 0);

  return (
    <div
      className="flex rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden bg-white"
      style={{ height: "calc(100vh - 60px - 48px)" }}
    >
      {/* Left: conversation list */}
      <div className="w-[320px] shrink-0 border-r border-dim-100 flex flex-col bg-white">
        <div className="px-4 py-4 border-b border-dim-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-[15px] font-semibold text-dim-900">WhatsApp Hub</h2>
            {totalUnread > 0 && (
              <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/[0.15] text-amber-500">{totalUnread} não lidos</span>
            )}
          </div>
          <div className="flex gap-1 mb-3">
            {(["open", "resolved"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setSelectedId(null); }}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${statusFilter === s ? "bg-brand-700 text-white" : "bg-dim-100 text-dim-500 hover:bg-dim-200"}`}
              >
                {s === "open" ? "Abertas" : "Resolvidas"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-dim-100 rounded-[10px] px-3 py-2">
            <Search className="w-3.5 h-3.5 text-dim-400 shrink-0" />
            <input
              type="text"
              placeholder="Pesquisar conversa…"
              aria-label="Pesquisar conversa"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-[12px] text-dim-800 w-full outline-none placeholder:text-dim-400 font-sans"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="p-4 flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-[10px] bg-dim-100 animate-pulse" />)}</div>
          ) : list.error ? (
            <p className="text-[12px] text-red-600 text-center py-10 px-4">Erro ao carregar conversas.</p>
          ) : conversations.length === 0 ? (
            <p className="text-[12px] text-dim-400 text-center py-10 px-4">
              {search ? "Nenhuma conversa corresponde à pesquisa." : statusFilter === "open" ? "Sem conversas abertas." : "Sem conversas resolvidas."}
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-dim-50 transition-colors ${selectedId === c.id ? "bg-brand-50" : "hover:bg-dim-50"}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-dim-200 text-dim-600 font-semibold text-[12px] flex items-center justify-center shrink-0">
                    {displayName(c).replace("+", "")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[13px] font-semibold text-dim-900 truncate">{displayName(c)}</span>
                      <span className="text-[10px] text-dim-400 shrink-0 font-mono">{shortTime(c.lastMessageAt)}</span>
                    </div>
                    <p className="text-[11px] text-dim-500 truncate mt-0.5">
                      {c.lastMessage ? `${c.lastMessage.direction === "outbound" ? "Você: " : ""}${c.lastMessage.body}` : "—"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {!c.patient && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">Sem paciente</span>}
                      {c.assignedTo && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-dim-100 text-dim-500 truncate">{c.assignedTo.fullName}</span>}
                      {c.unreadCount > 0 && (
                        <span className="ml-auto w-4 h-4 rounded-full bg-brand-600 text-white text-[9px] font-bold flex items-center justify-center">{c.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center bg-dim-50">
            <div className="text-center">
              <div className="w-12 h-12 bg-dim-200 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageCircle className="w-6 h-6 text-dim-400" />
              </div>
              <p className="text-[13px] text-dim-500">Selecione uma conversa</p>
            </div>
          </div>
        ) : detail.isLoading || !conv ? (
          <div className="flex-1 flex items-center justify-center bg-dim-50">
            <p className="text-[13px] text-dim-400">{detail.error ? "Erro ao carregar a conversa." : "A carregar…"}</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3.5 border-b border-dim-100 flex items-center gap-3 bg-white">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-dim-900 truncate">{displayName(conv)}</p>
                <p className="font-mono text-[11px] text-dim-400">{conv.phone}</p>
              </div>
              {!conv.patient && (
                <button onClick={() => setLinking(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-dim-200 text-[12px] font-medium text-dim-700 hover:bg-dim-50">
                  <UserPlus className="w-3.5 h-3.5" /> Associar paciente
                </button>
              )}
              <select
                aria-label="Atribuir a"
                value={conv.assignedTo?.id ?? ""}
                onChange={(e) => assign.mutate(e.target.value || null)}
                disabled={assign.isPending}
                className="border border-dim-200 rounded-[8px] px-2.5 py-1.5 text-[12px] text-dim-700 bg-white"
              >
                <option value="">Sem responsável</option>
                {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
              {conv.status === "open" && (
                <button
                  onClick={() => resolve.mutate()}
                  disabled={resolve.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-medium disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 bg-dim-50">
              {conv.messages.map((msg) => {
                const mine = msg.direction === "outbound";
                return (
                  <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] px-3.5 py-2.5 rounded-[14px] ${mine ? "bg-brand-700 text-white rounded-tr-[4px]" : "bg-white border border-dim-200 text-dim-900 rounded-tl-[4px]"}`}>
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                      <div className={`flex items-center gap-1 mt-1 ${mine ? "justify-end" : "justify-start"}`}>
                        {mine && msg.sentBy && <span className="text-[10px] text-brand-200">{msg.sentBy.fullName?.split(" ")[0]} ·</span>}
                        <span className={`font-mono text-[10px] ${mine ? "text-brand-200" : "text-dim-400"}`}>{format(new Date(msg.createdAt), "HH:mm")}</span>
                        {mine && <Ticks status={msg.status} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="px-4 py-3 border-t border-dim-100 bg-white">
              {!windowOpen && (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded-[8px] px-3 py-2 mb-2">
                  A janela de 24h desta conversa está fechada — só é possível responder quando o paciente enviar nova mensagem.
                </p>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1 bg-dim-50 border border-dim-200 rounded-[12px] px-3.5 py-2.5 focus-within:border-brand-500 focus-within:bg-white transition-all">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Escreva uma mensagem…"
                    aria-label="Mensagem"
                    rows={1}
                    disabled={!windowOpen}
                    className="w-full bg-transparent text-[13px] text-dim-900 placeholder:text-dim-400 outline-none resize-none font-sans disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (draft.trim() && windowOpen && !send.isPending) send.mutate(draft.trim());
                      }
                    }}
                  />
                </div>
                <button
                  onClick={() => send.mutate(draft.trim())}
                  disabled={!draft.trim() || !windowOpen || send.isPending}
                  aria-label="Enviar"
                  className="w-9 h-9 rounded-[10px] bg-brand-700 hover:bg-brand-800 text-white flex items-center justify-center disabled:opacity-40 transition-colors shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {linking && selectedId && (
        <LinkPatientModal conversationId={selectedId} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); refresh(); }} />
      )}
    </div>
  );
}
