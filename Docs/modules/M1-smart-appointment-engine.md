# M1 — Smart Appointment Engine

> **Priority:** 🔴 Critical · **Phase:** 1 (Months 1–3)
> **Dependencies:** M2 (Patient CRM), M6 (Billing — check-in), M3 (WhatsApp — reminders)

---

## 1. Overview

The Smart Appointment Engine replaces ad-hoc WhatsApp CTAs with a structured, real-time booking experience. It manages the full lifecycle of every appointment from creation through completion or no-show.

> **Implementation status:** the backend booking engine (availability, conflict detection incl.
> rooms, business-hours/holiday/leave enforcement, reminders, recurring series) is built and
> tested. The embeddable public **widget** described in §2.1 does not exist as a standalone
> embed — a public booking API (`POST /public/bookings`) exists and is used by this app's own
> pages, not packaged for embedding on an external site.

---

## 2. Core Features

### 2.1 Embeddable Booking Widget
- Standalone React component embeddable on maissaudecv.com via `<script>` tag or iframe
- Service selector: Consulta (by specialty) → Exame → Dentária → Ultrassom → Visita Domiciliária
- Doctor/provider selector with photo, specialty, and next available slot
- Date and time slot picker — fetches live availability from `GET /appointments/availability`
- Patient identification: returning (phone lookup) or new (mini-registration form)
- Optional deposit payment for high-demand slots (Phase 4 — Vinti4)
- Mobile-first design; loads < 2 seconds on 4G

### 2.2 Multi-View Calendar
- Built with **FullCalendar** (React wrapper)
- Views: Day, Week, Month, Resource (by doctor/room)
- Colour-coded by service category:
  - 🔵 Cardiology · 🟢 Paediatrics · 🟣 Gynaecology · 🟡 Ophthalmology
  - 🟠 Dental · 🔴 Exam · ⚪ Ultrasound · 🟤 Home Visit
- Drag-and-drop rescheduling (triggers patient notification)
- Click-to-view appointment detail sidebar
- Real-time updates via Socket.io (new bookings appear without refresh)

### 2.3 Slot Availability Logic
```
Available slots = Staff working hours
                - Existing confirmed appointments
                - Clinic-wide business hours + public holidays  ✅ implemented
                - Leave periods                                  ✅ implemented (approved LeaveRequest only)
                - Buffer time between appointments                ❌ not implemented (no such field/logic exists)
                - Room availability (if room required)            ✅ implemented
```
✅ `getAvailability`/`create()` share one implementation for all of the above (they used to drift —
`getAvailability` didn't check business hours/holidays/leave at all, so the booking UI could offer
a slot that then got rejected on submit).

Slots are locked in Redis for **30 seconds** (`SLOT_LOCK_TTL_MS`) during active booking, not 5
minutes — one lock per 30-minute grid bucket the appointment spans, per staff member and per room
(when one is assigned), released as soon as the booking transaction finishes either way.

### 2.4 Automated Reminder Sequence

| Reminder | Channel | Timing | Action CTA |
|---|---|---|---|
| Confirmation | WhatsApp + Email | Immediately after booking | — |
| Reminder 1 | WhatsApp | 48h before | Confirm / Cancel |
| Reminder 2 | WhatsApp | 24h before | Confirm / Cancel |
| Reminder 3 | WhatsApp + SMS | 2h before | — |

- ✅ Reminder jobs enqueued in **BullMQ** on appointment creation (48h/24h/2h offsets)
- ✅ Jobs cancelled and re-enqueued on reschedule; **not currently cancelled on cancellation**
  (worth a follow-up check)
- ❌ Only the WhatsApp channel is actually implemented — the "SMS" and "Email" columns above and
  the `ReminderChannel` enum's `sms`/`email` values are not wired to anything; every reminder's
  `channel` is hardcoded to `"whatsapp"` regardless. Fixing this needs real SMS-sending
  infrastructure (Africa's Talking, per `ARCHITECTURE.md`), which doesn't exist in the codebase at all.
- ❌ No-show flag auto-set after 30 minutes — not implemented; `no_show` is only ever set manually
  via `PATCH /appointments/:id/status`

### 2.5 Waitlist
- ✅ Patient/receptionist can join a waitlist for a specific service/doctor/date (`POST/GET /appointments/waitlist`)
- ❌ Nothing matches an opened-up slot back to waitlist entries, or notifies anyone — joining is
  purely a list today; a receptionist would have to check it and call the patient manually

---

## 3. Data Model (key tables)

See `DATABASE-SCHEMA.md` → sections 2.1–2.4:
- `appointments`
- `appointment_reminders`
- `waitlist`
- `rooms`

---

## 4. API Endpoints

See `API-SPEC.md` → Section 3 (Appointments)

Key routes:
- `GET /appointments/availability` — public, used by booking widget
- `POST /appointments` — create booking
- `PATCH /appointments/:id` — update status / reschedule
- `GET /appointments` — calendar data

---

## 5. Business Rules

- 🟡 A patient cannot have two overlapping appointments — not actually enforced; conflict
  detection today only checks the assigned **staff member's** and **room's** schedules, not the
  same patient double-booked with two different staff members
- 🟡 Same doctor cannot be double-booked — true, but **not** via a DB unique index (none exists).
  Enforced at the application layer: a Redis lock per 30-min bucket serialises concurrent
  requests, and an overlap query rejects genuine conflicts before the row is written
- ❌ Cancellations less than 2 hours before appointment flagged for admin review — not implemented
- ✅ **Recurring appointments exist, but differently than described here**: a series is
  pre-generated in full at creation time (not "next occurrence on completion"), available to any
  patient (not gated to health-plan members — that was the original framing's assumption, not a
  built restriction), with a configurable daily/weekly/monthly interval ending on a fixed count or
  a date. See `POST /appointments/series` in `API-SPEC.md`.
- ✅ Walk-ins can be added directly (`source: "walk_in"` on `POST /appointments`)

---

## 6. UI Screens

| Screen | Role | Description |
|---|---|---|
| Booking Widget | Patient (public) | Multi-step booking form on website |
| Calendar — Day View | Receptionist | Today's appointments with check-in buttons |
| Calendar — Week View | Admin/Receptionist | Clinic-wide weekly overview |
| My Schedule | Doctor | Own upcoming appointments only |
| Appointment Detail | All | Patient info, service, notes, status actions |
| Waitlist Manager | Receptionist/Admin | Active waitlist entries with notify button |

---

## 7. Notifications Summary

| Event | WhatsApp | SMS | Email |
|---|---|---|---|
| Booking confirmed | ✅ | — | ✅ |
| Reminder 48h | ✅ | — | — |
| Reminder 24h | ✅ | — | ✅ |
| Reminder 2h | ✅ | ✅ | — |
| Rescheduled | ✅ | — | ✅ |
| Cancelled | ✅ | — | — |
| No-show follow-up | ✅ | — | — |
| Slot available (waitlist) | ✅ | — | — |

---

*Module M1 · v1.1 · updated 2026-08-30 against the current implementation*
