# CAP 360 — Development TODO

> Track every task across all 4 phases. Check off items as they are completed.
> Spec source of truth: `PRD.md`, `ARCHITECTURE.md`, `API-SPEC.md`, `DATABASE-SCHEMA.md`, `modules/M*.md`
> Reconciled against the actual codebase 2026-08-30 — most of this file predated real
> implementation and had drifted badly (wrong package names, "missing" endpoints that have long
> existed, a mobile app scaffold that was never created). See `REVIEW.md` for the full audit.
> Updated again 2026-08-31: Keycloak was removed and replaced with self-hosted auth.

---

## Legend
- `[x]` Done
- `[ ]` To do
- `[~]` Partially done / stubbed

---

## Scaffold & Infrastructure

- [x] Turborepo monorepo (`turbo.json`, `pnpm-workspace.yaml`)
- [x] Shared packages: `@cap/config`, `@cap/types`, `@cap/database` (renamed from `@cms/*` in the CAP rebrand)
- [x] Root `.env.example` with all required variables
- [x] `packages/database` — Prisma schema, seed, client export
- [x] Docker Compose dev stack (postgres:16 on 5434, redis:7 — no `keycloak` service since 2026-08-31)
- [x] `infra/docker/api.Dockerfile` + `web.Dockerfile`
- [x] GitHub Actions CI/CD pipeline (`.github/workflows/ci.yml`)
- [x] ~~Keycloak realm import file~~ — moot; `infra/keycloak/` deleted along with Keycloak itself
- [ ] Kubernetes manifests (`infra/k8s/`) — not started; no production deployment target yet
- [ ] `docker-compose.prod.yml` — not started
- [x] Pre-commit hooks — `husky` + `lint-staged`, per-package `lint`+`typecheck` gated on staged-file globs
- [x] `CONTRIBUTING.md` — exists, root of repo

---

## Performance Observability (cross-cutting)

- [x] `AsyncLocalStorage` request context, `PerformanceInterceptor` (`[PERF]`/`[SLOW]` logging + `X-Request-*` headers)
- [x] Prisma slow-query logging (>100ms)
- [x] `usePerfStore` + `PerfPanel` dev overlay on the frontend
- [x] `WebVitals` component, `@next/bundle-analyzer`, Turbopack dev server
- [x] BFF endpoints: `GET /bff/patient-screen/:id`, `GET /bff/billing-summary`, `GET /bff/staff`
- [x] N+1 fixes: appointment reschedule's reminder-cancellation loop, patient create's phone+NIF checks (both `Promise.all`)

See `PERFORMANCE_UPGRADES.md` for the full list.

---

## Phase 1 — Foundation

### M1 — Smart Appointment Engine

**Backend**
- [x] `GET /appointments/availability`, `GET /appointments`, `GET /appointments/:id`, `POST /appointments`
- [x] `PATCH /appointments/:id/status`, `PATCH /appointments/:id/reschedule`
- [x] `GET|POST /appointments/waitlist`
- [x] BullMQ `reminders` queue (48h/24h/2h), Socket.io `appointment:created`/`appointment:updated`
- [x] Staff + Services modules with full CRUD (`GET /staff`, `GET /services`, etc.)
- [x] Redis-backed conflict locking — every 30-min grid bucket an appointment spans, per staff member **and per room** when one is assigned
- [x] `getAvailability`/`create()` honor clinic business hours, `PublicHoliday` (recurring + one-off), and approved `LeaveRequest` — previously only `create()` checked hours at all, and leave/holidays weren't checked anywhere
- [x] Room/equipment double-booking conflict detection (own conflict query + own Redis lock buckets, mirroring the staff-conflict pattern)
- [x] Recurring appointments (`POST /appointments/series`) — `AppointmentSeries` model, daily/weekly/monthly with configurable interval, ends on a fixed count or a date, pre-generated best-effort occurrences, idempotency-key protected
- [x] Idempotency keys end-to-end for booking (client-generated, replay-safe)
- [x] Extensive unit test suite (`appointments.service.spec.ts`, `appointments.repository.spec.ts` — availability, conflicts, holidays/leave, rooms, series)
- [ ] Leave request submission/approval endpoints — `LeaveRequest` rows are honored by availability logic but nothing can create or approve one via the API (direct DB access only)
- [ ] Reminder channel is hardcoded to WhatsApp regardless of the `ReminderChannel` enum having SMS/email options — needs real SMS-sending infrastructure (none exists) before this can be fixed

