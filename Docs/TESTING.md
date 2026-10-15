# CAP 360 — Testing Strategy

> **Version:** 1.6 · **Date:** updated 2026-09-12 against the current implementation
> Tools: Jest (unit + a real integration tier), Playwright (7 real E2E specs, wired to `test:e2e`)

> **Implementation status:** this document was written before implementation and describes a
> testing program most of which now genuinely exists. What's real: **27 Jest unit spec files,
> 427 tests**, colocated with source (`apps/api/src/**/*.spec.ts`); a separate **integration tier**
> (`apps/api/test/integration/*.integration-spec.ts`, 4 files / 9 tests, supertest against the real
> dev Postgres + Redis, run via `pnpm --filter @cap/api test:integration`); **7** real Playwright
> specs (`apps/web/e2e/*.spec.ts`, 15 tests total), wired to `pnpm --filter @cap/web test:e2e`. No
> k6 performance tests exist (`tests/performance/` doesn't exist). No OWASP ZAP scan runs in CI —
> only `.github/workflows/ci.yml` exists, no `security.yml`. Sections below describing tests for
> features that were never built (WhatsApp bot FSM, clinical notes, exam results) are pure fiction
> — see each feature's module doc.

---

## 1. Testing Philosophy

- **Test the business logic** — unit tests focus on domain rules (appointment conflict, plan utilisation), not infrastructure plumbing
- **Integration tests own the API contracts** — every endpoint tested with real DB and Redis
- **E2E tests cover critical user journeys** — booking flow, check-in, exam result delivery
- **Performance tests run before every major release** — validate 4G load time and concurrent user targets

---

## 2. Test Pyramid

Closer to shape now, though still unit-heavy — no k6/ZAP layer on top:

```
         ╱╲
        ╱E2E╲          15 tests — 7 Playwright specs, wired to test:e2e
       ╱──────╲
      ╱   9    ╲       4 integration spec files — supertest + real
     ╱  tests    ╲     dev Postgres/Redis, no testcontainers yet
    ╱──────────────╲
   ╱      427        ╲  27 Jest unit spec files, colocated with source,
  ╱      tests         ╲ repository layer mocked
 ╱──────────────────────╲
```

---

## 3. Unit Tests

**Tool:** Jest + ts-jest
**Location:** `apps/api/src/**/*.spec.ts`

### 3.1 What to Unit Test

- Service layer business logic (not controllers, not DB queries)
- Utility functions (slot availability calculation, token generation, price computation)
- Bot FSM state transitions
- Reminder job scheduling logic
- Input validation rules

### 3.2 Key Test Suites

#### Appointment Service — ✅ real, in `appointments.service.spec.ts`
```typescript
describe('AppointmentService', () => {
  it('prevents double-booking for the same staff slot', async () => { ... })          // ✅ real
  it('prevents double-booking the same room', async () => { ... })                    // ✅ real
  it('rejects a slot outside business hours / on a public holiday', async () => { ... }) // ✅ real
  it('rejects a slot during approved staff leave', async () => { ... })               // ✅ real
  it('pre-generates a recurring series and de-dupes by idempotency key', async () => { ... }) // ✅ real
  // ❌ buffer time, auto no-show, waitlist notification: none of these exist (see M1 doc)
})
```

#### Health Plan Service — ✅ real, in `health-plans.service.spec.ts`
```typescript
describe('HealthPlansService', () => {
  it('getActiveCoverage returns null when the patient has no health plan', async () => { ... })      // ✅ real
  it('getActiveCoverage returns null for an inactive plan/product or a lapsed endDate', async () => { ... }) // ✅ real
  it('getActiveCoverage returns null when coverageRules has no coverage %', async () => { ... })      // ✅ real
  it('getActiveCoverage caps coveragePercent at 100', async () => { ... })                             // ✅ real
  // ❌ plan-exhaustion blocking, renewal reminders: still don't exist (see M4-health-plan-management.md)
})
```

#### Billing Service — ✅ mostly real, in `billing.service.spec.ts` / `billing.repository.spec.ts`
```typescript
describe('BillingService', () => {
  it('generates INV-YYYY-NNNN invoice numbers under an advisory lock', async () => { ... }) // ✅ real
  it('marks invoice as paid when full amount received', async () => { ... })            // ✅ real
  it('marks invoice as partially_paid for partial payment', async () => { ... })        // ✅ real
  it('rejects a payment that would push totalPaid over the invoice total', async () => { ... }) // ✅ real
  it('replays an idempotent payment instead of double-charging', async () => { ... })   // ✅ real
  it('applies the patient\'s active health-plan coverage % as a negative line item, on create and on appointment-completion auto-draft alike', async () => { ... }) // ✅ real
  it('leaves the subtotal untouched when the patient has no active coverage', async () => { ... })     // ✅ real
})
```

#### Financeiro Service — ✅ real, in `financeiro.service.spec.ts`
```typescript
describe('FinanceiroService', () => {
  // Faturas Pagas listed as Entrada (GET /financeiro/entradas/faturas) — projects Payment rows,
  // not a new table; getSummary()'s totals/monthly-chart already included payments before this.
  it('projects a payment as an Entrada-shaped row, private payer by default', async () => { ... })     // ✅ real
  it('marks the payer as planoSaude when the invoice was billed against a health plan', async () => { ... }) // ✅ real
  it('collapses multiple billed services into "first +N" for the category', async () => { ... })       // ✅ real
  // Saldos em Aberto (GET /financeiro/saldos, /saldos/:patientId) — patient-level view on top of
  // the same issued/partially_paid/overdue status filter FinanceiroSummary.receivables already used
  it('groups outstanding invoices by patient, summing the remaining balance', async () => { ... })     // ✅ real
  it('sorts patients by descending total owed, largest debtor first', async () => { ... })             // ✅ real
  it('sums one patient\'s outstanding invoices and lists them individually', async () => { ... })      // ✅ real
  // … plus the pre-existing Despesas/Entradas/Resumo suite (getSummary, audit diffs, etc.)
})
```

#### Bot FSM — ❌ doesn't exist
No WhatsApp bot FSM, so no such test suite. The Phase 1 inbox is covered though:
`whatsapp-api.spec.ts` (signature verification), `whatsapp.service.spec.ts` (dedupe, patient linking,
reminder-reply routing, 24h window, idempotency, delivery-status ordering) and
`whatsapp-webhook.integration-spec.ts` (below).

### 3.3 Coverage Target

- Minimum 80% line coverage on `src/modules/**/*.service.ts`
- 100% coverage on core business logic: `appointment.service.ts`, `billing.service.ts`, `health-plan.service.ts`

---

## 4. Integration Tests

✅ **A real, distinct layer now.** `apps/api/test/integration/*.integration-spec.ts`, run via
`pnpm --filter @cap/api test:integration` (own Jest config — `jest.integration.config.js`,
`--runInBand --forceExit`). Supertest drives the real, fully-wired Nest app (`test/integration/
setup.ts` mirrors `main.ts`'s pipes/filters/prefix) against the real dev Postgres + Redis — no
mocks, no testcontainers (there's no isolated test DB locally; CI's ephemeral `postgres:16-alpine`
service is the only truly isolated instance). Each spec creates and tears down its own fixtures by
id — never a truncate. 4 files, 9 tests, picked for highest real-world value rather than blanket
coverage:

- **`booking-conflict.integration-spec.ts`** — a second booking for the same staff+slot gets a real
  409, a different slot for the same staff still succeeds.
- **`patient-erasure.integration-spec.ts`** — create over real HTTP (encrypted `dateOfBirth`/`nif`
  round-trip correctly), then right-to-erasure: PII actually scrubbed at rest, normal lookup 404s,
  the row itself survives (not hard-deleted) for audit history.
- **`invoice-payment.integration-spec.ts`** — invoice creation at catalogue price, partial payment
  → `partially_paid`, remaining balance → `paid`, a further payment on a paid invoice rejected.
- **`whatsapp-webhook.integration-spec.ts`** — Meta verify handshake (right/wrong token), unsigned and
  forged POSTs rejected with nothing stored, a signed message stored as ciphertext and a retry
  deduplicated, thread served decrypted via the inbox API, resolve then reopen on the next inbound.
  Temporarily swaps in test credentials for the `integration_whatsapp` setting and restores it after.
- **`staff-admin-password.integration-spec.ts`** — the one spec that deliberately skips
  `AUTH_BYPASS`: real admin login → `POST /staff` with a policy-breaking or missing password is a
  400 and creates nothing → with a valid one the user is created and only an argon2id hash is stored
  (never in the response) → a duplicate email is a 409 → the new user logs in with that password and
  goes straight into the app (no forced change) → `PATCH /staff/:id/password` with a weak password is
  a 400 and leaves their session alone → with a valid one it returns `{ sessionsEnded: 1 }`, the
  user's open session gets a 401, the old password no longer logs in and the new one does → an unknown
  id is a 404 → a non-admin can't create users or change another user's password. Uses 4 logins on
  purpose: `/auth/login` is throttled to 5/min per IP, so the spec reuses sessions rather than
  logging in again. (Sparing an admin's own session is covered by the unit tests, since changing the
  seeded admin's password here would break every other spec's login.)

Note on the M1 §2.4 reminder-cancellation gap this section used to flag as unfixed: it was closed
in the roadmap's Phase 1 (`appointments.service.ts`'s `cancelPendingReminders` now runs from both
`reschedule()` and `updateStatus()`'s cancelled branch) — covered by unit tests, not (yet) one of
the 4 integration specs above.

- **`clinical-note-access.integration-spec.ts`** — `AUTH_BYPASS` off, three real logins (admin + two doctors it
  creates). Doctor A's notes are invisible to doctor B (list empty, by-id 404) → a booked-but-not-arrived
  appointment today opens nothing → once the patient is `checked_in` today B reads A's **finalized** note
  but never A's draft (404) → still read-only: B's update of it is a 404 and B's "my notes" stays empty →
  the cross-author read leaves an `audit_log` row marked `patient in treatment today` → `completed` today
  still counts, `confirmed` does not, and a checked-in appointment from yesterday opens nothing. **No
  self-unlock:** a doctor who checks the patient in and completes the appointment themself — or completes
  straight from `confirmed` — still reads nothing; once someone else is involved (reception completes it) they
  can; an appointment with an unknown actor (system / before actors were recorded) still qualifies. Then the
  lost-update guard: a save with the version the caller saw lands, a stale one is a 409 `NOTE_CHANGED` carrying
  the current note and nothing is overwritten; two saves racing on one version → exactly one 200 and one 409;
  six simultaneous first-saves for one appointment → one 201 and five 409s, one row. (Run with
  `pnpm --filter @cap/api test:integration -- clinical-note-access`; the dev machine can be slow enough to
  want `--testTimeout=180000`.)

### 4.1 What's still fictional below

The scenario tables below predate the real integration tier and describe unit/guard behavior, not
this section's own specs:
```

#### Billing Flow
```
POST /invoices → 201, status already "issued"                       ✅ real
POST /invoices/:id/issue → status = issued                          ❌ no such route — issuing
                                                                         happens inline on create
POST /invoices/:id/payments (full) → status = paid                  ✅ real
POST /invoices/:id/payments (partial) → status = partially_paid     ✅ real
```

---

## 5. End-to-End Tests

**Tool:** Playwright
**Location:** `apps/web/e2e/**/*.spec.ts`
**Environments:** Runs against staging environment

### 5.1 Critical Flows

#### Patient Booking Flow — ✅ `apps/web/e2e/booking-flow.spec.ts`
Covers booking through this app's own pages, not an embeddable widget on an external site (no such
widget exists — see `M1-smart-appointment-engine.md`): patient profile render, edit-and-save,
appointment→invoice auto-creation, payment via a raw API call, the Faturas tab, invoice detail
page, and the receipt endpoint.

#### Receptionist Check-In Flow — ✅ `apps/web/e2e/checkin-payment.spec.ts`
The one flow the booking-flow spec doesn't touch: walking a *pending* appointment through the real
status-transition UI on `/appointments` (Confirmar → Check-in feito → Concluída, not a raw API
call) to its auto-created invoice, then paying it off through the "Registar Pagamento" form itself
rather than the API.

#### Doctor's Clinical Note — ✅ `apps/web/e2e/clinical-note-draft.spec.ts`
Drives the note editor (`/records/note`) through the real UI. Typing autosaves a draft linked to the
appointment (and merely opening the page creates nothing), a reload resumes the same draft, quick
phrases append, the footer lists what is still missing, and "Guardar e concluir consulta" finalizes the
note and completes the appointment in one click. The Histórico tab shows state badges, filters by them,
and pages past 50 notes with "Carregar mais" (the paging test creates 52 notes; notes have no delete
endpoint, so a run leaves about 60 behind on the erased test patient). **Two tabs:** a save that loses to
the other tab is stopped and the two versions are merged three ways (sections only one side changed join
by themselves; sections both changed differently open the side-by-side "Juntar as duas versões da nota"
dialog — see `M7` §2.1), and the API is checked to prove the stale write never landed; a second tab that opened before any draft existed
gets the same banner instead of overwriting the first tab's draft. **Colleague's note:** another
clinician's finalized note opens read-only with their name and no save buttons or quick phrases (the
browser is made a different doctor by serving `/staff/me`, since the dev bypass makes every session the
admin). **Checked in alone:** a doctor who is the only person recorded as having put the patient in
treatment is told why a colleague's notes aren't shown (served as the same staff id the API check-in recorded). The paging test's first version raced the search box's 300ms debounce (a test bug — the filter
correctly reset the list). The small setup helpers (booking, the API shim) are inlined in each spec — Playwright's loader can't import a sibling module under every Node version (it throws `context.conditions?.includes is not a function` on Node 24); `E2E_API`
points the setup calls and the browser's `/api` traffic at another API instance, e.g. one built from the
working tree.

#### Note Editor Details — ✅ `apps/web/e2e/clinical-note-editor.spec.ts`
The editor's failure and accessibility paths, each against the real API with the browser's traffic
selectively stubbed: a failed save keeps the text, says so, offers a retry and asks before leaving; a failed
save retries by itself when the browser comes back online; a duration typo can't stop the text from saving
(it is flagged, left out and blocks finalizing); a note finalized >24h ago is read-only with a reason; the
last session's moderate/high risk is quoted and the clinic's quick phrases replace the suggested ones; a
phrase that would pass 3000 characters is refused with a message; keyboard-only use (one tab stop per
phrase toolbar, arrows inside, radio-group arrows, Ctrl+Enter); the save status is one live region whose
text changes in place; double-clicking "Guardar nota" finalizes once; leaving through "Voltar" inside the
autosave pause still saves; at 390px the editor, the merge dialog and the discard dialog fit; and the day
queue ("Em consulta") lists today's patient with a note state, "Registar" opens the editor and "Concluir"
completes the consulta. Two of its tests were wrong the first time they ran (a locator filtered on text that
the test itself changes), found by the first full run — the product was right.

#### Prescriptions, Referrals, Access Report — ✅ `apps/web/e2e/clinical-extras.spec.ts`
The patient profile's clinical tabs and the admin report. Prescriptions: empty state; a two-medicine
prescription with duration, instructions and a link to the note (per-field Portuguese validation, focus
moves to the first error); a half-written form asks before Escape/Cancelar discards it and ignores the
backdrop; an API refusal shows inside the form without losing what was typed; a list that fails to load says
so with a retry instead of reading as empty. Referrals: external (provider + reason required) and internal
(a colleague picked from a list, not the referrer; a clear message when there is none); status buttons follow
`REFERRAL_STATUS_TRANSITIONS`, a finished referral has none, an admin may correct any status, and a doctor who
is neither referrer nor target gets no buttons (a 409 says someone else moved it first). "Carregar mais"
pages notes, prescriptions and referrals 100 at a time; "Prescrever" on a note opens the form linked to it;
a draft is discarded after a confirmation and a finalized note cannot be. Admin tab "Acessos entre
clínicos": rows with Cabo Verde time, reader, patient link and basis, paged with "Carregar mais"; an empty
or failed report explains itself; the tab strip is one tab stop with arrow keys; a doctor never sees the tab
and the endpoint refuses them; one test runs against the real API. Note: the lists are fetched with a
`?page=&limit=` query, so a stub of one must end its URL glob with `*`.

#### Responsive Shell — ✅ `apps/web/e2e/responsive-shell.spec.ts`
Read-only. On every main route **and every tab of it**, at 390px and 820px, asserts that nothing is
**clipped** (content that starts inside an `overflow: hidden` container but runs past it — hidden clips, it
does not scroll), **squeezed** (a growing pane in a side-by-side layout under 140px wide) or **scrolling
sideways** inside `<main>`. It exists because the first version of this check only looked for
overflow and treated `overflow: hidden` as safe: it reported "0" while 20 views were broken — data
tables cut off by 100–800px, vertical-nav layouts leaving the content ~130px wide, and the dashboard's
main column 2px wide. A tripwire test asserts `/exams` and `/visits` (mock-only, redirected by middleware)
are still hidden, and fails with instructions to add them to the views above the moment either is
un-hidden. Also asserts that the sidebar is an off-canvas drawer below `lg` (closed until the
menu button opens it; closes on navigation and on Escape; out of the tab order while closed) and a plain
column on a desktop.

#### Topbar — ✅ `apps/web/e2e/topbar.spec.ts`
The patient search finds a patient by name and opens the profile with the keyboard (combobox: type,
arrow, Enter), says so when nobody matches, and — at phone width — hides the box behind a search icon that
opens a bar over the topbar (result opens the profile; Cancelar closes it). The bell lists the unconfirmed appointment (a booking
left `pending` 4+ days out, inside the 7-day window) as a link to Agendamentos. The "planos terminam"
alert is covered only by its logic (no spec books a plan ending this week).

#### Dashboard for a restricted role — ✅ `apps/web/e2e/dashboard-restricted-role.spec.ts`
A doctor/nurse/lab_tech gets 403 from `/api/health-plans` and `/api/invoices`, which the dashboard asks for
unconditionally. The spec serves those two 403s (`AUTH_BYPASS` makes every dev session the admin, so the real API
would answer 200) and asserts the dashboard still renders — no "Página não encontrada" card — instead of
`healthPlans.filter is not a function` landing in `(app)/error.tsx`. It must **wait for the 403 and let React render
it** before asserting: the card renders from its `[]` default first, so an assertion right after `goto` passes on the
broken page (the first version did). Verified to fail on the old code and pass on the fix.

#### Admin Sets a User's Password → Login → "Alterar senha" — ✅ `apps/web/e2e/staff-admin-password.spec.ts`
Replaced `staff-invitation.spec.ts` (and the short-lived temporary-password spec) when the
email-invitation flow was removed. Drives Gestão de Acesso through the real UI: the Add User form
lists the password rules up front (all unmet), "Gerar" fills a policy-compliant password, reveals it
and ticks the rules, and creating the user adds the row; the new user then logs in from a separate
browser context and lands straight on `/dashboard`; the admin's "Alterar senha" modal rejects a weak
password, accepts a valid one and reports it; finally the old password is rejected on the login page
and the new one works. The dev stack runs with `AUTH_BYPASS`, which treats a browser with no session
as the seeded admin (so `page` is the admin) — and since a revoked session would just fall back to
that admin, the 401 on the user's open session after a password change is asserted in
`staff-admin-password.integration-spec.ts` (§4), which runs without the bypass. The spec's first
incarnation caught a real bug: the bypass used to ignore the login cookie, so a freshly created user's
"change my password" was checked against the admin's password (fixed in `SessionAuthGuard`, which now
prefers a valid session over the bypass).

#### Manual Invoice Creation + Payment — ✅ `apps/web/e2e/manual-invoice-payment.spec.ts`
The one invoice-lifecycle path the other two Financeiro specs don't touch: creating an invoice by
hand via the "Nova Fatura" form (`/billing/new`), rather than relying on appointment-completion
auto-creation, then paying it off in two installments (partial → `partially_paid` → full → `paid`)
through the "Registar Pagamento" form, and finally exercising the "Recibo PDF" button. Writing this
spec surfaced and fixed a real bug: `/billing/new` sent `unitPrice` as a string (services' `price`
comes back from the API as a Prisma-Decimal string, and the form never coerced it), so every manual
invoice creation attempt failed its `400` Zod validation — the form was completely broken before
this pass. The receipt assertion checks the `GET .../receipt` JSON response the button's own click
handler consumes, not the popup's final loaded page — in dev (no R2 configured) that URL is a
non-resolving placeholder domain (`files.cap.cv`), so following it in a real browser always dead-ends
on Chrome's own error page regardless of whether the feature works.

#### Expense (Despesa) Approval — ✅ `apps/web/e2e/expense-approval.spec.ts`
Nothing else in the suite touched the Financeiro → Despesas tab at all. Covers registering a new
expense through the "Nova Despesa" modal and an admin approving it via the row's "Aprovar" action,
asserting the status badge flips from Pendente to Aprovada.

#### Invoice Cancellation — ✅ `apps/web/e2e/invoice-cancellation.spec.ts`
The other missing Financeiro state transition: cancelling an `issued` invoice via "Cancelar
Fatura" — the two-step inline confirmation, the required-reason gate (confirm button stays
disabled under 3 characters), the resulting "Cancelada" banner with reason/timestamp, and that a
cancelled invoice no longer offers "Cancelar Fatura" or "Registar Pagamento". Also asserts the
that the E-Factura panel stays out of the way on a freshly-issued invoice — deliberately narrow:
this dev environment has the e-Fatura integration switched off, so an issued invoice gets no fiscal
document and no panel; that's the one E-Factura state this suite can assert on without a real
(or Homologação) tax-authority endpoint. The integration itself is covered by unit tests: documents
are built, signed and validated against DNRE's XSD pack (`apps/api/test/fixtures/efatura-xsd`), the
signature is verified independently, and the multipart request is checked over a real local HTTP
server (`efatura-client.http.spec.ts`).

#### Health-Plan Payment Method — ✅ `apps/web/e2e/health-plan-payment.spec.ts`
Every other spec that records a payment leaves the method on its default (cash) — none exercised
the "Plano de Saúde" option in the method `<select>`. Covers only the existing pass-through
behavior (it's just another `PaymentMethod` enum value as far as `POST /invoices/:id/payments` is
concerned) — it does **not** cover co-pay/discount calculation or `HealthPlan.usageCount`
incrementing on invoice payments. `HealthPlan.usageCount` incrementing was already covered
elsewhere (`appointments.service.spec.ts`, see TODO.md's M4 note); coverage-% discount calculation
now exists too (`BillingService.applyHealthPlanDiscount`, unit-tested in `billing.service.spec.ts`
and `health-plans.service.spec.ts` — see §3.2 above) but this e2e spec wasn't updated to assert the
discounted amount, so it's unit-level coverage only for now. Minor finding while writing this spec:
the payment-history line renders the raw enum value (`method.replace("_", " ")` → "health plan"),
not the form's PT-PT label ("Plano de Saúde") — cosmetic/untranslated, not fixed as part of this pass.

Run with `pnpm --filter @cap/web test:e2e` (wired to the `test:e2e` script). All 7 specs need both
dev servers up (`apps/api` on 4001, `apps/web` on 3000) — they hit the real running stack, not a
mocked one. **Only one API process must be listening at a time** — this pass found a stray
`node apps/api/dist/main` (production-mode `start`) running alongside the normal `nest start
--watch` dev process; whichever one actually held the port varied, causing Playwright's own
`request` fixture to intermittently hang for 30s on the very first API call (`curl` against the
same endpoint at the same moment worked instantly, which is what made it non-obvious). If these
specs start timing out in `beforeAll` with no code changes to explain it, check for a duplicate API
process before assuming a real regression.

#### Doctor Clinical Note Flow — ✅ exists now — see "Doctor's Clinical Note" above

#### Exam Result Delivery Flow — ❌ doesn't exist — M5 has no result/upload feature at all

---

## 6. Performance Tests

❌ **None of this exists.** `tests/performance/` is not present in the repo, no k6 script has ever
been written, and no performance gate runs in CI. Treat the rest of this section as an unbuilt plan.

### 6.1 Scenarios (planned, not built)

```javascript
// tests/performance/booking-widget.js
export default function () {
  // Simulate 50 concurrent users completing booking flow
  const res = http.get('https://api.maissaudecv.com/v1/appointments/availability?...')
  check(res, { 'status 200': (r) => r.status === 200 })
  check(res, { 'response < 500ms': (r) => r.timings.duration < 500 })
}

export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],     // < 1% error rate
  },
}
```

### 6.2 Performance Targets (from PRD NFRs)

| Scenario | Target | k6 Threshold |
|---|---|---|
| Availability API (booking widget) | p95 < 500ms | `p(95)<500` |
| Appointment creation | p95 < 1000ms | `p(95)<1000` |
| Calendar load (week view, 50 appts) | p95 < 1000ms | `p(95)<1000` |
| Patient search | p95 < 300ms | `p(95)<300` |
| 50 concurrent users | < 1% errors | `rate<0.01` |

Performance tests run weekly in CI against staging; must pass before every production release.

---

## 7. Security Tests

❌ **No automated scan runs in CI.** Only `.github/workflows/ci.yml` exists — there is no
`security.yml`, no ZAP integration, and no evidence of a quarterly manual pentest process. The
checklist below is a reasonable list to run by hand, but none of it is automated or scheduled
today. A few items don't apply as originally worded: there's no "exam result token" (M5 doesn't
exist) and no dedicated auth-endpoint rate limit beyond the global 300 req/min default (see
`SECURITY.md`).

### 7.1 Security Test Checklist (Manual, unautomated)

- [ ] JWT with tampered role claim is rejected
- [ ] Patient A cannot access Patient B's records
- [ ] Admin actions appear in audit log
- [ ] Rate limits enforced (300 req/min global default, 60/min on `/public/*`)
- [ ] File upload rejects non-medical MIME types
- [ ] All API routes return 401 without token

---

## 8. Test Data Management

### 8.1 Seed Data (Development & Staging)

🟡 File path is actually `packages/database/src/seed.ts` (not under `prisma/`). Exact record
counts below are illustrative and weren't re-verified line-by-line.

```typescript
// packages/database/src/seed.ts
// Creates:
// - 3 doctors (cardiology, paediatrics, dental)
// - 2 receptionists
// - 1 lab tech
// - 5 services (consultation, ECG, dental, ultrasound, home visit)
// - 3 rooms
// - 10 test patients
// - 20 appointments across next 7 days
// - 2 health plans (1 family, 1 corporate)
// - Financeiro data (added later): 8 expenses, 2 manual income entries, 7 invoices spanning
//   paid/partially_paid/issued/overdue, 2 of them linked to real completed appointments
```

### 8.2 Test Patient Phone Numbers

Use fictional Cabo Verde numbers for testing:
- Receptionist test account: `+238 900 0001`
- Test patient 1: `+238 900 1001`
- Test patient 2: `+238 900 1002`

WhatsApp tests never call Meta: unit tests mock `sendWhatsAppText`, and the integration spec only exercises inbound webhooks.

---

## 9. Test Run Commands

```bash
# All unit tests, every package (turbo-orchestrated)
pnpm test

# API unit tests with coverage
pnpm --filter @cap/api test:cov

# API integration tests — real dev Postgres/Redis must be up (docker-compose)
pnpm --filter @cap/api test:integration

# All 3 E2E specs — both dev servers must be running (apps/api on 4001, apps/web on 3000)
pnpm --filter @cap/web test:e2e
```

❌ `pnpm test:all` (one command running all four tiers) and any `k6 run` command still don't exist
— there's no unifying script, and for k6, no test file to run.

---

## 10. Definition of Done

Realistic version of this list, given what actually exists:
- ✅ Unit tests written and passing for new business logic (this is genuinely followed —
  TDD red/green was used throughout the REVIEW.md fix effort and everything since)
- 🟡 "Integration tests cover new endpoints": a real layer exists now (§4), but only 4 of the API's
  many endpoint groups have one — not yet a norm applied to every new endpoint
- 🟡 E2E test added per user-facing feature: 3 flows covered now (§5), still far from "per feature"
- 🟡 80% coverage target: not verified as enforced by any CI gate or Jest config threshold
- ❌ ZAP scan / performance regression gates: neither exists to check against (§6, §7)

---

*CAP 360 · Testing Strategy v1.2 · updated 2026-09-03 against the current implementation*
