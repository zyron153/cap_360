# M6 — Billing & Invoicing

> **Priority:** 🟠 High · **Phase:** 1 (Months 1–3)
> **Dependencies:** M2 (Patient CRM), M1 (Appointments), M4 (Health Plans)

---

## 1. Overview

Eliminates revenue leakage from manual and untracked billing. Auto-generates invoices at check-in, supports multiple payment methods including health plan claims, and delivers receipts to patients via WhatsApp.

> **Implementation status:** invoice creation (auto-draft at check-in + manual), payments
> (idempotent, transactional, overpayment-guarded), cancellation, PDF receipts, and E-Fatura tax
> submission are built and tested. ❌ Nothing computes health-plan co-pay/discounts or tracks plan
> utilisation — `health_plan` is only a `PaymentMethod` enum value (though `Invoice.healthPlanId`
> itself is real and now actually read, by the payer-type breakdown in §2.6/§3). ❌ No automatic
> WhatsApp/email receipt delivery — a receipt is only ever generated on request via
> `GET /invoices/:id/receipt`. ✅ Receivables (outstanding/overdue invoices) and a handful of
> revenue breakdowns exist now (§2.5/§3) — real numbers, not a mockup, but scoped to what's
> described there, not a general-purpose reporting engine. Not covered by the original design at
> all: a separate **Financeiro** module (`/financeiro/*`) for clinic expenses, income entries,
> and a date-ranged summary — see §2.6.

---

## 2. Core Features

### 2.1 Service Price Catalogue

- ✅ Admin-managed list of billable services with base price (CVE) — plain per-service price, no
  bulk-update endpoint
- ❌ Health-plan-specific pricing/co-pay tiers — no such field or logic exists anywhere in the
  codebase; a health plan is a simple FK on the patient, not a pricing table
- ✅ **Price-override guard (not in the original design):** billing a catalogued service at a price
  different from `Service.price` requires the `admin` role and is logged (`Logger.warn`) with the
  patient/service/override amount; custom off-catalogue line items (no `serviceId`) aren't
  restricted, since there's no catalogue price to compare against

### 2.2 Invoice Generation

Invoices are created:
- ✅ **Automatically** as a `draft` at appointment check-in (best-effort — a billing failure is
  logged but does not block the check-in itself)
- ✅ **Manually** by receptionist/admin (`POST /invoices`) for walk-ins or additional services

Invoice includes:
- ✅ Auto-incremented invoice number, but formatted `INV-2026-0001` (4-digit, not `MS-2026-00001`)
  — generated under a Postgres advisory lock per year to stay race-free under concurrent creates