**Frontend**
- [x] Appointments calendar page (FullCalendar week/day/month view) with staff/service dropdowns (not raw UUID inputs)
- [x] New appointment form, incl. a "make recurring" toggle (frequency/interval/end-condition)
- [x] Drag-and-drop reschedule (move only; resize disabled — the API has no concept of changing duration via reschedule)
- [x] Appointment detail modal with status-transition buttons
- [ ] Dedicated waitlist view page
- [ ] Formal check-in workflow UI for reception (status update exists generically, no scan/dedicated flow)

---

### M2 — Patient CRM

**Backend**
- [x] Full CRUD, search (name/phone/NIF), pagination, soft delete, timeline, notes
- [x] `nif` and `dateOfBirth` encrypted at rest (AES-256-GCM); `nif` has a blind-index hash for exact-match search
- [x] Phone normalization validates the +238 country code (previously just stripped characters)
- [x] NIF/phone uniqueness races (create and update) surface as `409 Conflict`, not a raw `500`
- [x] `findOrCreateByPhone` (public booking path) no longer hardcodes `consentGiven: true` — requires the real value from the caller
- [x] Right to erasure: soft-delete nulls every direct-PII field, not just `deletedAt`
- [ ] `POST /patients/:id/documents` (upload) — only a download-URL endpoint exists; nothing can populate `patient_documents` via the API
- [ ] `GET /patients/:id/notes` (list) — creation exists (`POST`), no list endpoint or UI panel
- [ ] Patient-initiated consent management (view/download own consent record) — consent is currently staff-managed only
- [ ] Tagging system (VIP, Chronic, etc.) — no field for it in the schema

**Frontend**
- [x] Patient list page, profile page (via BFF), new patient form, **edit patient form** (`/patients/[id]/edit`)
- [ ] Document upload panel on patient profile (blocked on the missing backend endpoint above)
- [ ] Notes panel with add-note form on the patient profile page
- [ ] Patient search as autocomplete in the booking form (currently a plain dropdown)

---

### M6 — Billing & Invoicing / Financeiro

**Backend**
- [x] Invoice CRUD, sequential numbering, line items, payment recording with a draft→issued→partially_paid→paid state machine
- [x] PDF receipt generation (`generateReceiptPdf`, `pdfkit`) + R2 upload, with a placeholder-URL fallback when R2 isn't configured
- [x] Auto-create draft invoice when an appointment's status → `completed`
- [x] `recordPayment` runs insert+resum+status-update in one transaction, with a guard against `amountPaid` exceeding the invoice total
- [x] `POST /invoices/:id/cancel` — rejects an already-paid invoice, idempotent on already-cancelled, triggers the (pre-existing but previously untriggered) E-Fatura cancel job when applicable
- [x] Overdue-invoice detection — a pre-existing weekly job already emailed a digest of overdue invoices, but nothing ever set that status; it now marks `issued`/`partially_paid` invoices past `dueDate` as `overdue` first
- [x] E-Fatura (Cabo Verde tax authority) submission via BullMQ queue + retry, with its own processor test suite
- [x] Price-override visibility (logged when an admin bills at a price other than the catalogue) + admin-only RBAC gate on who can override
- [x] Financeiro module (not in the original design): Despesas (expenses, approval workflow, receipt upload), Entradas (manual income), Overview (`GET /financeiro/summary`)
- [ ] Server-side price floor (a hard minimum below catalogue price, independent of the admin-override gate)
- [ ] Invoice-to-health-plan linkage (`health_plan_id` on invoices was never implemented)

**Frontend**
- [x] Invoice list with status filters + KPI cards, invoice detail with payment recording
- [x] Financeiro tabs (Overview / Entradas / Despesas / Faturas)
- [ ] New invoice form (`/billing/new`) — invoices are currently only created automatically (appointment completion), not manually from a form

