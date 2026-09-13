# M4 — Health Plan Management

> **Priority:** 🟠 High · **Phase:** 2 (Months 3–5)
> **Dependencies:** M2 (Patient CRM), M6 (Billing), M1 (Appointments)

---

## 1. Overview

Manages the clinic's two plan types — **Plano Familiar** (Family) and **Plano Empresarial** (Corporate) — with full lifecycle support: creation, member management, utilisation tracking, renewals, and a self-service portal for corporate HR.

> **Implementation status (updated 2026-09-12):** the plan **product catalogue** and **companies**
> registry are real CRUD, a patient/company can be **subscribed** to a plan, coverage is applied as
> a billing discount, expiry is notified 30/15/7 days out, and a plan can now be **manually
> renewed** by staff (`POST /health-plans/:id/renew`) with a dedicated list/detail frontend. Still
> not built: no scheduled/automatic renewal (a deliberate scope decision, not an oversight — see
> §3.4), no suspend/cancel, no membership model (a plan links to exactly one holder patient via a
> plain FK), no utilisation decrementing, no upsell alerts, no self-service portals.

---

## 2. Plan Types

### 2.1 Plano Familiar
- 🟡 Single patient on one plan — real, but it's one direct FK (`patients.healthPlanId`), not a
  "family unit" grouping; there's no concept of a family linking multiple patients to one plan
- ✅ **Fixed.** Coverage % in the `coverageRules` JSON blob is now read — `BillingService` applies
  it as an automatic invoice-level discount for a patient with an active plan (see
  `M6-billing-invoicing.md` §1/§2.1). Still a flat % per product, not per-consultation/exam tiers.
- ✅ **Fixed.** 30/15/7-day expiry notifications: `NotificationsProcessor.handleHealthPlanExpiring()`
  runs daily. 🟡 Renewal itself is manual, not automatic — see §3.4.

### 2.2 Plano Empresarial
- ✅ Linked to a `companies` record (real CRUD: `/companies`)
- ❌ HR admin add/remove employees, per-employee usage reports: not implemented — there is no
  membership model at all, corporate or otherwise (see §3.2)
- ❌ Monthly company invoicing: not implemented — nothing generates an invoice from a health-plan
  subscription

---

## 3. Core Features

### 3.1 Plan Administration

- ✅ Plan product catalogue: `POST/PATCH/DELETE /health-plans/products` (admin) — name, code,
  description, monthly fee, max members, JSON coverage rules
- ✅ Subscribe a patient or company to a plan: `POST /health-plans` (admin, receptionist) — sets
  `productId`, one of `holderPatientId`/`companyId`, `planNumber`, start/end dates
- ✅ **Fixed.** Renewal: `POST /health-plans/:id/renew` (admin, receptionist) — extends `endDate` by
  the product's own `durationMonths` (1/3/6/12, new field, `@default(1)`) from whichever is later,
  the plan's current `endDate` or today, and reactivates a lapsed plan. `400` if the product has
  since been deactivated. Still ❌ no suspend/cancel — there is no `PATCH`/`DELETE` on
  `/health-plans/:id` for ending a subscription early, only this one new action.
- ✅ **Fixed.** `planNumber` is generated **server-side**, race-safe via a Postgres advisory lock
  keyed by product code + year (`HealthPlansRepository.nextPlanNumber`, `pg_advisory_xact_lock`
  inside one `$transaction`) — the old client-computed count+1 race is gone. A caller-supplied
  value is still honored as-is when provided.

### 3.2 Member Management

❌ None of this exists. There is no `corporate_plan_members` table and no membership endpoints —
`health_plans` links to **at most one** holder patient via a direct FK. Phone/NIF lookup to add a
member, soft-delete removal, and CSV export all have nothing to attach to.

### 3.3 Utilisation Tracking

🟡 Partially real — corrected, this section was stale. `AppointmentsService.updateStatus()`'s
`completed` branch calls `HealthPlansService.incrementUsage()` whenever the patient has a
`healthPlanId`, unconditionally (no active/expired check, unlike the co-pay discount in
`M6-billing-invoicing.md` §1, which does gate on that). There is still no
`consultations_used/included` or `exams_used/included` pair, no "Incluído no seu plano"
booking-time check, and no limit-reached alert — `usageCount` is tallied but nothing reads it back.

### 3.4 Renewal Reminders and Renewal

✅ **Fixed** (reminders) — `NotificationsProcessor.handleHealthPlanExpiring()` runs daily,
WhatsApp to the holder patient or email to the company, at exactly 30/15/7 days before `endDate`.

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
- `health_plan_products` — now includes `durationMonths` (renewal cycle length, `@default(1)`)
- `health_plans` (subscriptions — no separate members table, see §3.2)
- `companies`
- ❌ `corporate_plan_members` — was never built

---

## 7. API Endpoints

See `API-SPEC.md` → Section 4 (Health Plans) and Section 5 (Companies)

---

## 8. Business Rules

- ✅ A patient can hold only one active plan at a time — true by construction, since it's a single
  `healthPlanId` FK, not an enforced business rule over a membership table
- ❌ Plan-period utilisation reset — `usageCount` is tallied (§3.3) but never reset per period and
  nothing reads it back, so there's no limit to reset against yet
- ✅ **Fixed.** Services booked outside plan coverage are billed at standard rates — now true
  because a plan-aware pricing path exists and simply applies no discount without an active plan,
  not because none exists at all (see `M6-billing-invoicing.md` §2.1)
- ❌ "Corporate plan members cannot see other members' clinical data" — moot, no membership model
- ❌ Admin manual utilisation adjustment with audit entry: not implemented

---

*Module M4 · v1.2 · updated 2026-09-12 against the current implementation*
