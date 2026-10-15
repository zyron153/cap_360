"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Modal } from "../../../components/ui/modal";
import { useMessage } from "../../../components/ui/message-handler";
import { Field } from "../../../components/ui/field";
import { usePermissions } from "../hooks/use-permissions";
import type { CalendarEvent } from "../appointments/_CalendarView";
import type { StaffShiftEntry } from "@cap/types";

const CalendarView = dynamic(() => import("../appointments/_CalendarView"), {
  ssr: false,
  loading: () => <div className="p-10 text-center text-[13px] text-dim-400">A carregar calendário…</div>,
});

type Doctor = { id: string; fullName: string; role: string };
type StaffDetail = { id: string; fullName: string; availability: { dayOfWeek: number; startTime: string; endTime: string }[] };

const inputCls = "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all";

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Draft = { id: string | null; shiftDate: string; startTime: string; endTime: string; notes: string };

export default function ShiftPlanner() {
  const { me, isAdmin } = usePermissions();
  const { addMessage } = useMessage();
  const queryClient = useQueryClient();

  const [pickedStaffId, setPickedStaffId] = useState("");
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: staffList = [] } = useQuery<Doctor[]>({
    queryKey: ["staff-list"],
    queryFn: () => fetch("/api/staff").then((r) => r.json()),
    staleTime: 60_000,
  });
  const doctors = staffList.filter((s) => s.role === "doctor");

  const isSelfView = me?.role === "doctor";
  const staffId = isSelfView ? me!.id : pickedStaffId || doctors[0]?.id || "";

  const { data: staffDetail } = useQuery<StaffDetail>({
    queryKey: ["staff-detail", staffId],
    queryFn: () => fetch(`/api/staff/${staffId}`).then((r) => r.json()),
    enabled: !!staffId,
  });

  const from = range ? fmtDate(range.start) : "";
  const to = range ? fmtDate(new Date(range.end.getTime() - 86_400_000)) : "";

  const { data: shifts = [] } = useQuery<StaffShiftEntry[]>({
    queryKey: ["staff-shifts", staffId, from, to],
    queryFn: () => fetch(`/api/staff/${staffId}/shifts?from=${from}&to=${to}`).then((r) => (r.ok ? r.json() : [])),
    enabled: !!staffId && !!from,
  });
  const shiftsByDate = useMemo(() => new Map(shifts.map((s) => [s.shiftDate.slice(0, 10), s])), [shifts]);

  const events = useMemo(() => {
    const out: CalendarEvent[] = [];

    // Weekly template, projected onto real dates — skipped for any day that has a shift
    // override, so the two bands never overlap and confuse which one is actually in effect.
    if (range && staffDetail) {
      const cursor = new Date(range.start);
      while (cursor < range.end) {
        const dateStr = fmtDate(cursor);
        if (!shiftsByDate.has(dateStr)) {
          for (const a of staffDetail.availability.filter((row) => row.dayOfWeek === cursor.getDay())) {
            out.push({
              id: `avail-${dateStr}-${a.startTime}`,
              start: `${dateStr}T${a.startTime}:00`,
              end: `${dateStr}T${a.endTime}:00`,
              display: "background",
              backgroundColor: "rgba(19,163,163,0.10)",
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    for (const s of shifts) {
      const dateStr = s.shiftDate.slice(0, 10);
      out.push({
        id: `shift-${s.id}`,
        title: `Turno ${s.startTime}–${s.endTime}`,
        start: `${dateStr}T${s.startTime}:00`,
        end: `${dateStr}T${s.endTime}:00`,
        backgroundColor: "#F59E0B",
        borderColor: "#D97706",
        textColor: "#ffffff",
      });
    }

    return out;
  }, [range, staffDetail, shifts, shiftsByDate]);

  const canManage = isAdmin;

  const upsertMut = useMutation({
    mutationFn: (d: Draft) =>
      fetch(`/api/staff/${staffId}/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftDate: d.shiftDate, startTime: d.startTime, endTime: d.endTime, notes: d.notes || undefined }),
      }).then(async (r) => {
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message ?? "Erro ao definir turno"); }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-shifts", staffId] });
      addMessage("Success", "Turno definido com sucesso!");
      setDraft(null);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/staff/shifts/${id}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error("Erro ao remover turno");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-shifts", staffId] });
      addMessage("Success", "Turno removido — volta a aplicar-se o horário semanal.");
      setDraft(null);
    },
    onError: (e: Error) => addMessage("Error", e.message),
  });

  function openDraftForDate(dateStr: string, start?: Date, end?: Date) {
    if (!canManage) return;
    const existing = shiftsByDate.get(dateStr);
    setDraft({
      id: existing?.id ?? null,
      shiftDate: dateStr,
      startTime: existing?.startTime ?? (start ? fmtTime(start) : "09:00"),
      endTime: existing?.endTime ?? (end ? fmtTime(end) : "18:00"),
      notes: existing?.notes ?? "",
    });
  }

  function handleDateClick(dateStr: string, isTimeGrid: boolean) {
    openDraftForDate(isTimeGrid ? dateStr.slice(0, 10) : dateStr);
  }

  function handleSelect(start: Date, end: Date) {
    openDraftForDate(fmtDate(start), start, end);
  }

  function handleEventClick(id: string) {
    if (!id.startsWith("shift-")) return;
    const shift = shifts.find((s) => s.id === id.replace("shift-", ""));
    if (shift) openDraftForDate(shift.shiftDate.slice(0, 10));
  }

  // Dragging a shift block to a different day, or resizing its end edge, is the same "assign a
  // turno" action as the modal — just expressed as a gesture instead of a form. Both go through
  // the same upsert; the old date's row is left behind as an orphan only if the drag also fails
  // (in which case revert() puts the calendar back and nothing was ever sent).
  function handleEventDrop(id: string, newStart: Date, revert: () => void) {
    if (!id.startsWith("shift-") || !canManage) { revert(); return; }
    const shift = shifts.find((s) => s.id === id.replace("shift-", ""));
    if (!shift) { revert(); return; }
    const oldDate = shift.shiftDate.slice(0, 10);
    const newDate = fmtDate(newStart);
    upsertMut.mutate(
      { id: shift.id, shiftDate: newDate, startTime: shift.startTime, endTime: shift.endTime, notes: shift.notes ?? "" },
      { onError: () => revert() },
    );
    if (newDate !== oldDate) removeMut.mutate(shift.id);
  }

  function handleEventResize(id: string, newStart: Date, newEnd: Date, revert: () => void) {
    if (!id.startsWith("shift-") || !canManage) { revert(); return; }
    const shift = shifts.find((s) => s.id === id.replace("shift-", ""));
    if (!shift) { revert(); return; }
    upsertMut.mutate(
      { id: shift.id, shiftDate: fmtDate(newStart), startTime: fmtTime(newStart), endTime: fmtTime(newEnd), notes: shift.notes ?? "" },
      { onError: () => revert() },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {isSelfView ? (
          <span className="text-[13px] font-semibold text-dim-800">Os seus turnos — {me?.fullName}</span>
        ) : (
          <select value={staffId} onChange={(e) => setPickedStaffId(e.target.value)} className={`${inputCls} w-56`}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        )}
        {canManage && (
          <p className="text-[11px] text-dim-400">Arraste na grelha para definir um turno · clique num turno para editar ou remover</p>
        )}
      </div>

      {!staffId ? (
        <p className="text-[13px] text-dim-400 py-10 text-center">Sem médicos configurados.</p>
      ) : (
        <div className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
          <CalendarView
            events={events}
            editable={canManage}
            durationEditable={canManage}
            selectable={canManage}
            onEventClick={handleEventClick}
            onDateClick={handleDateClick}
            onSelect={handleSelect}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onDatesSet={(start, end) => setRange({ start, end })}
          />
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Editar Turno" : "Definir Turno"}
        description={draft ? new Date(`${draft.shiftDate}T00:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" }) : undefined}
        size="sm"
      >
        {draft && (
          <>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Início" required>
                  <input type="time" value={draft.startTime} onChange={(e) => setDraft((d) => d && { ...d, startTime: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Fim" required>
                  <input type="time" value={draft.endTime} onChange={(e) => setDraft((d) => d && { ...d, endTime: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <Field label="Notas">
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => d && { ...d, notes: e.target.value })}
                  rows={2}
                  placeholder="Opcional"
                  className={`${inputCls} resize-none`}
                />
              </Field>
              {draft.endTime <= draft.startTime && (
                <p className="text-[11px] text-red-600">A hora de fim deve ser depois da hora de início.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-dim-100 flex items-center gap-3">
              <button
                onClick={() => upsertMut.mutate(draft)}
                disabled={draft.endTime <= draft.startTime || upsertMut.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] transition-colors"
              >
                {upsertMut.isPending ? "A guardar…" : "Guardar"}
              </button>
              {draft.id && (
                <button
                  onClick={() => removeMut.mutate(draft.id!)}
                  disabled={removeMut.isPending}
                  className="flex items-center gap-1.5 text-red-600 hover:text-red-700 disabled:opacity-50 font-semibold px-3 py-2.5 rounded-[10px] text-[13px] transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remover
                </button>
              )}
              <button onClick={() => setDraft(null)} className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors ml-auto">
                Cancelar
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