---

### Cross-cutting — Phase 1

- [x] `@cap/types` — `Staff`, `Service`, `Room`/appointment types and Zod schemas all exist
- [x] API rate limiting (`@nestjs/throttler`) — global default 300 req/min, public routes overridden to 60 req/min
- [x] Request/performance logging (`PerformanceInterceptor`)
- [x] Unit test suite (Jest) — 251 tests across guards, interceptors, services, repositories
- [x] **Self-hosted auth (2026-08-31, replaces Keycloak)**: argon2id password hashing, Redis-backed
  sessions (httpOnly/Secure/SameSite=Lax cookie), per-IP + per-account login rate-limiting/lockout,
  forgot/reset/change-password flows — `AUTH_BYPASS=true` dev bypass preserved, fails safe (requires
  the literal value, not just "unset")
- [x] Auth flow in Next.js (`middleware.ts`, checks the session cookie directly — no more
  Authorization-header translation, since the API now reads the cookie itself)
- [x] API client in Next.js (`/api/*` rewrite proxy to the NestJS API)
- [x] Integration test suite against a real dev DB (`supertest`, `apps/api/test/integration/`) — 4 specs / 9 tests covering booking conflict, patient erasure, invoice payment, staff invitation→activation→login; see `Docs/TESTING.md` §4
- [x] Sentry integration — wired in both `apps/api/src/main.ts` and `apps/web`'s `instrumentation(-client).ts`, no-op until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set (no real DSN configured yet)

---

## Phase 2 — Communication

### M3 — WhatsApp Integration — 🎭 not started
UI mockup only (`whatsapp/page.tsx`, hardcoded `CONVERSATIONS` array, zero `fetch` calls). No
`apps/api/src/modules/whatsapp` directory, no webhook handler, no bot FSM, no agent inbox
persistence. The `ReminderChannel` enum and `appointment_reminders` table from M1 are the one
piece of groundwork already laid — ready to be pointed at a real send service.

### M4 — Health Plan Management

**Backend**
- [x] Plan products, company linkage, patient subscription — all implemented (`health-plans.controller.ts`)
- [ ] Utilisation counter — `usageCount` column exists, nothing increments it
- [ ] Expiry notification job (30/15/7 days)
- [ ] Auto-renew logic
- [ ] `POST /health-plans/:id/members` / member roster — a `HealthPlan` links to one holder patient directly today, not a membership join table

**Frontend**
- [x] Browse products, subscribe/change/remove plan from the patient profile
- [ ] Dedicated health plans list/detail pages
- [ ] Corporate HR self-service portal (Phase 4)

Known bug: `planNumber` is client-computed (count+1), not a DB sequence — a race between two
concurrent "add plan" submissions can collide on the unique constraint and surface as a raw `500`.

### M5 — Exam Results Portal — 🟡 stub only
`ExamRequest` exists as a schema stub (self-labelled "Phase 1 stub"), no controller/service at
all. No result field on the model — no `resultR2Key`, no `resultedAt`, no `exam_results` table.
Nothing to time-limit or download.

---

## Phase 3 — Clinical Operations

### M7 — Clinical Records (EMR-lite) — 🎭 not started
UI mockup only (`records/page.tsx`, local React state, gone on refresh). **No `clinical_notes`,
`prescriptions`, or `referrals` table** — corrected from this file's previous claim that they were
"already in schema." Only the generic, unstructured `PatientNote` model exists. Given the client
is now CAP, a psychology clinic, this module's real shape (session notes, treatment plans) likely
needs a fresh spec pass rather than resuming the original SOAP/ICD-10/prescription design written
for a medical clinic.

### M8 — Staff & Resource Scheduler

**Backend**
- [x] Staff CRUD, invitations, weekly recurring availability
- [x] `StaffShift`, `LeaveRequest` models with repository methods
- [x] Invitation activation hashes the invitee's own chosen password (argon2id) directly — no
  external identity provider is involved anymore, so the transactional-rollback machinery this
  used to need (delete an orphaned Keycloak user if the local `Staff` write failed) is gone;
  there's nothing external left to get out of sync with
