# M6 — Billing & Invoicing

> **Priority:** 🟠 High · **Phase:** 1 (Months 1–3)
> **Dependencies:** M2 (Patient CRM), M1 (Appointments), M4 (Health Plans)

---

## 1. Overview

Eliminates revenue leakage from manual and untracked billing. Auto-generates invoices at check-in, supports multiple payment methods including health plan claims, and delivers receipts to patients via WhatsApp.

> **Implementation status:** invoice creation (auto-draft at check-in + manual), payments
> (idempotent, transactional, overpayment-guarded), cancellation, PDF receipts, and E-Fatura tax
> submission are built and tested. ❌ Nothing computes health-plan co-pay/discounts or tracks plan
> utilisation — `health_plan` is only a `PaymentMethod` enum value. ❌ No automatic WhatsApp/email
> receipt delivery — a receipt is only ever generated on request via `GET /invoices/:id/receipt`.
> ❌ Cash-summary/revenue/receivables reporting doesn't exist. Not covered by the original design
> at all: a separate **Financeiro** module (`/financeiro/*`) for clinic expenses, income entries,
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
❌ Payments are **not** attributed to the staff member who recorded them — the `Payment` model has
no staff/user field.

### 2.4 Receipt Delivery

- 🟡 PDF receipt generated server-side using **PDFKit** (not Puppeteer), on-demand via
  `GET /invoices/:id/receipt` — not automatically "on full payment". It renders whatever the
  invoice's status/amountPaid is at request time, uploads to R2, and **caches the R2 key on the
  invoice** — a known gap: if a receipt is generated after a partial payment, a later payment on
  the same invoice does **not** regenerate the PDF, so the cached receipt can go stale
- ❌ No automatic delivery — nothing sends the receipt via WhatsApp or email; a staff member must
  open the invoice and fetch the receipt URL themselves

### 2.5 Outstanding Balances

- ❌ No dedicated "outstanding balances" dashboard screen or endpoint — `GET /invoices?status=...`
  can be filtered manually, but there's no purpose-built view
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
  income — the closest thing this codebase has to the "reporting" described in §3 below

---

## 3. Reporting

❌ None of this exists: no daily cash summary, no monthly revenue breakdown by service/doctor/plan,
no outstanding-receivables report, no Excel/PDF export. **M10 Analytics doesn't exist at all**
(see `Docs/modules/M10-analytics-reporting.md`), so the planned integration point is moot. The
only real numeric rollup in this area is Financeiro's `GET /financeiro/summary` (§2.6), which
covers expenses/income, not invoice revenue.

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
| Invoice Detail | Receptionist / Admin | ✅ Line items, payment history, cancel action |
| Payment Modal | Receptionist | ✅ Record payment — method, amount, reference |
| Outstanding Balances | Admin | ❌ No dedicated screen (see §2.5) |
| Revenue Dashboard | Admin | ❌ Doesn't exist (see §3) |
| Financeiro (Despesas/Entradas/Resumo) | Admin/Receptionist | ✅ Real screen, not in original design |

---

## 7. Business Rules

- 🟡 Invoices cannot be deleted, only cancelled — true, but `POST /invoices/:id/cancel` takes
  **no reason field**; cancelling a `paid` invoice is rejected, cancelling an already-cancelled one
  is a no-op (idempotent), and an accepted E-Fatura submission gets a queued cancel job to the tax
  authority too
- 🟡 "Cancelled invoices retain full audit trail" — the invoice row itself is retained (never hard
  deleted), but nothing writes a dedicated `audit_log` entry for invoice cancellation specifically
- ❌ "Receipts issued for each payment" — one receipt is generated per **invoice**, on demand, and
  can go stale after a later payment (see §2.4) — there's no per-payment receipt
- ❌ Health-plan utilisation/co-pay check — not implemented (see §2.1/§2.3)
- ❌ Payment-to-staff attribution — not implemented (see §2.3)

---

*Module M6 · v1.1 · updated 2026-08-30 against the current implementation*
