"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Lock } from "lucide-react";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { usePermissions } from "../hooks/use-permissions";
import type { CalendarEvent } from "../appointments/_CalendarView";

const CalendarView = dynamic(() => import("../appointments/_CalendarView"), {
  ssr: false,
  loading: () => <div className="p-10 text-center text-[13px] text-dim-400">A carregar calendário…</div>,
});

type Doctor = { id: string; fullName: string; role: string };
type StaffDetail = { id: string; fullName: string; availability: { dayOfWeek: number; startTime: string; endTime: string }[] };
type Appt = { id: string; scheduledAt: string; durationMinutes: number; status: string; patient: { fullName: string }; service: { name: string } };
type Block = { id: string; startDate: string; endDate: string; reason: string | null; status: string };

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B", confirmed: "#13A3A3", checked_in: "#8B5CF6",
  completed: "#10B981", cancelled: "#8E8EA8", no_show: "#EF4444",
};

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// JS Date#getDay() is 0=Sunday..6=Saturday, matching this app's other weekday conventions.
function endOfThisWeek() {
  const d = new Date();
  d.setDate(d.getDate() + (6 - d.getDay()));
  return d;
}

export default function AvailabilityCalendar() {
  const { me, isAdmin } = usePermissions();
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();

  const [pickedStaffId, setPickedStaffId] = useState("");
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState({ startDate: "", endDate: "", reason: "" });

  const { data: staffList = [] } = useQuery<Doctor[]>({
    queryKey: ["staff-list"],
    queryFn: () => fetch("/api/staff").then((r) => r.json()),
    staleTime: 60_000,
  });
  const doctors = staffList.filter((s) => s.role === "doctor");

  // A doctor always sees their own calendar, no picker — everyone else picks from the list.
  const isSelfView = me?.role === "doctor";
  const staffId = isSelfView ? me!.id : pickedStaffId || doctors[0]?.id || "";
  const canManage = isAdmin || (isSelfView && !!me);

  const { data: staffDetail } = useQuery<StaffDetail>({
    queryKey: ["staff-detail", staffId],
    queryFn: () => fetch(`/api/staff/${staffId}`).then((r) => r.json()),
    enabled: !!staffId,
  });

  const from = range ? fmtDate(range.start) : "";
  const to = range ? fmtDate(new Date(range.end.getTime() - 86_400_000)) : "";

  const { data: appts = [] } = useQuery<Appt[]>({
    queryKey: ["staff-calendar-appts", staffId, from, to],
    queryFn: () => fetch(`/api/appointments?from=${from}&to=${to}&staffId=${staffId}`).then((r) => r.json()),
    enabled: !!staffId && !!from,
  });

  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ["staff-blocks", staffId],
    queryFn: () => fetch(`/api/staff/${staffId}/leave-requests`).then((r) => (r.ok ? r.json() : [])),
    enabled: !!staffId,
  });
  const approvedBlocks = blocks.filter((b) => b.status === "approved");

  function isBlocked(dateStr: string) {
    return approvedBlocks.some((b) => dateStr >= b.startDate.slice(0, 10) && dateStr <= b.endDate.slice(0, 10));
  }

  // Background/foreground events merged from three independent sources: the recurring
  // StaffAvailability pattern projected onto the visible week's real dates, approved blocks
  // (shown as a day-spanning warning wash, not removed from the calendar), and real bookings
  // (flagged, not hidden, when they land inside a block — per the "leave them untouched, just
  // flag them" decision, blocking never auto-cancels anything).
  const events = useMemo(() => {
    const out: CalendarEvent[] = [];

    if (range && staffDetail) {
      const cursor = new Date(range.start);
      while (cursor < range.end) {
        const dateStr = fmtDate(cursor);
        for (const a of staffDetail.availability.filter((row) => row.dayOfWeek === cursor.getDay())) {
          out.push({
            id: `avail-${dateStr}-${a.startTime}`,
            start: `${dateStr}T${a.startTime}:00`,
            end: `${dateStr}T${a.endTime}:00`,
            display: "background",
            backgroundColor: "rgba(19,163,163,0.10)",
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    for (const b of approvedBlocks) {
      out.push({
        id: `block-${b.id}`,
        start: `${b.startDate.slice(0, 10)}T00:00:00`,
        end: `${fmtDate(new Date(new Date(b.endDate).getTime() + 86_400_000))}T00:00:00`,
        display: "background",
        backgroundColor: "rgba(239,68,68,0.16)",
      });
    }

    for (const a of appts) {
      const flagged = isBlocked(a.scheduledAt.slice(0, 10));
      out.push({
        id: a.id,
        title: `${flagged ? "⚠ " : ""}${a.patient.fullName} — ${a.service.name}`,
        start: a.scheduledAt,
        end: new Date(new Date(a.scheduledAt).getTime() + a.durationMinutes * 60_000).toISOString(),
        backgroundColor: STATUS_COLORS[a.status] ?? "#8E8EA8",
        borderColor: flagged ? "#EF4444" : "transparent",
        textColor: "#ffffff",
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, staffDetail, appts, approvedBlocks]);

  const blockMut = useMutation({
    mutationFn: (body: { startDate: string; endDate: string; reason?: string }) =>
      fetch(`/api/staff/${staffId}/availability-blocks`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao bloquear agenda"); }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-blocks", staffId] });
      addMessage("Success", "Agenda bloqueada.");
      setBlockOpen(false);
      setBlockForm({ startDate: "", endDate: "", reason: "" });
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const removeBlockMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/staff/leave-requests/${id}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error("Erro ao remover bloqueio");
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-blocks", staffId] });
      addMessage("Success", "Bloqueio removido.");
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  function blockRestOfWeek() {
    if (!confirm("Bloquear toda a disponibilidade a partir de hoje até ao fim desta semana?")) return;
    blockMut.mutate({ startDate: fmtDate(new Date()), endDate: fmtDate(endOfThisWeek()) });
  }

  function handleEventClick(id: string) {
    if (!id.startsWith("block-") || !canManage) return;
    if (confirm("Remover este bloqueio?")) removeBlockMut.mutate(id.replace("block-", ""));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {isSelfView ? (
            <span className="text-[13px] font-semibold text-dim-800">A sua agenda — {me?.fullName}</span>
          ) : (
            <select
              value={staffId}
              onChange={(e) => setPickedStaffId(e.target.value)}
              className={`${inputCls} w-56`}
            >
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          )}
        </div>
        {canManage && staffId && (
          <div className="flex items-center gap-2">
            <button
              onClick={blockRestOfWeek}
              disabled={blockMut.isPending}
              className="flex items-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 text-[12px] font-semibold px-3 py-2 rounded-[10px] transition-colors"
            >
              <Ban className="w-3.5 h-3.5" /> Bloquear resto da semana
            </button>
            <button
              onClick={() => setBlockOpen(true)}
              className="flex items-center gap-1.5 bg-dim-800 hover:bg-dim-900 text-white text-[12px] font-semibold px-3 py-2 rounded-[10px] transition-colors"
            >
              <Lock className="w-3.5 h-3.5" /> Bloquear Agenda
            </button>
          </div>
        )}
      </div>

      {!staffId ? (
        <p className="text-[13px] text-dim-400 py-10 text-center">Sem médicos configurados.</p>
      ) : (
        <div className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
          <CalendarView
            events={events}
            editable={false}
            onEventClick={handleEventClick}
            onDateClick={() => {}}
            onDatesSet={(start, end) => setRange({ start, end })}
          />
        </div>
      )}

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="Bloquear Agenda" description="Impede novas marcações neste período — não cancela as já existentes" size="sm">
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="De" required>
              <input type="date" value={blockForm.startDate} onChange={(e) => setBlockForm((f) => ({ ...f, startDate: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Até" required>
              <input type="date" value={blockForm.endDate} onChange={(e) => setBlockForm((f) => ({ ...f, endDate: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          <Field label="Motivo">
            <textarea value={blockForm.reason} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} rows={2} className={`${inputCls} resize-none`} placeholder="Opcional" />
          </Field>
        </div>
        <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
          <button
            onClick={() => blockMut.mutate({ startDate: blockForm.startDate, endDate: blockForm.endDate, reason: blockForm.reason || undefined })}
            disabled={!blockForm.startDate || !blockForm.endDate || blockForm.endDate < blockForm.startDate || blockMut.isPending}
            className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
          >
            {blockMut.isPending ? "A bloquear…" : "Bloquear"}
          </button>
          <button onClick={() => setBlockOpen(false)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors">
            Cancelar
          </button>
        </div>
      </Modal>
    </div>
  );
}