- 🟡 Patient name — yes; **NIF is not stored on the invoice itself**, only linked via the patient
  record (so an erased/soft-deleted patient's invoice shows "Paciente removido", no NIF at all)
- ✅ Line items: service, quantity, unit price, total
- ✅ The Faturas list shows which consultation an invoice came from (when it has one) — service
  name + date, under the patient's name — `Invoice.appointmentId` already existed, `GET /invoices`
  just never included the relation until now; a manually-created invoice with no appointment simply
  shows nothing extra
- ❌ Health plan discount line — never computed (see §2.1)
- ✅ Subtotal, **Total in CVE**; ❌ no separate discount field
- ✅ Clinic details/tax ID — pulled from Configurações → Clínica settings, with placeholder
  fallbacks so PDF generation never hard-fails on missing config

### 2.3 Payment Collection

Supported methods (`PaymentMethod` enum — exactly these four, no more):
- ✅ Cash
- ✅ Bank transfer (reference noted)
- 🟡 Health plan claim — recorded as a payment method only; ❌ nothing marks a service "consumed"
  against the plan, there is no utilisation tracking at all
- 🟡 Vinti4 — exists as an enum value only; ❌ no payment-gateway integration of any kind
- ❌ "Card" is not a distinct method — would have to go through Vinti4 or bank transfer

✅ Partial payments supported: invoice status → `partially_paid` until balance cleared, with an
atomic insert+re-sum+status-update transaction and a hard guard rejecting any payment that would
push `totalPaid` over the invoice total. ✅ Payments accept a client-supplied `idempotencyKey` — a
retried "record payment" request replays the original result instead of double-charging.
✅ **Fixed.** Payments are now attributed to the staff member who recorded them —
`Payment.recordedById` (FK to `Staff`), set from the authenticated caller, shown on the invoice
detail page's payment history.

### 2.4 Receipt Delivery

- 🟡 PDF receipt generated server-side using **PDFKit** (not Puppeteer), on-demand via
  `GET /invoices/:id/receipt` — not automatically "on full payment". It renders whatever the
  invoice's status/amountPaid is at request time, uploads to R2, and **caches the R2 key on the
  invoice** — ✅ the staleness gap once described here is fixed: `recordPaymentAtomic` nulls
  `pdfR2Key` on every payment (`billing.repository.ts`), so a receipt generated after a partial
  payment gets regenerated the next time it's requested rather than staying stale
- ❌ No automatic delivery — nothing sends the receipt via WhatsApp or email; a staff member must
  open the invoice and fetch the receipt URL themselves

### 2.5 Outstanding Balances

- ✅ **Contas a Receber**, on the Financeiro Overview tab: total outstanding (sum of `total −
  amountPaid` across every `issued`/`partially_paid`/`overdue` invoice), total overdue, and a count
  of overdue invoices — `FinanceiroService.getSummary()`'s `receivables` field, computed directly
  from `dueDate` rather than trusting the scheduled job below to have run. It's a live snapshot
  ("owed right now"), deliberately not scoped to whatever date range the rest of the Overview is
  showing. **Found and fixed while seeding real demo data (empty tables never exercised this
  path):** the underlying query originally checked only `issued`/`partially_paid`, silently
  excluding any invoice the scheduled job below had already flipped to `overdue` — exactly the
  invoices this card most needs to surface.
- ❌ Still no dedicated invoice-level "outstanding balances" list/drill-down — the Overview card
  above is a clinic-wide total, not a per-invoice or per-patient breakdown; `GET
  /invoices?status=...` can be filtered manually for that, but there's no purpose-built view
- ✅ Overdue marking is real: a scheduled job runs `UPDATE invoices SET status='overdue' WHERE
  status IN ('issued','partially_paid') AND dueDate < now()`, independent of whether email is
  configured; the existing overdue-invoices digest email then reads from that corrected status
- ❌ No "send payment reminder" action from the invoice detail page — the only reminder path is the
  scheduled digest email, not an ad-hoc admin-triggered one

### 2.6 Financeiro — Expenses & Income *(not in the original design)*

A separate, real module at `/financeiro/*` (admin + receptionist), covering clinic bookkeeping
rather than patient invoices:
- ✅ **Despesas** (expenses): create/list/update, receipt file upload+signed download URL,
  delete (admin), and an admin-only approve/reject decision flow (`PATCH despesas/:id/decision`)
- ✅ **Entradas** (income entries): create/list/update/delete (delete is admin-only)
- ✅ **Resumo** (`GET /financeiro/summary?from&to`): date-ranged summary combining expenses and
  income, plus (added later, see §3) receivables, revenue by payer type, revenue by service, and
  no-show financial impact — a date-range selector on the frontend (this month / last 3 months /
  this year / custom) drives the `from`/`to` params, which the endpoint already accepted before
  anything on screen actually sent them

---

## 3. Reporting

🟡 More exists than the "nothing" this section used to describe, but it's still not a general
reporting engine — everything below lives on the Financeiro Overview tab specifically, computed by
`FinanceiroService.getSummary()` from data that was already there (`Invoice`, `InvoiceItem`,
`Appointment`), no new tables:
- ✅ Receivables — outstanding/overdue invoice totals (§2.5)
- ✅ Revenue by payer type — payment revenue split between private-pay and health-plan/company
  invoices (`Invoice.healthPlanId` set vs. null); manual `Income` entries have no payer, so they're
  outside this specific breakdown
- ✅ Revenue by service — billed (not necessarily collected) totals per `InvoiceItem.serviceId`,
  falling back to the line item's free-text description when it has none
- ✅ No-show financial impact — count of "faltas" (`no_show` **and** `cancelled` appointments) in
  range, plus the hypothetical revenue lost (their service's price, never actually billed). Widened
  from `no_show`-only after the card showed 0/0 for periods with only cancellations
  (`FinanceiroRepository.noShowAppointments`) — field name (`noShowImpact`) predates the widening.
- ❌ No revenue-by-doctor breakdown, no daily (as opposed to monthly-chart/period-snapshot)
  granularity, no Excel/PDF export
- ❌ **M10 Analytics still doesn't exist as its own module** (see
  `Docs/modules/M10-analytics-reporting.md`) — everything above is Financeiro-specific, not a
  general-purpose reporting surface other modules can plug into

---

## 4. Data Model

See `DATABASE-SCHEMA.md` → Section 6 (Billing & Financeiro):
- `invoices`, `invoice_items`, `payments`, `efatura_submissions`
- `expenses`, `income_entries` (Financeiro — not in the original design)

---

## 5. API Endpoints

See `API-SPEC.md` → Section 3 (Billing / Financeiro) for the current route list, including
`POST /invoices/:id/cancel` and the `/financeiro/*` routes, neither of which were in the original
design.

---

## 6. UI Screens

| Screen | Role | Description |
|---|---|---|
| Check-in & Invoice | Receptionist | ✅ Check in patient triggers an auto-created draft invoice |
| Invoice List | Receptionist / Admin | ✅ Filterable list of all invoices |
| Invoice Detail | Receptionist / Admin | ✅ Line items, payment history, cancel action — available both as a full `/billing/:id` page and as a modal opened from the Faturas list's "Detalhes" button (same shared component, `InvoiceDetailBody.tsx`, so the two can't drift) |
| Payment Modal | Receptionist | ✅ Record payment — method, amount, reference |
| Outstanding Balances | Admin | ❌ No dedicated screen (see §2.5) |
| Revenue Dashboard | Admin | ❌ Doesn't exist (see §3) |
| Financeiro (Despesas/Entradas/Resumo) | Admin/Receptionist | ✅ Real screen, not in original design |

