"use client";

import { useState } from "react";
import { Search, Send, Phone, MoreVertical, Check, CheckCheck, MessageCircle } from "lucide-react";

type Message = {
  id: string;
  body: string;
  from: "clinic" | "patient";
  time: string;
  status: "sent" | "delivered" | "read";
};

type Conversation = {
  id: string;
  name: string;
  phone: string;
  lastMessage: string;
  time: string;
  unread: number;
  tag: "appointment" | "result" | "billing" | "general";
  messages: Message[];
};

const TAG_STYLE: Record<string, string> = {
  appointment: "bg-brand-50 text-brand-700",
  result:      "bg-violet-50 text-violet-700",
  billing:     "bg-amber-50 text-amber-700",
  general:     "bg-dim-100 text-dim-500",
};

const TAG_LABEL: Record<string, string> = {
  appointment: "Consulta",
  result:      "Resultado",
  billing:     "Financeiro",
  general:     "Geral",
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "1", name: "Maria da Graça", phone: "+238 991 2345",
    lastMessage: "Sim, confirmo a consulta para amanhã às 10h",
    time: "14:32", unread: 2, tag: "appointment",
    messages: [
      { id: "m1", body: "Olá Maria! Lembramos que tem consulta amanhã às 10h00 com a Dra. Fátima.", from: "clinic", time: "09:15", status: "read" },
      { id: "m2", body: "Obrigada pelo lembrete!", from: "patient", time: "09:22", status: "read" },
      { id: "m3", body: "Sim, confirmo a consulta para amanhã às 10h", from: "patient", time: "14:32", status: "delivered" },
    ],
  },
  {
    id: "2", name: "João Monteiro", phone: "+238 997 8765",
    lastMessage: "Obrigado! Até amanhã.",
    time: "11:15", unread: 0, tag: "appointment",
    messages: [
      { id: "m1", body: "Bom dia João! Os resultados dos seus exames já estão disponíveis.", from: "clinic", time: "10:00", status: "read" },
      { id: "m2", body: "Obrigado! Até amanhã.", from: "patient", time: "11:15", status: "read" },
    ],
  },
  {
    id: "3", name: "Ana Lopes", phone: "+238 993 4561",
    lastMessage: "Os resultados chegaram à clínica. Pode levantar.",
    time: "10:47", unread: 0, tag: "result",
    messages: [
      { id: "m1", body: "Os resultados chegaram à clínica. Pode levantar.", from: "clinic", time: "10:47", status: "read" },
    ],
  },
  {
    id: "4", name: "Carlos Évora", phone: "+238 996 1122",
    lastMessage: "Por favor confirme a hora da consulta",
    time: "Ontem", unread: 1, tag: "appointment",
    messages: [
      { id: "m1", body: "Bom dia! Qual é a hora da minha consulta de amanhã?", from: "patient", time: "16:05", status: "read" },
      { id: "m2", body: "Por favor confirme a hora da consulta", from: "patient", time: "16:30", status: "delivered" },
    ],
  },
  {
    id: "5", name: "Luísa Fonseca", phone: "+238 992 7788",
    lastMessage: "A fatura foi enviada por email.",
    time: "Seg", unread: 0, tag: "billing",
    messages: [
      { id: "m1", body: "Luísa, a sua fatura de Maio já foi emitida.", from: "clinic", time: "09:00", status: "read" },
      { id: "m2", body: "A fatura foi enviada por email.", from: "clinic", time: "09:01", status: "read" },
    ],
  },
  {
    id: "6", name: "Pedro Tavares", phone: "+238 998 3344",
    lastMessage: "Obrigado pela atenção.",
    time: "Sex", unread: 0, tag: "general",
    messages: [
      { id: "m1", body: "Obrigado pela atenção.", from: "patient", time: "15:20", status: "read" },
    ],
  },
  {
    id: "7", name: "Rosa Brito", phone: "+238 991 9900",
    lastMessage: "Consulta remarcada para 20 de Junho às 14h.",
    time: "Qui", unread: 0, tag: "appointment",
    messages: [
      { id: "m1", body: "Consulta remarcada para 20 de Junho às 14h.", from: "clinic", time: "11:00", status: "read" },
    ],
  },
];

