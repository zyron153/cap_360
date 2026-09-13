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
- [x] ~~Leave request submission/approval endpoints — nothing can create or approve one via the API~~ — corrected: `POST /staff/me/leave-requests`, `GET /staff/leave-requests`, `PATCH /staff/leave-requests/:id` all exist and work; this line was stale
- [ ] Reminder channel is hardcoded to WhatsApp regardless of the `ReminderChannel` enum having SMS/email options — needs real SMS-sending infrastructure (none exists) before this can be fixed

**Frontend**
- [x] Appointments calendar page (FullCalendar week/day/month view) with staff/service dropdowns (not raw UUID inputs)
- [x] New appointment form, incl. a "make recurring" toggle (frequency/interval/end-condition)
- [x] Drag-and-drop reschedule (move only; resize disabled — the API has no concept of changing duration via reschedule)
- [x] Appointment detail modal with status-transition buttons
- [x] Dedicated waitlist view page — "Lista de Espera" tab on `/appointments`, backed by `PATCH /appointments/waitlist/:id` (waiting → notified → booked/expired); the list endpoint was already scoped to `status: "waiting"` only, widened to also include `"notified"` so a contacted patient doesn't silently vanish from the view before they're actually booked
- [x] Formal check-in workflow UI for reception — "Hoje" quick-filter + inline one-click Check-in action in the list view, instead of opening the detail modal for the common case

---

### M2 — Patient CRM

**Backend**
- [x] Full CRUD, search (name/phone/NIF), pagination, soft delete, timeline, notes
- [x] `nif` and `dateOfBirth` encrypted at rest (AES-256-GCM); `nif` has a blind-index hash for exact-match search
- [x] Phone normalization validates the +238 country code (previously just stripped characters); the rule now lives in a shared `normalizeCaboVerdePhone` helper (`@cap/types`) that both the service and the forms' Zod schema use
- [x] Form validation (REVIEW.md §5.1) — shared `dateOfBirthSchema` (no future dates, year ≥ 1900), `nifSchema` (exactly 9 digits), `caboVerdePhoneSchema` in `@cap/types`; used by `Create/UpdatePatientSchema` + `PublicBookingSchema`; `max={today}` + format hints on the 3 patient forms
- [x] NIF/phone uniqueness races (create and update) surface as `409 Conflict`, not a raw `500`
- [x] `findOrCreateByPhone` (public booking path) no longer hardcodes `consentGiven: true` — requires the real value from the caller
- [x] Right to erasure: soft-delete nulls every direct-PII field, not just `deletedAt`
- [x] ~~`POST /patients/:id/documents` (upload) — only a download-URL endpoint exists~~ — corrected: `POST`/`GET /patients/:id/documents` both exist (`patients.controller.ts`), wired to `DocumentsService.upload()`/`listByPatient()`; this line was stale. Frontend panel still didn't exist — added this pass.
- [x] `GET /patients/:id/notes` (list) — added, with `staffAuthor` included; frontend panel added (see below)
- [ ] Patient-initiated consent management (view/download own consent record) — consent is currently staff-managed only
- [ ] Tagging system (VIP, Chronic, etc.) — no field for it in the schema

