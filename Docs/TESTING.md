# CAP 360 — Testing Strategy

> **Version:** 1.1 · **Date:** updated 2026-08-30 against the current implementation
> Tools: Jest (the only real automated suite today), Playwright (one real E2E spec)

> **Implementation status:** this document was written before implementation and describes a
> testing program that mostly doesn't exist yet. What's real: **16 Jest spec files, ~225 tests**,
> all colocated with source (`apps/api/src/**/*.spec.ts`) — no separate `test/integration`
> directory, no testcontainers. **One** real Playwright spec (`apps/web/e2e/booking-flow.spec.ts`)
> — no npm script even runs it (`apps/web/package.json` has no `test`/`test:e2e` script at all). No
> k6 performance tests exist (`tests/performance/` doesn't exist). No OWASP ZAP scan runs in CI —
> only `.github/workflows/ci.yml` exists, no `security.yml`. Sections below describing tests for
> features that were never built (health plan utilisation, WhatsApp bot FSM, clinical notes, exam
> results) are pure fiction — see each feature's module doc.

---

## 1. Testing Philosophy

- **Test the business logic** — unit tests focus on domain rules (appointment conflict, plan utilisation), not infrastructure plumbing
- **Integration tests own the API contracts** — every endpoint tested with real DB and Redis
- **E2E tests cover critical user journeys** — booking flow, check-in, exam result delivery
- **Performance tests run before every major release** — validate 4G load time and concurrent user targets

---

## 2. Test Pyramid

Reality today — a much flatter shape than originally planned:

```
         ╱╲
        ╱E2E╲          1 spec — Playwright, not wired to an npm script
       ╱──────╲
      ╱ ~225   ╲       16 Jest spec files, colocated with source —
     ╱  tests    ╲     no distinct "integration" layer, no testcontainers
    ╱──────────────╲
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

❌ **Not a distinct layer today.** There is no `apps/api/test/integration/` directory, no
Supertest-driven HTTP-level suite, and no testcontainers setup. Repository-layer specs
(`*.repository.spec.ts`) exercise real Prisma query logic but live alongside every other spec
under `src/`, run by the same `jest` command as everything else.

### 4.1 Scenarios below: which ones actually hold

#### Appointment Booking API
```
POST /appointments → 201 created                                    ✅ real
POST /appointments (conflict) → 409 Conflict                        ✅ real
GET /appointments/availability → correct slots returned             ✅ real
PATCH /appointments/:id (cancel) → reminder jobs cancelled           ❌ false — jobs are cancelled
                                                                         on reschedule, NOT on
                                                                         cancellation (M1 doc §2.4)
```

#### Patient CRM API
```
POST /patients → 201 created                                        ✅ real
POST /patients (duplicate phone) → 409 Conflict                     ✅ real
GET /patients?search=Maria → returns fuzzy matches                  🟡 misleading — it's a plain
                                                                         case-insensitive `contains`
                                                                         match, not fuzzy search
GET /patients/:id → includes active health plan                     ✅ real
```

#### Auth Guard Tests
```
GET /patients (no token) → 401                                      ✅ real
GET /patients (patient token) → 403 (wrong role)                    ✅ real
GET /patients (receptionist token) → 200                            ✅ real
GET /clinical-notes (...) → ...                                     ❌ route doesn't exist — M7
                                                                         was never built
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

#### Patient Booking Flow — ✅ the one real spec, `apps/web/e2e/booking-flow.spec.ts`
Covers booking through this app's own pages, not an embeddable widget on an external site (no such
widget exists — see `M1-smart-appointment-engine.md`). Not currently wired to an npm script; run
directly with `npx playwright test` from `apps/web`.

#### Receptionist Check-In Flow — ❌ no E2E spec (feature itself is real, just untested at this layer)

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

Only these actually exist today:

```bash
# All tests, every package (turbo-orchestrated)
pnpm test

# API tests with coverage (run from apps/api, or pnpm --filter @cap/api test:cov)
pnpm --filter @cap/api test:cov

# The one E2E spec (no package script wraps this yet)
cd apps/web && npx playwright test
```

❌ `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:all`, and any `k6 run` command do not exist
— there's no script and, for k6, no test file to run.

---

## 10. Definition of Done

Realistic version of this list, given what actually exists:
- ✅ Unit tests written and passing for new business logic (this is genuinely followed —
  TDD red/green was used throughout the REVIEW.md fix effort)
- ❌ "Integration tests cover new endpoints": no distinct integration layer exists to add to (§4)
- ❌ E2E test added per user-facing feature: only one flow has ever gotten one (§5)
- 🟡 80% coverage target: not verified as enforced by any CI gate or Jest config threshold
- ❌ ZAP scan / performance regression gates: neither exists to check against (§6, §7)

---

*CAP 360 · Testing Strategy v1.1 · updated 2026-08-30 against the current implementation*
