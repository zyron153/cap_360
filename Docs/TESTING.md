# CAP 360 — Testing Strategy

> **Version:** 1.2 · **Date:** updated 2026-09-03 against the current implementation
> Tools: Jest (unit + a real integration tier), Playwright (3 real E2E specs, wired to `test:e2e`)

> **Implementation status:** this document was written before implementation and describes a
> testing program most of which now genuinely exists. What's real: **22 Jest unit spec files,
> ~292 tests**, colocated with source (`apps/api/src/**/*.spec.ts`); a separate **integration tier**
> (`apps/api/test/integration/*.integration-spec.ts`, 4 files / 9 tests, supertest against the real
> dev Postgres + Redis, run via `pnpm --filter @cap/api test:integration`); **3** real Playwright
> specs (`apps/web/e2e/*.spec.ts`, 9 tests total), wired to `pnpm --filter @cap/web test:e2e`. No
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
        ╱E2E╲          9 tests — 3 Playwright specs, wired to test:e2e
       ╱──────╲
      ╱   9    ╲       4 integration spec files — supertest + real
     ╱  tests    ╲     dev Postgres/Redis, no testcontainers yet
    ╱──────────────╲
   ╱     ~292        ╲  22 Jest unit spec files, colocated with source,
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

#### Health Plan Service — ❌ doesn't exist
No such test suite — the health-plans module has no service-layer spec file, and none of
utilisation-decrementing, plan-exhaustion blocking, renewal reminders, or co-pay exist to test
(see `M4-health-plan-management.md`).

#### Billing Service — ✅ mostly real, in `billing.service.spec.ts` / `billing.repository.spec.ts`
```typescript
describe('BillingService', () => {
  it('generates INV-YYYY-NNNN invoice numbers under an advisory lock', async () => { ... }) // ✅ real
  it('marks invoice as paid when full amount received', async () => { ... })            // ✅ real
  it('marks invoice as partially_paid for partial payment', async () => { ... })        // ✅ real
  it('rejects a payment that would push totalPaid over the invoice total', async () => { ... }) // ✅ real
  it('replays an idempotent payment instead of double-charging', async () => { ... })   // ✅ real
  // ❌ "apply health plan discount": nothing computes one (see M6 doc §2.1/§2.3)
})
```

#### Bot FSM — ❌ doesn't exist
No WhatsApp bot, no FSM, no such test suite — M3 has no backend at all.

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
- **`staff-invitation.integration-spec.ts`** — the one spec that deliberately skips `AUTH_BYPASS`:
  real admin login → invite → activation (token read straight from the DB row, the same way a real
  invitee would read it from their inbox — the API never returns it) → the new hire's own real
  login → session actually authenticates on a protected route with their real role.

Note on the M1 §2.4 reminder-cancellation gap this section used to flag as unfixed: it was closed
in the roadmap's Phase 1 (`appointments.service.ts`'s `cancelPendingReminders` now runs from both
`reschedule()` and `updateStatus()`'s cancelled branch) — covered by unit tests, not (yet) one of
the 4 integration specs above.

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

#### Staff Invitation → Activation → Login — ✅ covered, but as an **integration** spec, not E2E
See §4's `staff-invitation.integration-spec.ts` — the activation token only ever reaches a real
invitee by email (the API deliberately never returns it), so there's no way for a *browser* flow to
learn it without either reversing that email-only design or reaching into the DB from `apps/web`'s
own toolchain. Reading the token straight from Postgres is exactly as legitimate as it would be
inside a backend integration spec (which already has DB access for setup/teardown) — doing the same
from a Playwright spec would need a new cross-package dependency for one test. The activation *form*
itself is plain, low-risk presentational code not covered at this layer.

Run with `pnpm --filter @cap/web test:e2e` (wired to the `test:e2e` script — previously nothing ran
these). All 3 specs need both dev servers up (`apps/api` on 4001, `apps/web` on 3000) — they hit
the real running stack, not a mocked one.

#### Doctor Clinical Note Flow — ❌ doesn't exist — M7 (EMR) was never built

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
```

### 8.2 Test Patient Phone Numbers

Use fictional Cabo Verde numbers for testing:
- Receptionist test account: `+238 900 0001`
- Test patient 1: `+238 900 1001`
- Test patient 2: `+238 900 1002`

WhatsApp integration tests use mock webhook handler (no real messages sent).

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
