# M8 — Staff & Resource Scheduler

> **Priority:** 🟡 Medium · **Phase:** 3 (Months 5–8)
> **Dependencies:** M1 (Appointments — availability engine)

---

## 1. Overview

Manages doctor and staff shifts, room/equipment calendars, and leave requests. Feeds availability data to the appointment booking engine (M1) so patients only see slots when a doctor and room are both free.

> **Implementation status:** staff profiles/invitations and per-staff **weekly availability
> templates** are real and drive the booking engine. ✅ **2026-09-27:** date-specific **shift
> overrides** are now wired up end to end — CRUD endpoints, a per-date override of the weekly
> template in both `getAvailability()`/`create()`, and a drag-to-assign calendar UI (see §2.3). ❌
> **Leave requests** have a schema and are checked once approved, but nothing in the app can ever
> submit or approve one — only a direct DB write could populate a row. ❌ There is **no Rooms
> management API at all** — rooms can only be seeded directly in the database. ❌ **Equipment**
> as a trackable, reservable resource doesn't exist — `Room.equipment` is a free-form JSON tag list.
> ✅ Room and staff double-booking conflict detection at booking time is real (see M1).

---

## 2. Staff Management

### 2.1 Staff Profiles

Each staff member has (`Staff` model):
- ✅ Name, role (`StaffRole` enum: admin/doctor/nurse/receptionist/lab_tech/corporate_hr), job
  title, specialty code
- ✅ Email — unique, doubles as the login identity (no external identity provider — see below)
- ✅ Phone (optional)
- 🟡 Active/inactive — implemented as a nullable `deletedAt` soft-delete timestamp, not a boolean
  flag
- ✅ Default weekly availability template (relation to `StaffAvailability`, see §2.2)
- ✅ `passwordHash` — argon2id, set once at invitation activation or via a later
  forgot/reset/change-password flow; see `SECURITY.md` §2 (Keycloak was removed 2026-08-31)
- ✅ **Invitation flow (not detailed in the original doc):** `POST /staff/invite` creates only a
  `StaffInvitation` token and emails it; the actual `Staff` row is created when the invitee visits
  the activation link and sets their own password, hashed directly (no external system involved,
  so there's nothing that can be left orphaned on a partial failure)

### 2.2 Weekly Availability Templates

✅ Real and load-bearing: each staff member has `StaffAvailability` rows (day of week, start/end
time, slot length in minutes), and `getAvailability`/`create()` in the appointments engine read
these directly to compute bookable slots.

### 2.3 Shift Scheduling

✅ **Wired up (2026-09-27).** A `StaffShift` row for a given staff/date now *replaces* that day's
`StaffAvailability` template entirely (not merged with it) — `AppointmentsService.resolveDayWindows()`
checks for a shift override first, in both `getAvailability()` and `create()`. Endpoints:
`GET /staff/:id/shifts?from=&to=` (any authenticated staff can view), `POST /staff/:id/shifts`
(admin-only, upsert — a second POST for the same staff+date replaces the first), `DELETE
/staff/shifts/:id` (admin-only). Frontend: a "Turnos" tab on the Staff page with a real drag-to-
assign calendar (click-drag a time range to create a shift, drag an existing one to a different
day, resize to change hours, click to edit/remove).

The availability engine for slot calculation actually uses:
```
Available = Date-specific shift override, if one exists — else StaffAvailability template ✅
          - Confirmed appointments                         ✅
          - Approved leave                                 ✅ (see §2.4 caveat)
          - Public holidays (configurable calendar)         ✅
          - Buffer time between appointments                ❌ not implemented
```

### 2.4 Leave Management

- ❌ **No submission or approval flow exists anywhere in the API.** The `LeaveRequest` model is
  only ever read (`findFirst`, filtered to an implicit "approved" status) by the availability
  engine — nothing calls `.create()` or `.update()` on it. A leave record can currently only reach
  the database via a direct SQL/Prisma insert.
- ✅ *If* an approved row exists, it does correctly block availability for that staff member across
  the date range
- ❌ Rescheduling flag for appointments already booked during a later-approved leave period: not
  implemented
- ❌ Leave types (Annual/Sick/Personal/Unpaid): no such field — the model has only a free-text
  `reason` string and a plain `status` string, no type enum

---

## 3. Room & Equipment Calendar

### 3.1 Rooms

Each room is a resource (`Room` model: name, floor, capacity, JSON equipment tags, active flag)
that can be assigned to an appointment. 🟡 Rooms can be **assigned and conflict-checked**
(§3.3) — but ❌ there is no management API to create, edit, or deactivate one; rows can only be
seeded/inserted directly into the database today.

### 3.2 Equipment

❌ Not implemented as a resource in its own right. `Room.equipment` is a free-form JSON tag list
with no unit count, no reservation, and no availability check — it's descriptive metadata only,
not a schedulable entity. There is no separate `Equipment` model.

### 3.3 Conflict Detection

- ✅ A doctor with an approved leave record overlapping the requested time is rejected (subject to
  the §2.4 caveat that no leave record can currently be approved through the app)
- ✅ A room double-booking is rejected at booking time (`findConfirmedInRangeForRoom`)
- ❌ Equipment conflicts: moot, since equipment isn't a schedulable resource (§3.2)
- ✅ A staff member with an overlapping appointment is rejected — enforced by a Redis lock per
  30-minute bucket plus a DB overlap query, not a unique constraint

🟡 All of the above are **synchronous rejections at booking time**, not an async "alert" a manager
reviews later — there is no separate conflicts list/feed (see §6, Conflict Alert screen).

---

## 4. Data Model

See `DATABASE-SCHEMA.md` → sections 1.2 (`staff`), 1.3 (`staff_invitations`), 1.5 (`rooms`), and
7.1–7.3 (`staff_shifts`, `staff_availability`, `leave_requests`)

---

## 5. API Endpoints

See `API-SPEC.md` → Section 7 (Staff & Invitations)

---

## 6. UI Screens

| Screen | Role | Description |
|---|---|---|
| Staff List | Admin | ✅ All staff with role, status, invitation actions |
| Shift Planner | Admin | ✅ "Turnos" tab on the Staff page, drag-to-assign calendar (§2.3) |
| My Schedule | Doctor / Nurse | ✅ Personal appointment view; no shift data to show (§2.3) |
| Leave Requests | Admin | ❌ No backend — nothing can create or approve a leave request (§2.4) |
| Room Calendar | Admin / Receptionist | 🟡 Rooms appear on the appointments calendar as booked resources; no dedicated room-management screen (§3.1) |
| Conflict Alert | Admin | ❌ Doesn't exist — conflicts are inline booking rejections, not a reviewable list (§3.3) |

---

## 7. Business Rules

- 🟡 A doctor needs `StaffAvailability` rows (or a `StaffShift` override for that specific date) to
  appear in the booking widget — this falls out naturally from the availability query, it isn't a
  separately enforced rule (§2.3)
- ❌ Leave-request notice period / emergency admin-granted leave: moot — leave requests can't be
  submitted or approved through the app at all (§2.4)
- 🟡 Room assignment is optional on any appointment (`roomId` is nullable) — but there's no
  per-service "this procedure requires a room" rule; it's the same optional field regardless of
  service type
- ✅ Public holidays list is admin-configurable and blocks availability clinic-wide

---

*Module M8 · v1.3 · updated 2026-09-27 — shift overrides wired up end to end (backend + drag-to-assign UI)*
