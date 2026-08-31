# CAP 360 — API Specification

> **Base path:** `/v1` (e.g. `http://localhost:4001/v1` in dev; the web app proxies `/api/*` → `${API_URL}/v1/*`)
> **Auth:** self-hosted session cookie (no external identity provider — Keycloak was removed).
> `POST /auth/login` sets an httpOnly, `SameSite=Lax` cookie (`cap_session`, `Secure` in
> production); every other route reads that cookie via `SessionAuthGuard`, no `Authorization`
> header involved. See the **Authentication** section below.
> **Content-Type:** `application/json` (all bodies are validated with Zod via a shared `ZodValidationPipe`)
> **Error format:** `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`
> **Dev auth bypass:** `AUTH_BYPASS=true` (only honoured when `NODE_ENV !== "production"`) skips
> session verification entirely for local development.

This document reflects the routes and body shapes that actually exist in
`apps/api/src/modules/*/*.controller.ts` and `packages/types/src/*.ts`. Field names are the real
camelCase used by the Zod schemas — not the snake_case of the original design.

---

## Authentication — `/auth`

Staff-only (no patient-facing login exists). All routes below are `@Public()` — no session cookie
required to call them, since a session doesn't exist yet at login and shouldn't be required to
recover one.

```
POST /auth/login             body: { email, password }
                              → 200 { staff: { id, email, fullName, role } }, sets cap_session cookie
                              → 401 wrong credentials or unknown email (identical message either way)
                              → 401 account locked (5 failed attempts / 15min → 15min lock, per email, in Redis)
                              throttled: 5 req/min per IP (tighter than the 300/min global default)

POST /auth/logout            no body — reads the session cookie itself
                              → 204, clears cap_session regardless of whether it was valid

POST /auth/forgot-password   body: { email }
                              → 200 always, same message, whether or not the email exists
                              → emails a reset link if it does (1h single-use Redis token)
                              throttled: 5 req/min per IP

POST /auth/reset-password    body: { token, password }
                              → 200 on a valid token; 410 Gone if invalid/expired/already used
```

`PATCH /staff/me/password` (§7) is the separate "change my password while logged in" route —
it requires a real session and the caller's *current* password, unlike the routes above.

---

## 1. Appointments (M1)

**Controller roles (all routes unless noted):** admin, receptionist, doctor, nurse

### GET `/appointments/availability`
**Query:** `serviceId` (uuid, required), `staffId` (uuid, optional), `date` (`YYYY-MM-DD`, required)

Returns 30-minute slots for that staff member's configured weekly `StaffAvailability`, with
`available: false` on any slot that conflicts with an existing booking, falls outside clinic
business hours, or is inside a matching `AuditView`-audited window. Also returns no slots at all
(empty array) for the whole day if it's a public holiday, the clinic is marked closed that
weekday, or the staff member has an approved `LeaveRequest` covering the date.

```
Response 200:
[
  { "start": "2026-06-15T09:00:00.000Z", "end": "2026-06-15T09:30:00.000Z",
    "staffId": "uuid", "staffName": "", "available": true }
]
```

### GET `/appointments`
**Query:** `from`, `to` (`YYYY-MM-DD`, required — validated as real calendar dates), `staffId`, `patientId` (optional)

```
Response 200: Appointment[] with patient { id, fullName }, staff { id, fullName }, service { id, name, durationMinutes }
```

### GET `/appointments/:id`
```
Response 200: Full appointment incl. patient { id, fullName, phone }, staff { id, fullName, role },
  service { id, name, durationMinutes, price }, room { id, name }
Response 404: not found
```

### GET `/appointments/waitlist`
**Query:** `serviceId` (optional)
```
Response 200: Waitlist[] with status "waiting" only, ordered oldest-first
```

### POST `/appointments`
```
Body:
{
  "patientId": "uuid", "staffId": "uuid", "serviceId": "uuid",
  "roomId": "uuid (optional)",
  "scheduledAt": "ISO8601 datetime with offset",
  "notes": "string (optional, max 500)",
  "source": "web | whatsapp | phone | walk_in (default web)",
  "idempotencyKey": "string (optional, max 100) — a retry with the same key replays the original booking"
}
Response 201: Appointment
Response 400: outside business hours / public holiday / staff on approved leave
Response 409: staff or room slot already booked / temporarily locked (Redis contention) — retry
```

### POST `/appointments/series` — recurring bookings
Pre-generates every occurrence as an ordinary appointment (linked via `seriesId`), each going
through the exact same checks as a single `POST /appointments` call. Best-effort: an occurrence
that fails its own checks is skipped and reported, not fatal to the rest of the series.

