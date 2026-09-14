# M4 — Health Plan Management

> **Priority:** 🟠 High · **Phase:** 2 (Months 3–5)
> **Dependencies:** M2 (Patient CRM), M6 (Billing), M1 (Appointments)

---

## 1. Overview

Manages the clinic's two plan types — **Plano Familiar** (Family) and **Plano Empresarial** (Corporate) — with full lifecycle support: creation, member management, utilisation tracking, renewals, and a self-service portal for corporate HR.

> **Implementation status (updated 2026-09-13):** the plan **product catalogue** and **companies**
> registry are real CRUD; a plan now has a **real membership model** (`health_plan_members` join
> table — any number of patients per plan, not a single holder FK); coverage is applied as a
> billing discount to any active member; a plan carries a **shared session/appointment quota**
> (`sessionsPerCycle`/`sessionsRemaining`) that drains by one on every completed appointment for any
> member and gates the billing discount once exhausted; expiry status now also reacts to sessions
> running low, not just the date; expiry is notified 30/15/7 days out to every active member (and
> the company, if any); and a plan can be **manually renewed** by staff (`POST
> /health-plans/:id/renew`), which both extends `endDate` and refills the session pool, from a
> dedicated list/detail frontend. Still not built: no scheduled/automatic renewal (a deliberate
> scope decision, not an oversight — see §3.4), no suspend/cancel, no upsell alerts, no self-service
> portals.

---

## 2. Plan Types

### 2.1 Plano Familiar
- ✅ **Fixed.** Multiple patients per plan — a real join table (`health_plan_members`), not a single
  holder FK. Adding a member enforces the product's `maxMembers` cap and that the patient isn't
  already an active member of this or any other plan.
- ✅ Coverage % in the `coverageRules` JSON blob is read — `BillingService` applies it as an
  automatic invoice-level discount for a patient with an active plan membership *and* sessions
  remaining (see `M6-billing-invoicing.md` §1/§2.1). Still a flat % per product, not
  per-consultation/exam tiers.
- ✅ 30/15/7-day expiry notifications: `NotificationsProcessor.handleHealthPlanExpiring()` runs
  daily, now messaging every active member (not just one holder). 🟡 Renewal itself is manual, not
  automatic — see §3.4.

### 2.2 Plano Empresarial
- ✅ Linked to a `companies` record (real CRUD: `/companies`), and can *also* carry member patients
  now — a corporate plan is no longer holder-XOR-company, both can be set at once.
- ❌ HR admin add/remove employees through a self-service portal, per-employee usage reports: not
  implemented — the membership model exists (§3.2) but is only reachable via the admin/receptionist
  UI and API today, not a `corporate_hr`-scoped self-service flow.
- ❌ Monthly company invoicing: not implemented — nothing generates an invoice from a health-plan
  subscription.

---

## 3. Core Features

### 3.1 Plan Administration

- ✅ Plan product catalogue: `POST/PATCH/DELETE /health-plans/products` (admin) — name, code,
  description, monthly fee, max members, sessions per cycle, JSON coverage rules.
- ✅ **Seguradora** (2026-09-14) — every product now carries a required insurer tag,
  `coverageRules.seguradora`, picked from a `<select>` sourced from the parametrização group
  `TIPO_SEGURADORA` (same pattern as the existing "Tipo" field / `TIPO_PLANO_SAUDE`). Required at
  creation (`400` server-side if missing), editable afterward from the product's "Gerir" modal.
  This is a plain category tag, unrelated to the product's real `companyId`/`Company` link — that
  relation still exists in the schema (still set for corporate-linked products) but is no longer
  displayed anywhere in the product UI; the label "Seguradora" now always refers to this tag.
- ✅ Create a plan and optionally enroll members atomically: `POST /health-plans` (admin,
  receptionist) — `productId`, optional `companyId`, optional `memberPatientIds[]`, `planNumber?`,
  start/end dates. Session pool seeds from the product's `sessionsPerCycle` at creation.
- ✅ Renewal: `POST /health-plans/:id/renew` (admin, receptionist) — extends `endDate` by the
  product's own `durationMonths` (1/3/6/12, `@default(1)`) from whichever is later, the plan's
  current `endDate` or today, **and refills `sessionsRemaining`** to the product's current
  `sessionsPerCycle`, and reactivates a lapsed plan. `400` if the product has since been
  deactivated. Still ❌ no suspend/cancel — there is no `PATCH`/`DELETE` on `/health-plans/:id` for
  ending a subscription early, only this one renewal action. The renew button lives **only** on the
  plan's detail page (`/health-plans/:id`) — not on the Planos list tab, not in the patient-list
  plan modal.
- ✅ `planNumber` is generated **server-side**, race-safe via a Postgres advisory lock keyed by
  product code + year (`HealthPlansRepository.nextPlanNumber`, `pg_advisory_xact_lock` inside one
  `$transaction`). A caller-supplied value is still honored as-is when provided.

### 3.2 Member Management

✅ **Fixed.** `health_plan_members` is a real join table — `{ healthPlanId, patientId, addedAt,
removedAt }`, one row per covered patient, no special-cased "holder". Endpoints:
`POST /health-plans/:id/members` (body: `patientId`) and `DELETE
/health-plans/:id/members/:patientId`, both admin/receptionist. Business rules enforced in
`HealthPlansService`:
- A patient may hold only **one active membership at a time**, across all plans — `409` if already
  covered elsewhere (or here).