- [x] Room/equipment conflict detection (see M1 — same underlying fix)
- [ ] Leave request submission/approval endpoints (see M1 note — schema and availability-logic support exist, no way to create one via the API)
- [ ] Shift-planner calendar UI (drag-to-assign)

### M9 — Home Visit Manager — 🎭 not started
UI mockup only (`visits/page.tsx`). **No `home_visits` table** — corrected from this file's
previous claim that it was "already in schema." No geo/address validation, no persisted status
tracking, no assignment logic.

---

## Phase 4 — Growth

### M10 — Analytics & Reporting — 🎭 not started
UI mockup only (`analytics/page.tsx`, 8 hardcoded const arrays). No `apps/api/src/modules/analytics`
directory, no materialised views. The Financeiro Overview tab is the one piece of real, live-data
analytics anywhere in the app — worth treating as the template for what this module should
actually look like.

### Self-Service Portals — not started
No patient-facing login path exists at all — the auth system built 2026-08-31 (replacing
Keycloak) is deliberately staff-only. The old unreachable "patient" RBAC branches (`GET
/patients/me`, the patient-ownership check in `documents.controller.ts`) were removed as dead
code rather than kept around. Corporate HR portal: `corporate_hr` is a valid role in a few role
lists, but no company-scoped data isolation exists in any query — see `GET /health-plans`'s
caller-supplied `companyId` param in `ROLES-PERMISSIONS.md` §4.2 for a concrete instance.

### Vinti4 Payment Gateway — not started

### ~~React Native Mobile App~~ — cut
There is no `apps/mobile` — the "Expo placeholder scaffold" this file previously listed as done
was never actually created. Not on the current roadmap.

### ~~DICOM Viewer~~ — cut
See `PRD.md` (F-18) and `ARCHITECTURE.md` — permanently out of scope now that the client is a
psychology clinic with no ultrasound/ECG imaging use case.

---

## Ongoing / Cross-cutting

### Security
- [x] Field-level encryption for `nif`/`dateOfBirth` (AES-256-GCM, `EncryptionService`) — clinical notes don't exist yet to encrypt
- [x] Rate limiting — global 300/min + public 60/min (see above; the original "1000/min WhatsApp webhook" line doesn't apply — no webhook exists)
- [x] MFA required (`CONFIGURE_TOTP`) for new admin/doctor/corporate_hr accounts
- [x] `audit_log` genuinely append-only via a DB trigger (not just app convention)
- [ ] Helmet headers in `main.ts`
- [ ] OWASP ZAP scan in CI
- [ ] Quarterly penetration test plan

See `SECURITY.md` for the full, section-by-section implementation status.

### Testing
- [x] Extensive unit test suite: patients, appointments, billing, staff, notifications, financeiro, encryption, auth (password/session/service), session-auth guard, audit interceptor, request context — 251 tests total
- [ ] Integration tests against a real test DB
- [ ] E2E tests (Playwright) — `apps/web/e2e/booking-flow.spec.ts` exists as a starting point, not a full suite
- [ ] Performance/load tests (k6)

### DevOps
- [ ] Staging/production environments — not live
- [ ] Sentry, Grafana/Prometheus, Loki — not set up
- [ ] Automated PostgreSQL backups
- [ ] Uptime monitoring

---

## Immediate Next Steps

REVIEW.md tracks the authoritative, prioritized list of what's actually next (Sections 4–8:
code quality, UX findings, redesign suggestions, and the phase-by-phase checklist this file
mirrors). Highlights as of this update:

1. Decide whether to scope and build any of the fully-mocked modules (M3 WhatsApp, M5 Exams, M7
   Clinical Records, M9 Home Visits, M10 Analytics) — each is a real feature build, not a bug fix
2. Leave-request submission/approval endpoints (M1/M8) — the availability logic already honors an
   approved `LeaveRequest`, but nothing can create one via the API today
3. Document upload endpoint (M2) — the download side exists, upload doesn't
4. Server-side price floor (M6)
5. Health-plan utilisation counter, expiry reminders, auto-renew (M4)