```
Body:
{
  "patientId": "uuid", "staffId": "uuid", "serviceId": "uuid", "roomId": "uuid (optional)",
  "scheduledAt": "ISO8601 datetime with offset (first occurrence)",
  "frequency": "daily | weekly | monthly",
  "interval": "number, default 1 (every N [frequency] units)",
  "endDate": "YYYY-MM-DD — exactly one of endDate/occurrenceCount required",
  "occurrenceCount": "number, 1–104",
  "notes": "string (optional)", "source": "web | whatsapp | phone | walk_in (default web)",
  "idempotencyKey": "string (optional) — a retry with the same key replays the original series"
}
Response 201:
{
  "seriesId": "uuid",
  "created": [ ...Appointment ],
  "skipped": [ { "date": "ISO8601", "reason": "string" } ]
}
```

### POST `/appointments/waitlist`
```
Body: { "patientId": "uuid", "serviceId": "uuid", "staffId": "uuid (optional)",
  "preferredDateFrom": "YYYY-MM-DD (optional)", "preferredDateTo": "YYYY-MM-DD (optional)", "notes": "string (optional)" }
Response 201: Waitlist entry
```

### PATCH `/appointments/:id/status`
```
Body: { "status": "confirmed | checked_in | completed | cancelled | no_show", "cancellationReason": "string (optional)" }
Response 200: Updated appointment. Marking "completed" auto-creates a draft invoice for the service.
```

### PATCH `/appointments/:id/reschedule`
```
Body: { "scheduledAt": "ISO8601 datetime with offset" }
Response 200: Updated appointment, status reset to "pending"; old reminder jobs cancelled, new ones enqueued
Response 400: only pending/confirmed appointments can be rescheduled
```

