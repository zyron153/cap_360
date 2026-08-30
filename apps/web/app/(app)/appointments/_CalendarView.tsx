"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import ptLocale from "@fullcalendar/core/locales/pt";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  editable?: boolean;
  durationEditable?: boolean;
};

export default function CalendarView({
  events,
  onEventClick,
  onDateClick,
  onEventDrop,
}: {
  events: CalendarEvent[];
  onEventClick: (id: string) => void;
  onDateClick: (dateStr: string, isTimeGrid: boolean) => void;
  onEventDrop: (id: string, newStart: Date, revert: () => void) => void;
}) {
  return (
    <div className="p-5 [&_.fc]:font-sans [&_.fc]:text-[13px] [&_.fc-button]:!bg-brand-600 [&_.fc-button]:!border-brand-600 [&_.fc-button]:!text-white [&_.fc-button:hover]:!bg-brand-700 [&_.fc-button-active]:!bg-brand-700 [&_.fc-today-button]:!bg-dim-100 [&_.fc-today-button]:!border-dim-200 [&_.fc-today-button]:!text-dim-700 [&_.fc-today-button:hover]:!bg-dim-200 [&_.fc-daygrid-day.fc-day-today]:!bg-brand-50 [&_.fc-timegrid-col.fc-day-today]:!bg-brand-50/40 [&_.fc-col-header-cell-cushion]:!text-dim-700 [&_.fc-col-header-cell-cushion]:!font-semibold [&_.fc-daygrid-day-number]:!text-dim-600 [&_.fc-event]:!rounded-lg [&_.fc-event]:!text-xs [&_.fc-toolbar-title]:!text-dim-900 [&_.fc-toolbar-title]:!font-bold [&_.fc-toolbar-title]:!text-[17px] [&_.fc-toolbar-title]:!font-display">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
        locale={ptLocale}
        events={events}
        slotMinTime="07:00:00"
        slotMaxTime="20:00:00"
        slotDuration="00:30:00"
        allDaySlot={false}
        height="auto"
        // Dragging moves an appointment (reschedule); resizing would mean changing its duration,
        // which the backend's reschedule endpoint has no concept of — so only start is editable.
        eventStartEditable
        eventDurationEditable={false}
        eventClick={(info) => onEventClick(info.event.id)}
        dateClick={(info) => onDateClick(info.dateStr, info.view.type.startsWith("timeGrid"))}
        eventDrop={(info) => onEventDrop(info.event.id, info.event.start!, info.revert)}
      />
    </div>
  );
}
