# M4 — Health Plan Management

> **Priority:** 🟠 High · **Phase:** 2 (Months 3–5)
> **Dependencies:** M2 (Patient CRM), M6 (Billing), M1 (Appointments)

---

## 1. Overview

Manages the clinic's two plan types — **Plano Familiar** (Family) and **Plano Empresarial** (Corporate) — with full lifecycle support: creation, member management, utilisation tracking, renewals, and a self-service portal for corporate HR.

> **Implementation status:** the plan **product catalogue** and **companies** registry are real
> CRUD, and a patient/company can be **subscribed** to a plan. Nothing past that point is built:
> no suspend/cancel, no membership model (a plan links to exactly one holder patient via a plain
> FK), no utilisation decrementing, no renewal reminders, no upsell alerts, no self-service
> portals.

---

## 2. Plan Types

### 2.1 Plano Familiar
- 🟡 Single patient on one plan — real, but it's one direct FK (`patients.healthPlanId`), not a
  "family unit" grouping; there's no concept of a family linking multiple patients to one plan
- 🟡 Coverage tiers/pricing exist as a JSON `coverageRules` blob on the product — nothing reads or
  enforces it against consultations/exams (see §3.3)
- ❌ Auto-renewal and the 30/15/7-day WhatsApp expiry notifications: not implemented — no job
  queries expiring plans at all

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
- ❌ No auto-renew flag, no suspend/cancel — there is no `PATCH` or `DELETE` on `/health-plans/:id`
  at all; once created, a subscription can only ever be read back, never modified or ended through
  the app
- 🟡 `planNumber` is **client-computed** (count of existing plans for the product +1), not a DB
  sequence — two concurrent "add plan" submissions for the same product can collide on its unique
  constraint and surface as a raw `500`, not a friendly `409` (unlike the idempotency-guarded
  resources elsewhere in the app)

### 3.2 Member Management

❌ None of this exists. There is no `corporate_plan_members` table and no membership endpoints —
`health_plans` links to **at most one** holder patient via a direct FK. Phone/NIF lookup to add a
member, soft-delete removal, and CSV export all have nothing to attach to.

### 3.3 Utilisation Tracking

❌ Not implemented. `health_plans.usageCount` exists as a column but **nothing in the codebase ever
increments it** — no appointment or exam completion touches it. There is no
`consultations_used/included` or `exams_used/included` pair, no "Incluído no seu plano" booking-time
check, and no limit-reached alert.

### 3.4 Renewal Reminders

❌ Not implemented — no job queries expiring plans, no `health_plan_expiring` WhatsApp template is
ever sent, no HR-email reminder path exists.

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
- `health_plan_products`
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
- ❌ Plan-period utilisation reset: moot, nothing tracks utilisation at all (§3.3)
- ✅ Services booked outside plan coverage are billed at standard rates — true only because no
  plan-aware pricing path exists to apply a discount in the first place (see `M6-billing-invoicing.md` §2.1)
- ❌ "Corporate plan members cannot see other members' clinical data" — moot, no membership model
- ❌ Admin manual utilisation adjustment with audit entry: not implemented

---

*Module M4 · v1.1 · updated 2026-08-30 against the current implementation*