Reschedule only moves the start time — there is no way to change duration via this endpoint (the
calendar UI's drag-and-drop reflects this: dragging moves, resizing is disabled).

---

## 2. Patients (M2)

**Controller roles (default):** admin, receptionist, doctor, nurse

### GET `/patients`
**Roles:** admin, receptionist, doctor, nurse
**Query:** `q` (name / phone / NIF exact-match search), `planFilter` (`all` | `plan` | `none`, default `all`), `page` (default 1), `limit` (default 20)

NIF search matches by a blind-index hash (the field is encrypted, so no partial/`LIKE` match is
possible on it — only an exact NIF hits).

```
Response 200:
{ "data": [ { "id","fullName","dateOfBirth","gender","phone","email","consentGiven","healthPlanId","createdAt","updatedAt" } ],
  "total": 120, "page": 1, "limit": 20, "totalPages": 6 }
```

❌ There is no `GET /patients/me` — it was removed along with Keycloak. This auth system is
staff-only; no `patient` role can ever be granted a session, so the route was unreachable dead code.

### GET `/patients/:id`
**Roles:** admin, receptionist, doctor, nurse — logged via `@AuditView()` (every view of a full
patient record is written to `audit_log`, not just mutations)
```
Response 200: Full patient object (nif and dateOfBirth decrypted transparently)
Response 404: not found or soft-deleted
```

### GET `/patients/:id/timeline`
```
Response 200: TimelineEvent[] merging appointments + communications + invoices, newest first, capped at 20 per type
```

### POST `/patients`
**Roles:** admin, receptionist
```
Body:
{
  "fullName": "string (2-150)", "dateOfBirth": "YYYY-MM-DD", "gender": "male | female | other",
  "nif": "string (6-20, optional)", "phone": "E.164-ish, required",
  "email": "string (optional)", "address": "string (optional, max 300)",
  "emergencyContactName": "string (optional)", "emergencyContactPhone": "string (optional)",
  "consentGiven": "boolean, required", "healthPlanId": "uuid (optional)"
}
Response 201: Patient (phone normalised to +238<7 digits>; nif/dateOfBirth encrypted at rest, returned decrypted)
Response 409: phone or NIF already in use (including a race caught at the DB level, not just the pre-check)
```

### PATCH `/patients/:id`
**Roles:** admin, receptionist
```
Body: any subset of the POST fields except consentGiven
Response 200: Updated patient
```

### DELETE `/patients/:id`
**Roles:** admin
Soft-delete implementing right to erasure: sets `deletedAt` **and** nulls every direct-PII field
(`fullName`, `dateOfBirth`, `nif`, `nifHash`, `phone`, `email`, `address`,
`emergencyContactName`, `emergencyContactPhone`). `gender`, `healthPlanId`, and all related records
(appointments, invoices, notes) are kept for anonymous reporting and legal/billing retention.
```
Response 200: The now-anonymised patient row
```

### POST `/patients/:id/notes`
```
Body: { "content": "string (1-2000)" }
Response 201: Note
```

---

## 3. Billing / Financeiro (M6)

### Invoices — `/invoices`, roles: admin, receptionist

#### GET `/invoices`
**Query:** `patientId`, `status`, `from`, `to` (`YYYY-MM-DD`), `page`, `limit`
```
Response 200: { data, total, page, limit, totalPages }
```

#### GET `/invoices/:id`
```
Response 200: Invoice incl. items, payments, patient { fullName, nif } (nif decrypted)
```

#### GET `/invoices/:id/receipt`
```
Response 200: { "url": "signed R2 URL, or a placeholder URL if R2 isn't configured" }
```

#### POST `/invoices`
```
Body:
{
  "patientId": "uuid", "appointmentId": "uuid (optional)",
  "items": [ { "serviceId": "uuid, required", "description": "string", "quantity": 1, "unitPrice": number } ],
  "notes": "string (optional)", "dueDate": "YYYY-MM-DD (optional)"
}
Response 201: Invoice with computed totals; E-Fatura submission queued automatically
```
A catalogued `serviceId` billed at a price other than `services.price` is a price override —
always logged, and **admin-only** (non-admins get `403`). An item with no `serviceId` (off-
catalogue/custom) has no catalogue price to override, so any role that can create invoices can add
one.

#### POST `/invoices/:id/payments`
```
Body: { "amount": number, "method": "cash | bank_transfer | health_plan | vinti4",
  "reference": "string (optional)", "paidAt": "ISO8601 (optional)", "idempotencyKey": "string (optional)" }
Response 201: { id, status: "partially_paid" | "paid", amountPaid }
Response 400: invoice is already paid/cancelled, or this payment would push amountPaid above the invoice total
```
Insert + re-sum + status update run in one DB transaction — a concurrent payment on the same
invoice can't read a stale running total between the steps.

#### POST `/invoices/:id/cancel`
```
Response 200: Invoice with status "cancelled"
Response 400: cannot cancel a fully paid invoice
```
Idempotent on an already-cancelled invoice (returns it unchanged). If the invoice's E-Fatura
submission had already been `accepted` by the tax authority, also enqueues an E-Fatura cancel job.

#### GET `/invoices/:id/efatura`
```
Response 200: EFaturaSubmission record
Response 404: no submission exists for this invoice
```

#### POST `/invoices/:id/efatura/retry`
```
Response 202: { "queued": true } — resets the submission to "pending" and re-enqueues it
```

There is no `POST /invoices/:id/issue` and no `GET /invoices/:id/pdf` — a receipt PDF is generated
lazily by `GET /invoices/:id/receipt` and uploaded to R2 (or a placeholder URL if R2 isn't
configured), not issued as a separate workflow step.

### Financeiro (Despesas/Entradas) — `/financeiro`, roles: admin, receptionist

Not in the original design at all — added this project.

```
GET    /financeiro/despesas                    query: from,to,status,page,limit
POST   /financeiro/despesas                    body: description,category,amount,date,supplier?,method,reference?,notes?
PATCH  /financeiro/despesas/:id                body: any subset of the above
PATCH  /financeiro/despesas/:id/decision       roles: admin — body: { status: "approved"|"rejected" }
DELETE /financeiro/despesas/:id                roles: admin
POST   /financeiro/despesas/:id/receipt        multipart file upload → R2
GET    /financeiro/despesas/:id/receipt-url    signed download URL

GET    /financeiro/entradas                    query: from,to,page,limit
POST   /financeiro/entradas                    body: description,category,amount,date,notes?
PATCH  /financeiro/entradas/:id
DELETE /financeiro/entradas/:id

GET    /financeiro/summary                     → { totalEntradas, totalDespesas, balance, monthly[], byCategory[] }
```

---

## 4. Health Plans (M4)

**Controller roles (default):** admin, receptionist, corporate_hr

```
GET    /health-plans/products                                    roles: +doctor
GET    /health-plans/products/:id                                roles: +doctor
POST   /health-plans/products         roles: admin      body: name,code,description?,monthlyFee,maxMembers?,coverageRules?
PATCH  /health-plans/products/:id     roles: admin
DELETE /health-plans/products/:id     roles: admin

GET    /health-plans                                              query: (see service) — list subscriptions
GET    /health-plans/:id
POST   /health-plans                  roles: admin, receptionist   body: productId, holderPatientId? XOR companyId, planNumber, startDate, endDate?
```

`planNumber` is client-computed (count of existing plans for this product+year, +1), not a DB
sequence — a race between two concurrent "add plan" submissions for the same product can collide
on the `planNumber` unique constraint and surface as a raw `500`, not a friendly `409`. There is no
`POST /health-plans/:id/members` / `DELETE .../members/:patient_id` — a `HealthPlan` links to at
most one holder patient directly (`patients.healthPlanId`), not a membership join table.

---

## 5. Companies — `/companies`

**Roles:** admin, corporate_hr (mutations: admin only)
```
GET    /companies          query: page, limit
GET    /companies/:id
POST   /companies          roles: admin   body: name, taxId, email?, phone?, address?
PATCH  /companies/:id      roles: admin
DELETE /companies/:id      roles: admin
```

---

## 6. Services — `/services`

**Roles:** admin, receptionist, doctor, nurse (mutations: admin only)
```
GET    /services           query: active?
GET    /services/:id
POST   /services           roles: admin   body: name, code (UPPERCASE-WITH-DASHES), description?, durationMinutes, price
PATCH  /services/:id       roles: admin
DELETE /services/:id       roles: admin
```

---

## 7. Staff & Invitations (M8)

**Controller roles (default):** admin, receptionist, doctor, nurse

```
GET    /staff/me                                    — resolves the caller's own staff record from the session
PATCH  /staff/me/password                           — change own password; body: { currentPassword, newPassword }; roles: all 6 StaffRole values, overriding the controller default below
GET    /staff                                       — active staff list
GET    /staff/invitations         roles: admin       — pending invitations
DELETE /staff/invitations/:id     roles: admin
GET    /staff/:id
POST   /staff/invite              roles: admin       body: CreateStaffSchema shape (see below) — sends the invite email, does not create a Staff row yet
PATCH  /staff/:id                 roles: admin
```

```
Invite body:
{
  "fullName": "string (2-150)", "email": "string", "role": "admin | doctor | nurse | receptionist | lab_tech",
  "jobTitle": "string (optional)", "phone": "string (optional)", "specialtyCode": "string (optional)",
  "availability": [ { "dayOfWeek": 0-6, "startTime": "HH:MM", "endTime": "HH:MM" } ]
}
```

Activation (public, token-based — see §9) hashes the password the invitee chose (argon2id) and
creates the local `staff` row directly — no external system is involved, so there's nothing to
leave orphaned on a partial failure. ❌ No MFA/TOTP of any kind exists — that was a Keycloak
feature (never actually enforced for pre-existing accounts even then) and has no replacement.

There is no `POST /staff/:id/shifts` or `POST /staff/:id/leave` endpoint — `StaffShift` and
`LeaveRequest` rows exist in the schema and are honoured by the appointments-availability logic,
but nothing in the running app can create or approve one.

---

## 8. BFF — Backend for Frontend

Screen-aggregate endpoints collapsing multi-request UI patterns into one parallel server-side
fetch. Same auth/roles as their constituent resources.

### GET `/bff/patient-screen/:id`
Full patient profile (incl. health plan + product name) and merged timeline in one request.
```
Response 200: { "patient": {...}, "timeline": [...] }
```

### GET `/bff/staff`
Active staff list shaped for dropdowns.

### GET `/bff/billing-summary`
```
Response 200: { "issuedCount": number, "collectedAmount": number, "overdueCount": number }
```

---

## 9. Public (unauthenticated) — `/public`

**Auth:** none (`@Public()`) — rate-limited at 60 req/min per IP (`@Throttle`) on every route below.

```
GET  /public/services                          — active services for the booking widget
GET  /public/staff                             — staff list for the booking widget
GET  /public/availability      query: serviceId, staffId?, date
POST /public/bookings          body: PublicBookingSchema (below)
GET  /public/invitations/:token                — staff invitation preview (fullName, email, role, expired)
POST /public/invitations/:token/activate       body: { fullName, password } — see §7
```

```
PublicBookingSchema:
{
  "fullName": "string (2-120)", "phone": "string (7-20)", "dateOfBirth": "YYYY-MM-DD",
  "email": "string (optional)", "gender": "male | female | other (default other)",
  "serviceId": "uuid", "staffId": "uuid", "scheduledAt": "ISO8601 with offset",
  "notes": "string (optional)",
  "consentGiven": "must be literal true — the API rejects anything else"
}
Response 201: the created Appointment (patient found-or-created by phone; consentGiven flows
  through from this real, validated value — it is not assumed)
```

---

## 10. Settings & Parametrização

### `/settings` — roles: admin, receptionist, doctor, nurse (mutations narrower, see below)
```
GET   /settings                                                 — all settings keyed by name
PATCH /settings/clinic              roles: admin, receptionist  — business hours, address, etc. (JSON)
PATCH /settings/notifications       roles: admin, receptionist  — feature toggles (wa_confirm, wa_cancel, wa_reminder, email_daily, email_overdue)
PATCH /settings/access-control      roles: admin
PATCH /settings/integration/:key    roles: admin                — e.g. integration_whatsapp, integration_email_smtp, integration_efatura credentials
```

### `/parametrizacao` — roles: admin, receptionist, doctor, nurse, lab_tech (mutations: admin only)
Admin-configurable dropdown option lists (e.g. expense categories).
```
GET    /parametrizacao              — grouped counts by `nome`
GET    /parametrizacao/:nome        — entries for one group
POST   /parametrizacao   roles: admin   body: { nome: SCREAMING_SNAKE_CASE, valor, codigo?, descricao?, ordem?, ativo? }
PATCH  /parametrizacao/:id   roles: admin
DELETE /parametrizacao/:id   roles: admin
```

---

## 11. Documents

### GET `/documents/:id/download-url`
**Roles:** admin, doctor, nurse, receptionist, lab_tech, patient
```
Response 200: { "url": "signed R2 download URL" }
```
There is **no upload endpoint** — nothing in the running app can currently create a
`PatientDocument` row via the API.

---

## 12. Not implemented

The following modules from the original design have **no backend at all** — no controller, no
service, no database table (see `DATABASE-SCHEMA.md` §§8–11 for detail):

| Module | State |
|---|---|
| M3 — WhatsApp Integration | 🎭 UI mockup only. No `/whatsapp/*` routes, no webhook handler, no bot |
| M5 — Exam Results | Only `exam_requests` exists as a schema stub, no controller/service at all; no result field, no `/exam-requests/:id/results`, no token-based download |
| M7 — Clinical Records | 🎭 UI mockup only. No `/appointments/:id/clinical-note`, no prescriptions/referrals |
| M9 — Home Visits | 🎭 UI mockup only. No `/home-visits/*` routes |
| M10 — Analytics | 🎭 UI mockup only. No `/analytics/*` routes — the Financeiro summary (§3) is the one place with real aggregate data today |

---

## 13. Common HTTP Status Codes

| Code | Meaning | When Used |
|---|---|---|
| 200 | OK | Successful GET/PATCH/some POST |
| 201 | Created | Successful POST creating a resource |
| 202 | Accepted | Async work queued (e.g. E-Fatura retry) |
| 400 | Bad Request | Zod validation error, or a business rule (outside business hours, already paid, etc.) |
| 401 | Unauthorised | Missing/expired token (unless `AUTH_BYPASS=true` in dev) |
| 403 | Forbidden | Insufficient role |
| 404 | Not Found | Resource doesn't exist or is soft-deleted |
| 409 | Conflict | Double-booking, duplicate phone/NIF, temporarily locked slot |
| 429 | Too Many Requests | Rate limit hit (public routes only, today) |
| 500 | Internal Server Error | Unexpected server error |

---

## 14. Rate Limiting

`ThrottlerGuard` (`@nestjs/throttler`, in-memory storage — not Redis-backed) is registered
globally, so every route gets a default limit unless overridden per-route.

| Endpoint Group | Limit | Status |
|---|---|---|
| Everything (global default) | 300 req/min per IP | ✅ Enforced |
| Public (`/public/*`) | 60 req/min per IP | ✅ Enforced (`@Throttle` override, stricter than the default) |
| `POST /auth/login`, `POST /auth/forgot-password` | 5 req/min per IP | ✅ Enforced — plus a separate, per-account Redis lockout (5 failed logins / 15min → 15min lock) that isn't IP-based at all |

The original design's "1000 req/min WhatsApp webhook" row described infrastructure that doesn't
exist (no WhatsApp webhook — M3 is a UI mockup). The "10 req/min auth endpoints" row is now real,
at a stricter 5 req/min, since real `/auth/*` endpoints exist (see the **Authentication** section
above) — this replaced the original design's assumption that Keycloak/NGINX would handle it.

---

*CAP 360 · API Specification · regenerated from the actual controllers — 2026-08-31 (Keycloak removal)*