export default function WhatsAppPage() {
  const [selectedId, setSelectedId] = useState<string>(CONVERSATIONS[0].id);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");

  const filtered = CONVERSATIONS.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  const selected = CONVERSATIONS.find((c) => c.id === selectedId)!;

  return (
    <div
      className="flex rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden bg-white"
      style={{ height: "calc(100vh - 60px - 48px)" }}
    >
      {/* Left: conversation list */}
      <div className="w-[300px] shrink-0 border-r border-dim-100 flex flex-col bg-white">
        {/* Header */}
        <div className="px-4 py-4 border-b border-dim-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-[15px] font-semibold text-dim-900">WhatsApp Hub</h2>
            <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/[0.15] text-amber-500">
              {CONVERSATIONS.reduce((s, c) => s + c.unread, 0)} não lidos
            </span>
          </div>
          <div className="flex items-center gap-2 bg-dim-100 rounded-[10px] px-3 py-2">
            <Search className="w-3.5 h-3.5 text-dim-400 shrink-0" />
            <input
              type="text"
              placeholder="Pesquisar conversa…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-[12px] text-dim-800 w-full outline-none placeholder:text-dim-400 font-sans"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedId(conv.id)}
              className={`w-full text-left px-4 py-3 border-b border-dim-50 transition-colors ${
                selectedId === conv.id ? "bg-brand-50" : "hover:bg-dim-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-dim-200 text-dim-600 font-semibold text-[12px] flex items-center justify-center shrink-0">
                  {conv.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[13px] font-semibold text-dim-900 truncate">{conv.name}</span>
                    <span className="text-[10px] text-dim-400 shrink-0 font-mono">{conv.time}</span>
                  </div>
                  <p className="text-[11px] text-dim-500 truncate mt-0.5">{conv.lastMessage}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${TAG_STYLE[conv.tag]}`}>
                      {TAG_LABEL[conv.tag]}
                    </span>
                    {conv.unread > 0 && (
                      <span className="ml-auto w-4 h-4 rounded-full bg-brand-600 text-white text-[9px] font-bold flex items-center justify-center">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: chat window */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="px-5 py-3.5 border-b border-dim-100 flex items-center gap-3 bg-white">
          <div className="w-9 h-9 rounded-full bg-dim-200 text-dim-600 font-semibold text-[12px] flex items-center justify-center shrink-0">
            {selected.name[0]}
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-dim-900">{selected.name}</p>
            <p className="font-mono text-[11px] text-dim-400">{selected.phone}</p>
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TAG_STYLE[selected.tag]}`}>
              {TAG_LABEL[selected.tag]}
            </span>
            <button className="w-8 h-8 rounded-md flex items-center justify-center text-dim-400 hover:bg-dim-100 transition-colors">
              <Phone className="w-4 h-4" />
            </button>
            <button className="w-8 h-8 rounded-md flex items-center justify-center text-dim-400 hover:bg-dim-100 transition-colors">
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 bg-dim-50">
          {selected.messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 bg-dim-200 rounded-full flex items-center justify-center mx-auto mb-3">
                  <MessageCircle className="w-6 h-6 text-dim-400" />
                </div>
                <p className="text-[13px] text-dim-500">Sem mensagens ainda</p>
              </div>
            </div>
          ) : (
            selected.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.from === "clinic" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] px-3.5 py-2.5 rounded-[14px] ${
                    msg.from === "clinic"
                      ? "bg-brand-700 text-white rounded-tr-[4px]"
                      : "bg-white border border-dim-200 text-dim-900 rounded-tl-[4px]"
                  }`}
                >
                  <p className="text-[13px] leading-relaxed">{msg.body}</p>
                  <div className={`flex items-center gap-1 mt-1 ${msg.from === "clinic" ? "justify-end" : "justify-start"}`}>
                    <span className={`font-mono text-[10px] ${msg.from === "clinic" ? "text-brand-200" : "text-dim-400"}`}>
                      {msg.time}
                    </span>
                    {msg.from === "clinic" && (
                      msg.status === "read"
                        ? <CheckCheck className="w-3 h-3 text-brand-200" />
                        : msg.status === "delivered"
                        ? <CheckCheck className="w-3 h-3 text-brand-400" />
                        : <Check className="w-3 h-3 text-brand-400" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-dim-100 bg-white flex items-end gap-3">
          <div className="flex-1 bg-dim-50 border border-dim-200 rounded-[12px] px-3.5 py-2.5 focus-within:border-brand-500 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(19,163,163,.1)] transition-all">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escreva uma mensagem…"
              rows={1}
              className="w-full bg-transparent text-[13px] text-dim-900 placeholder:text-dim-400 outline-none resize-none font-sans"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setDraft(""); }
              }}
            />
          </div>
          <button
            onClick={() => setDraft("")}
            disabled={!draft.trim()}
            className="w-9 h-9 rounded-[10px] bg-brand-700 hover:bg-brand-800 text-white flex items-center justify-center disabled:opacity-40 transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