---

## 7. Business Rules

- ✅ Invoices cannot be deleted, only cancelled — `POST /invoices/:id/cancel` now **requires a
  reason** (`CancelInvoiceSchema`, min 3 chars, stored on `Invoice.cancelReason`/`cancelledAt`);
  cancelling a `paid` invoice is rejected, cancelling an already-cancelled one is a no-op
  (idempotent), and an accepted E-Fatura submission gets a queued cancel job to the tax authority
  too. A cancel button + reason prompt now also exists on the invoice detail page — it didn't
  before, despite the endpoint being real.
- ✅ **Fixed.** "Cancelled invoices retain full audit trail" — the invoice row itself is retained
  (never hard deleted), and cancellation now writes a semantic before/after diff (status +
  `cancelReason`) onto its `audit_log` row via the same mechanism §1.4 introduced, not just the
  generic "a POST happened" row the interceptor logs for every mutation.
- 🟡 "Receipts issued for each payment" — one receipt is generated per **invoice**, on demand
  (not automatically per payment) — there's no per-payment receipt. The staleness half of this gap
  is closed: `recordPaymentAtomic` nulls `pdfR2Key` on every payment, so a cached receipt can no
  longer be served after a later payment changes the balance.
- ❌ Health-plan utilisation/co-pay check — not implemented (see §2.1/§2.3)
- ✅ **Fixed.** Payment-to-staff attribution — `Payment.recordedById` (see §2.3).

---

*Module M6 · v1.5 · updated 2026-09-12 — "Detalhes" on the Faturas list now opens the invoice
detail experience as a modal instead of navigating away (extracted into shared
`InvoiceDetailBody.tsx`, reused by the full `/billing/:id` page); "faltas" financial impact widened
from `no_show`-only to `no_show` + `cancelled`; patient-name null-safety fix (right-to-erasure
leaves `fullName: null`) applied across the dashboard and billing screens*