**Frontend**
- [x] Patient list page, profile page (via BFF), new patient form, **edit patient form** (`/patients/[id]/edit`)
- [x] Document upload panel on patient profile — `PatientRecordsPanel.tsx`, type-select + upload + download-URL round-trip, live-verified
- [x] Notes panel with add-note form on the patient profile page — same component, live-verified with real author attribution
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
- [x] Financeiro Overview niche additions: receivables (outstanding/overdue invoices, a current snapshot), revenue by payer type (private vs. health-plan/company), revenue by service, no-show financial impact — all read from existing `Invoice`/`InvoiceItem`/`Appointment` data, no new tables
- [x] ~~Server-side price floor (a hard minimum below catalogue price, independent of the admin-override gate)~~ — corrected, this line was stale: `create()` requires `priceOverrideReason` whenever an admin bills below catalogue (`billing.service.ts`); REVIEW.md §1.3 already documents this as fully fixed
- [x] ~~Invoice-to-health-plan linkage (`health_plan_id` on invoices was never implemented)~~ — corrected: `Invoice.healthPlanId` exists and is now actually read (the new payer-type breakdown above), this line was stale
- [x] Payment-to-staff attribution — `Payment.recordedById` (FK to `Staff`), set from the authenticated caller in `POST /invoices/:id/payments`; previously no field existed at all
- [x] Invoice cancellation now requires a `reason` (`CancelInvoiceSchema`, min 3 chars) and writes a semantic before/after audit diff (status + reason), not just the generic "POST" row the interceptor already logged
- [x] Faturas Pagas listed as Entrada — `GET /financeiro/entradas/faturas` projects paid-invoice
  `Payment` rows into an Entrada-shaped row (description, billed-service category, amount, date,
  payer type), derived on read rather than duplicated into the `Income` table. `getSummary()`'s
  totals/monthly-chart already counted these payments before this addition — only the Entradas
  *list* was missing them.
- [x] Outstanding balances by patient — `GET /financeiro/saldos` (all patients with a balance,
  sorted by amount owed) and `GET /financeiro/saldos/:patientId` (one patient's balance + the
  invoices behind it), grouping the same issued/partially_paid/overdue invoices `receivables`
  above already summed clinic-wide, just per patient instead.

**Frontend**
- [x] Invoice list with status filters + KPI cards, invoice detail with payment recording
- [x] Financeiro tabs (Overview / Entradas / Despesas / Faturas) — Entradas now has a "Faturas
  Pagas" sub-tab (read-only, paginated) alongside the pre-existing manual-entries table
