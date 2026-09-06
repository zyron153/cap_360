"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { StickyNote, Paperclip, Plus, FileText, Download } from "lucide-react";
import { useMessage } from "@/components/ui/message-handler";

interface NoteEntry {
  id: string;
  content: string;
  createdAt: string;
  staffAuthor: { id: string; fullName: string } | null;
}

interface DocEntry {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  national_id: "Bilhete de Identidade",
  consent_form: "Consentimento",
  exam_result: "Resultado de Exame",
  prescription: "Receita",
  referral: "Referenciação",
  other: "Outro",
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";
const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)]";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro ao carregar");
  return res.json();
}

export function PatientRecordsPanel({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<"notes" | "documents">("notes");
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();

  const notesQ = useQuery({
    queryKey: ["patient-notes", patientId],
    queryFn: () => fetchJson<NoteEntry[]>(`/api/patients/${patientId}/notes`),
  });
  const docsQ = useQuery({
    queryKey: ["patient-documents", patientId],
    queryFn: () => fetchJson<DocEntry[]>(`/api/patients/${patientId}/documents`),
    enabled: tab === "documents",
  });

  const [newNote, setNewNote] = useState("");
  const addNoteMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao adicionar nota"); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-notes", patientId] });
      setNewNote("");
      addMessage("Success", "Nota adicionada.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("other");
  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", docType);
      const res = await fetch(`/api/patients/${patientId}/documents`, { method: "POST", body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao enviar documento"); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      addMessage("Success", "Documento enviado.");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  async function downloadDoc(id: string, fileName: string) {
    const res = await fetch(`/api/documents/${id}/download-url`);
    if (!res.ok) { addMessage("Error", `Erro ao obter ${fileName}`); return; }
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const notes = notesQ.data ?? [];
  const docs = docsQ.data ?? [];

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-dim-100">
        <div className="flex items-center gap-1.5 bg-dim-100 rounded-[10px] p-1">
          {([
            ["notes", "Notas", StickyNote],
            ["documents", "Documentos", FileText],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${tab === key ? "bg-white text-dim-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-dim-500 hover:text-dim-700"}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        {tab === "documents" && (
          <div className="flex items-center gap-2">
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="text-[12px] border border-dim-200 rounded-[8px] px-2 py-1.5 bg-white focus:outline-none focus:border-brand-500">
              {Object.entries(DOC_TYPE_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadMut.isPending}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors disabled:opacity-60"
            >
              <Paperclip className="w-3.5 h-3.5" /> {uploadMut.isPending ? "A enviar…" : "Enviar"}
            </button>
          </div>
        )}
      </div>

      <div className="px-6 py-5">
        {tab === "notes" && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Escrever uma nota…"
                rows={2}
                maxLength={2000}
                className={`${inputCls} resize-none`}
              />
              <button
                onClick={() => addNoteMut.mutate()}
                disabled={!newNote.trim() || addNoteMut.isPending}
                className="shrink-0 self-start flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2.5 rounded-[10px] transition-colors disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar
              </button>
            </div>

            {notesQ.isLoading ? (
              <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
            ) : notes.length === 0 ? (
              <p className="text-[13px] text-dim-400 text-center py-6">Ainda sem notas.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {notes.map((n) => (
                  <div key={n.id} className="px-4 py-3 rounded-[10px] border border-dim-100">
                    <p className="text-[13px] text-dim-800 whitespace-pre-wrap">{n.content}</p>
                    <p className="text-[11px] text-dim-500 mt-1.5">{n.staffAuthor?.fullName ?? "—"} · {format(new Date(n.createdAt), "d MMM yyyy, HH:mm", { locale: pt })}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "documents" && (
          docsQ.isLoading ? (
            <p className="text-[13px] text-dim-400 text-center py-6">A carregar…</p>
          ) : docs.length === 0 ? (
            <p className="text-[13px] text-dim-400 text-center py-6">Ainda sem documentos.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {docs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => downloadDoc(d.id, d.fileName)}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-[10px] border border-dim-100 hover:border-brand-300 hover:bg-dim-50 transition-colors text-left"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <FileText className="w-4 h-4 text-dim-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-dim-900 truncate">{d.fileName}</p>
                      <p className="text-[11px] text-dim-500 mt-0.5">{DOC_TYPE_LABEL[d.type] ?? d.type} · {formatSize(d.sizeBytes)} · {format(new Date(d.createdAt), "d MMM yyyy", { locale: pt })}</p>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