- Adding a member beyond the product's `maxMembers` — `400`.
- Removal is **soft** (`removedAt` set, row kept) so a past invoice's plan discount stays
  explainable; removing a non-member is an idempotent `200`, not an error. Re-adding a previously
  removed patient revives the same row rather than duplicating it.
- Only an unknown *plan* 404s; an unknown patient on add is a `404` too.

Still ❌: phone/NIF-driven add flow is search-by-name/phone only (no dedicated lookup shortcut), no
CSV export of a plan's roster, no self-service HR portal to manage members (§2.2).

### 3.3 Utilisation Tracking

✅ **Fixed.** `HealthPlansService.recordSessionUsage(patientId)` is called unconditionally from
`AppointmentsService.updateStatus()`'s `completed` branch (best-effort, caught so a failure here
never blocks the appointment update). It no-ops if the patient has no active membership; otherwise
it increments the plan's lifetime `usageCount` (never reset) **and** decrements the shared
`sessionsRemaining` pool (floored at 0 via a guarded `updateMany`, so it can never go negative even
under concurrent completions) — one pool per plan, shared across every member, not tracked
per-member. There is still no booking-time "Incluído no seu plano" check and no limit-reached
alert, but the billing discount itself now stops once `sessionsRemaining` hits 0 (see
`M6-billing-invoicing.md` §2.1).

### 3.4 Renewal Reminders and Renewal

✅ **Fixed** (reminders) — `NotificationsProcessor.handleHealthPlanExpiring()` runs daily, at
exactly 30/15/7 days before `endDate`, WhatsApping every active member with consent **and**
independently emailing the company if one's attached (both can now fire for the same plan, unlike
the old holder-XOR-company model). Note this 30/15/7-day cadence is a separate concern from the
UI's "expiring" status badge (§8), which reacts sooner — within 5 days of `endDate` **or** at 5 or
fewer sessions remaining.

🟡 Renewal itself is **manual**, by design — `POST /health-plans/:id/renew` (§3.1) lets staff renew
a plan the reminder above flagged, but nothing renews a plan automatically. This was a deliberate
scope decision (2026-09-12), not a gap: a renewal is implicitly a fresh billing period, so it stays
a staff-confirmed action rather than something that silently happens overnight via a scheduled job.
A future scheduled auto-renew job (mirroring the reminder job's own cron pattern) remains open if
the business wants opt-in automatic renewal for specific plans/products later.

### 3.5 Upsell Alerts

❌ Not implemented — nothing tracks or flags out-of-plan bookings for a receptionist to act on.

---

## 4. Member Self-Service Portal (Phase 4)

- Patient logs in to view plan details, utilisation, and included services
- Book plan-included appointments directly from the portal
- Download invoices and receipts

---

## 5. Corporate HR Portal (Phase 4)

- HR admin logs in with `corporate_hr` role
- See active member list, total utilisation, aggregate usage reports
- Add/remove employees
- Download monthly usage report for accounting

---

## 6. Data Model

See `DATABASE-SCHEMA.md` → Section 4:
- `health_plan_products` — `durationMonths` (renewal cycle length, `@default(1)`) and
  `sessionsPerCycle` (sessions per cycle, shared across members; `NULL` = unlimited)
- `health_plans` (subscriptions) — `sessionsRemaining` (live countdown, seeded/refilled from the
  product's `sessionsPerCycle`); no more `holderPatientId`
- `health_plan_members` — the real membership join table (§3.2)
- `companies`

---

## 7. API Endpoints

See `API-SPEC.md` → Section 4 (Health Plans) and Section 5 (Companies)

---

## 8. Business Rules

- ✅ A patient can hold only one active plan membership at a time — enforced in
  `HealthPlansService` (service-level pre-check, `409` on violation), not a DB constraint, matching
  this codebase's existing accepted-race-window pattern elsewhere (e.g. `PatientsService.create`'s
  phone/NIF pre-check).
- ✅ **Fixed.** A plan counts as **expiring** within 5 days of `endDate` **or** at 5 or fewer
  sessions remaining (and **expired** past `endDate`, or the instant `sessionsRemaining` hits 0,
  even mid-term) — computed client-side (`apps/web/.../health-plans/status.ts`), not a persisted
  status enum. This is a UI/status-badge concern, separate from the 30/15/7-day notification cadence
  in §3.4.
- ✅ **Fixed.** Plan-period utilisation reset — `usageCount` is a lifetime tally that's never reset,
  but `sessionsRemaining` *is* the per-period countdown, and it resets to the product's full
  `sessionsPerCycle` on renewal (§3.1).
- ✅ Services booked outside plan coverage (or once a plan's sessions are exhausted) are billed at
  standard rates — a plan-aware pricing path applies no discount without an active, session-having
  membership (see `M6-billing-invoicing.md` §2.1).
- ❌ "Corporate plan members cannot see other members' clinical data" — moot, no self-service portal
  exists yet for a member to see anything (§2.2, §4, §5).
- ❌ Admin manual utilisation/session adjustment with audit entry: not implemented — sessions only
  move via a completed appointment or a full renewal refill.

---

*Module M4 · v1.4 · updated 2026-09-14 against the current implementation*