- [x] Financeiro Overview date-range selector (this month / last 3 months / this year / custom) — previously hardcoded to Jan 1 of the current year with no way to change it
- [x] ~~New invoice form (`/billing/new`) — invoices are currently only created automatically (appointment completion), not manually from a form~~ — corrected, this line was stale: `billing/new/page.tsx` is a real form posting to `POST /invoices`
- [x] Cancel-invoice UI — the backend endpoint existed but nothing in the frontend called it; added a "Cancelar Fatura" button on the invoice detail page with the app's standard two-step inline confirmation + required reason textarea, plus a cancelled-invoice banner showing the reason/timestamp
- [x] Payment history now shows who recorded each payment ("registado por …") when `recordedBy` is present
- [x] "Saldos em Aberto" tab (per-patient outstanding balance, sorted by amount owed) + a matching
  panel on the patient profile page (that patient's own balance, linking to each unpaid invoice)

---

### Cross-cutting — Phase 1

- [x] `@cap/types` — `Staff`, `Service`, `Room`/appointment types and Zod schemas all exist
- [x] API rate limiting (`@nestjs/throttler`) — global default 300 req/min, public routes overridden to 60 req/min
- [x] Request/performance logging (`PerformanceInterceptor`)
- [x] Unit test suite (Jest) — 427 tests across guards, interceptors, services, repositories (27 spec files)
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
- [x] ~~Utilisation counter — `usageCount` column exists, nothing increments it~~ — corrected: `AppointmentsService.updateStatus()`'s completed branch calls `healthPlansService.incrementUsage()`, unit-tested; this line was stale
- [x] ~~Expiry notification job (30/15/7 days)~~ — corrected: `NotificationsProcessor.handleHealthPlanExpiring()` exists, scheduled daily at 08:00 (`notifications.service.ts`), 4 tests; this line was stale
- [x] Co-pay/coverage discount — `HealthPlansService.getActiveCoverage()` (active plan+product,
  unexpired, `coverageRules.coverage` > 0) + `BillingService.applyHealthPlanDiscount()` apply the
  patient's coverage % as a negative line item on invoice creation and on the appointment-completion
  auto-draft alike; invoice gets linked to that `healthPlanId` when the caller didn't already supply
  one. 14 new unit tests (`billing.service.spec.ts`, `health-plans.service.spec.ts`).
- [x] Renewal — `POST /health-plans/:id/renew` (admin, receptionist), manually staff-triggered (no
  scheduled auto-renew job — see decision note below). Extends `endDate` by the product's own new
  `durationMonths` field (1/3/6/12 months, `@default(1)` for every pre-existing product), from
  whichever is later, the plan's current `endDate` or today, and reactivates a lapsed (`active:
  false`) plan. Rejects (`400`) renewing a plan whose product has been deactivated. Writes a
  before/after audit diff, same mechanism as `BillingService.cancel`. 5 new unit tests
  (`health-plans.service.spec.ts`) + a dedicated integration spec
  (`health-plan-renewal.integration-spec.ts`, 3 tests) against the real dev DB.
  > **Scope decision:** a scheduled daily auto-renew job (mirroring the expiry-notification cron)
  > was considered and explicitly rejected in favor of a manual endpoint — renewal has billing
  > consequences (a fresh plan-period, implicitly a fresh charge), so staff confirm it rather than
  > it happening silently overnight. "Auto-renew logic" in this file's title now means "the logic
  > that computes a renewal," not "an automatic scheduler."
- [x] `HealthPlan`/`HealthPlan` list responses now include `holderPatientName` (batched lookup,
  `HealthPlansRepository.findPatientNamesByIds`) when a plan has a `holderPatientId` — needed once
  a dedicated list page (below) had to show *who* holds a plan without an N+1 query per row; only
  added to `findAllPlans`/`findPlanById`, so it never appears on a plan with no holder.
- [ ] `POST /health-plans/:id/members` / member roster — a `HealthPlan` links to one holder patient directly today, not a membership join table (explicitly out of scope for this pass — see scope decision above)

~~Bug found while building the renewal endpoint above (2026-09-12): `HealthPlansRepository
.nextPlanNumber`'s two-argument advisory lock — `pg_advisory_xact_lock(${NAMESPACE}, ${year})` with
no explicit cast — 42883s against real Postgres ("function pg_advisory_xact_lock(bigint, bigint)
does not exist"), because Prisma's pg driver binds plain numeric placeholders as `bigint` and
Postgres has no two-argument `bigint` overload, only the two-argument `int` one. Every unit test for
this method passed (fully mocked, never touches real Postgres), so this shipped invisibly — the
integration test suite (below) would have caught it immediately, but every integration spec was
itself broken (see Testing section) until this same pass, so nothing ever actually exercised
`createPlan()` without a caller-supplied `planNumber` against a real database.~~
**Fixed** — explicit `::int` casts on both lock-key arguments
(`pg_advisory_xact_lock(${NAMESPACE}::int, ${year}::int)`).

**Frontend**
- [x] Browse products, subscribe/change/remove plan from the patient profile
- [x] Company management (create/edit/deactivate/reactivate) — **Gestão de Acesso → Organização**,
  the first frontend for the `Company` entity/`/companies` API, which existed backend-only until now.
  Not a corporate HR portal (see below) — this is admin-side company-record management only.
- [x] Dedicated health plans list/detail pages — `/health-plans` is now tabbed (**Produtos**, the
  pre-existing product-catalogue/KPI page, unchanged; **Planos**, new — every plan instance, with
  search + status filter pills [Ativo/A Expirar/Expirado/Inativo, computed client-side from
  `active`+`endDate`] and an inline "Renovar" action) plus a new `/health-plans/[id]` detail page
  (mirrors `billing/[id]`'s thin-wrapper-around-a-shared-body pattern) showing one plan's full
  detail with its own "Renovar Plano" action. A "Renovar" action was also added to the pre-existing
  patient-profile `PlanModal` (`patients/page.tsx`) for a lapsed/expiring plan, and the patient
  profile's plan badge now links to `/health-plans/[id]`, so the new pages are reachable from every
  existing plan-management surface, not just the sidebar. New "Ciclo de Renovação" field on the
  product create form sets `durationMonths` (defaults to monthly if left alone).
- [ ] Corporate HR self-service portal (Phase 4) — still nothing lets a `corporate_hr` account log in
  and self-serve; Organização doesn't change this, it's an admin tool

~~Known bug: `planNumber` is client-computed (count+1), not a DB sequence — a race between two
concurrent "add plan" submissions can collide on the unique constraint and surface as a raw `500`.~~
**Fixed** — `planNumber` is now generated server-side (`HealthPlansRepository.nextPlanNumber`), race-safe
via a Postgres advisory lock keyed by product code + year, same pattern as `billing.repository.ts`'s
invoice numbering. Caller-supplied `planNumber` is still honored as-is when provided (now optional).
~~The lock itself was briefly broken (2026-09-12): `pg_advisory_lock`/`unlock` as two separate
top-level Prisma calls don't reliably land on the same pooled connection, so the unlock could
silently no-op while the lock leaked forever on an idle connection — reproduced live, a genuine
deadlock, not a theoretical one. Fixed same day: lock/query/unlock now run inside one
`prisma.$transaction` using `pg_advisory_xact_lock` (transaction-scoped, self-releasing on
commit/rollback), which pins a single physical connection for the whole critical section. Same fix
applied to `billing.repository.ts`'s invoice numbering, which had the identical bug.~~

### M5 — Exam Results Portal — 🟡 stub only
`ExamRequest` exists as a schema stub (self-labelled "Phase 1 stub"), no controller/service at
all. No result field on the model — no `resultR2Key`, no `resultedAt`, no `exam_results` table.
Nothing to time-limit or download.

---

## Phase 3 — Clinical Operations

### M7 — Clinical Records — ✅ built, rewritten for CAP (not the original medical-clinic spec)
Structured session notes (presenting concerns / observations / assessment / plan), a risk-level
flag, prescriptions, and referrals — `clinical_notes`, `prescriptions`, `prescription_items`,
`referrals` tables all real. Access scoped by note authorship (a clinician sees only their own
notes; admin sees everything) rather than a patient-clinician assignment table this app has
nowhere else. See `Docs/modules/M7-clinical-records-emr.md` v2.0 for the full shape — it no longer
resembles the original SOAP/ICD-10 design, which was written before the client became CAP.

### M8 — Staff & Resource Scheduler

**Backend**
- [x] Staff CRUD, invitations, weekly recurring availability
- [x] `StaffShift`, `LeaveRequest` models with repository methods
- [x] Invitation activation hashes the invitee's own chosen password (argon2id) directly — no
  external identity provider is involved anymore, so the transactional-rollback machinery this
  used to need (delete an orphaned Keycloak user if the local `Staff` write failed) is gone;
  there's nothing external left to get out of sync with
- [x] Room/equipment conflict detection (see M1 — same underlying fix)
- [x] Staff deactivation — `DELETE /staff/:id` (admin-only, self-deactivation blocked), soft-deletes via the
  `deletedAt` column that already existed and was already used by every staff read path but had no write
  endpoint to actually set it. `SessionAuthGuard` now also rejects a deactivated staff member's still-live
  session on their next request; login already rejected them for free via the existing `deletedAt: null` filter.
- [x] ~~Leave request submission/approval endpoints (see M1 note — schema and availability-logic support exist, no way to create one via the API)~~ — corrected: same duplicate/contradictory line as M1's own corrected copy above; `POST /staff/me/leave-requests` etc. all exist

**Frontend**
- [x] Staff identity lifecycle (invite/edit/deactivate) consolidated into **Gestão de Acesso →
  Utilizadores** as the one canonical place — the Staff page's own "Novo Colaborador"/"Editar"
  actions and Settings' separate "Utilizadores" tab (a near-duplicate, independently-built) are
  both removed. Staff page (`Equipa & Turnos`) is now a read-only roster of the same data, plus
  the availability-blocking calendar, which stayed since it's a scheduling concern, not an identity
  one. `Gestão de Acesso` (sidebar) is now the single 3-level surface — **Organização** (Company
  CRUD, new — the `Company` entity and its `/companies` API already existed but had no frontend at
  all), **Perfis** (the existing role-permission matrix, simplified to the 5 real `StaffRole` values
  — dropped the old "create an arbitrary custom profile" flow, which produced profiles that could
  never actually be assigned to anyone since `Staff.role` is a fixed Prisma enum), and
  **Utilizadores** (the consolidated lifecycle above, plus pending-invitation visibility/cancel).
  Settings' own duplicate "Gestão de Acesso" tab (`components/settings/AccessTab.tsx`, a
  byte-for-byte copy of the same Perfis logic) is deleted outright.
- [ ] Shift-planner calendar UI (drag-to-assign)

### M9 — Home Visit Manager — 🎭 not started
UI mockup only (`visits/page.tsx`). **No `home_visits` table** — corrected from this file's
previous claim that it was "already in schema." No geo/address validation, no persisted status
tracking, no assignment logic.

---

## Phase 4 — Growth

### M10 — Analytics & Reporting — 🟢 real backend for the appointment/patient side, exports still not built
- [x] `apps/api/src/modules/analytics` (new, 2026-09-12): `GET /analytics/summary?from=&to=` —
  appointments-by-month, total appointments, attendance rate (`completed / (completed + no_show)`,
  pending/confirmed/cancelled excluded from both sides), top services, peak hours-of-day, all
  scoped to the query range; plus two current-snapshot fields independent of that range — active
  patients (>=1 appointment in the trailing 12 months) and their plan-product distribution
  (`"Particular"` bucket for no active coverage). See `API-SPEC.md` §12.
- [x] `analytics/page.tsx` rewritten to consume it — every KPI/chart that was a hardcoded const
  array (`MONTHLY_APPTS`, `SERVICES`, `PEAK_HOURS`, `PLAN_DIST`, the "834 pacientes activos" and
  "87% taxa de presença" numbers) is gone. Added the same date-range selector
  (mês/trimestre/ano/personalizado) `billing/ResumoTab.tsx` already has, replacing the static
  "Jan – Jun 2026" badge — Receita YTD/Mensal now respect the selected range too, not hardcoded to
  calendar-year-to-date.
- [ ] Materialised views (`mv_daily_appointments`, `mv_monthly_revenue`) — current queries are
  plain live-table aggregation, fine at this data volume, revisit if it stops being fine
- [ ] PDF/Excel/CSV export (`GET /analytics/export`)
- [ ] Per-doctor/staff productivity breakdown, patient demographics (age band, neighbourhood),
  booking-source attribution, health-plan renewal/churn rate — everything in
  `M10-analytics-reporting.md` §§2.4–2.6 beyond what's listed done above
- [ ] Corporate HR's own scoped view (§7 of that doc) — blocked on the same "no company-scoped
  data isolation" gap as the rest of the corporate_hr role (see TODO.md's Self-Service Portals note)

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
- [x] ~~Helmet headers in `main.ts`~~ — corrected: `app.use(helmet())` is already the second line of `bootstrap()`; this line was stale
- [ ] OWASP ZAP scan in CI
- [ ] Quarterly penetration test plan

See `SECURITY.md` for the full, section-by-section implementation status.

### Testing
- [x] Extensive unit test suite: every API module has a service spec (patients, appointments, billing, staff, notifications, financeiro, services, companies, parametrizacao, public, health-plans, clinical-records, bff, documents, efatura, settings, auth), plus encryption, session-auth guard, audit interceptor, request context — 442 tests total (27 suites), up from 427 (health-plans renewal + holder-name enrichment, §M4 above)
- [x] ~~Integration tests against a real test DB~~ — this contradicted this file's own line 137 ([x], 4 specs / 9 tests); duplicate line removed
- [x] 5 specs / 13 tests, up from 4/9 — new `health-plan-renewal.integration-spec.ts` (renew extends
  endDate + reactivates, rejects a deactivated product, 404s a missing plan).
  > ~~Every integration spec was silently broken (2026-09-12): `test/integration/setup.ts` still
  > called `app.useGlobalPipes(new ZodValidationPipe())` with no schema — a leftover from before
  > REVIEW.md §4.3 made the pipe's `schema` arg required for its (now per-route-only) usage, which
  > `main.ts` itself was updated for at the time but this test-only bootstrap file was not. The
  > constructor call itself started throwing, failing every spec file at compile/bootstrap before a
  > single test could run — caught only because writing the new health-plan spec above required
  > running the suite at all.~~ **Fixed** — dropped the dead global-pipe registration from
  > `setup.ts`, matching `main.ts`.
- [~] E2E tests (Playwright) — 8 specs / 17 tests now (adds `health-plan-renewal`: renewing an
  expired plan from its detail page, and the Planos tab list/filter/renew), up from 7/15. Financeiro
  and health-plan renewal now have real e2e coverage; still nothing for a real e-Fatura submission
  (only the config-less "pending" state is asserted), and health-plan instances still have no delete
  endpoint, so `health-plan-renewal.spec.ts`'s own fixtures are left in the dev DB (product
  deactivated afterward, plan and company are not) — documented in that spec's header comment.
  Fixed along the way: `/billing/new` (Nova Fatura form) sent `unitPrice` as a string to `POST
  /invoices`, which always 400'd — writing the new spec caught a manual-invoice-creation feature
  that was fully broken. Older note: `playwright.config.ts`'s `baseURL` and both older specs' `API`
  constant were still pointing at the pre-reconfiguration ports (3000/4001) from before the `pnpm
  dev` port change — all e2e tests would have failed to even connect until this was caught
- [ ] Performance/load tests (k6)

### Code Quality (REVIEW.md §4)
- [x] §4.1 — one shared `apps/web/components/ui/field.tsx` (implicit `<label>` wrapper), 10 copied `Field`/`FieldRow` definitions deleted and re-pointed at it; `components/settings/shared.tsx` re-exports it
- [x] §4.2 — `apps/web/lib/use-debounced-value.ts`; patient search debounced (300ms), page-1 reset moved to fire on the settled term
- [x] §4.3 — no-op global `ZodValidationPipe` removed from `main.ts`; the pipe's `schema` arg is now required (per-route usage unchanged)
- [x] §4.4 — every `apps/api/src` `console.*` moved to NestJS `Logger`
- [x] §4.5 — service-level spec suites for `services`, `companies`, `parametrizacao`, `public` (33 tests). Every API module now has a service spec.
- [x] §5.1 — patient form validation gaps (DOB future dates, NIF/phone format) — see M2 backend above

### UX (REVIEW.md §5)
- [x] §5.1 — done (see Code Quality/M2)
- §5.2 / §5.3 / §5.5 — verified fine at review time (color+label badges, loading/error/empty states, design consistency)
- [x] §5.4 — sidebar "Beta" badges on mock modules (done earlier)

### DevOps
- [ ] Staging/production environments — not live
- [ ] Sentry, Grafana/Prometheus, Loki — not set up
- [ ] Automated PostgreSQL backups
- [ ] Uptime monitoring

---

## Immediate Next Steps

REVIEW.md's entire fix list (Sections 1–5, incl. all of §4) is now closed. Section 6 is a
redesign exercise, not an implementation task. What remains in this file below is all
new-feature / infra work (M3, M5, M9, M10, Phase 4, k8s, backups, k6, ZAP, SMS infra) — each
needs its own scoping conversation per the notes on those sections.

> 🟡 The 5-item "highlights" list this section used to carry here predates this file's Phase 1–3
> roadmap work — items 2–5 (leave-requests, document upload, price floor, health-plan utilisation)
> were completed there, and M7 Clinical Records (of item 1's still-mocked modules) is now built —
> see that section above. M3 WhatsApp, M5 Exams, M9 Home Visits, and M10 Analytics remain mockups.
