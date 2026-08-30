# Clínica Mais Saúde 360 — Development TODO

> Track every task across all 4 phases. Check off items as they are completed.
> Spec source of truth: `PRD.md`, `ARCHITECTURE.md`, `API-SPEC.md`, `DATABASE-SCHEMA.md`, `modules/M*.md`

---

## Legend
- `[x]` Done
- `[ ]` To do
- `[~]` Partially done / stubbed

---

## Scaffold & Infrastructure

- [x] Turborepo monorepo (`turbo.json`, `pnpm-workspace.yaml`)
- [x] Shared packages: `@cms/config`, `@cms/types`, `@cms/database`
- [x] Root `.env.example` with all required variables
- [x] `packages/database` — Prisma schema, seed, client export
- [x] Prisma migration `init` applied (29 tables created)
- [x] Database seeded (6 services, 5 rooms)
- [x] Docker Compose dev stack (postgres:16 on 5434, redis:7, keycloak:24)
- [x] `infra/docker/api.Dockerfile` + `web.Dockerfile`
- [x] GitHub Actions CI/CD pipeline (`ci.yml`)
- [ ] Keycloak realm import file (`infra/keycloak/maissaude-realm.json`) — realm, client, roles pre-configured
- [ ] Kubernetes manifests (`infra/k8s/`) — Deployments, Services, Ingress, HPA
- [ ] `docker-compose.prod.yml` — production-ready compose with resource limits
- [ ] Pre-commit hooks (lint + typecheck) — `husky` + `lint-staged`
- [ ] `CONTRIBUTING.md` — dev setup guide, env var docs, run instructions

---

## Performance Observability (cross-cutting)

### Backend instrumentation
- [x] `AsyncLocalStorage` request context (`apps/api/src/common/context/request-context.ts`)
- [x] `PerformanceInterceptor` — sets `X-Request-Id`, `X-Request-Duration`, `X-Query-Count`, `X-Query-Time` headers; logs `[PERF]` / `[SLOW]` to NestJS logger
- [x] Prisma query event logging — slow queries (>100ms) logged as `[SLOW QUERY]`
- [x] `app.module.ts` — `PerformanceInterceptor` registered as first `APP_INTERCEPTOR`

### Frontend dev tooling
- [x] `usePerfStore` (Zustand) — tracks per-route: transition ms, API calls, duplicate detection, SQL stats, Web Vitals
- [x] Fetch monkey-patch in `PerfPanel` — intercepts `window.fetch`, reads `X-Query-*` response headers
- [x] `WebVitals` component — `useReportWebVitals` logs LCP, FCP, CLS, TTFB, INP to console
- [x] `PerfPanel` floating overlay (bottom-right, `z-[9999]`, dev only)
- [x] `@next/bundle-analyzer` — `ANALYZE=true pnpm --filter @cms/web build`
- [x] Turbopack enabled — `"dev": "next dev --turbopack"` in `apps/web/package.json`
- [x] FullCalendar lazy-loaded via `next/dynamic({ ssr: false })` in appointments page

### BFF endpoints
- [x] `GET /v1/bff/patient-screen/:id` — patient + health plan name + timeline in 1 request
- [x] `GET /v1/bff/billing-summary` — issued count, collected amount, overdue count

### Service-level fixes
- [x] `appointments.service.ts` reschedule — N+1 Bull queue loop → `Promise.all`
- [x] `patients.service.ts` create — sequential phone+NIF checks → `Promise.all`
- [x] `patients.repository.ts` timeline — `take: 50` → `take: 20` per collection

---

## Phase 1 — Foundation (Months 1–3)

### M1 — Smart Appointment Engine

**Backend (NestJS)**
- [x] `GET /v1/appointments/availability` — free slot calculation from `staff_availability`
- [x] `POST /v1/appointments` — create booking, conflict check, enqueue BullMQ reminders
- [x] `GET /v1/appointments` — calendar range query (by date, staff, patient)
- [x] `PATCH /v1/appointments/:id/status` — confirm | checked_in | completed | cancelled | no_show
- [x] `PATCH /v1/appointments/:id/reschedule` — cancel old reminders, enqueue new ones
- [x] `GET /v1/appointments/waitlist` + `POST /v1/appointments/waitlist`
- [x] BullMQ `reminders` queue — 48h / 24h / 2h jobs enqueued on booking
- [x] Socket.io `/calendar` namespace — `appointment:created` + `appointment:updated` events
- [ ] `GET /v1/appointments/:id` — fix stub (currently returns all appointments instead of one)
- [ ] `GET /v1/staff` — list staff with availability (needed by booking UI)
- [ ] `GET /v1/services` — list active services (needed by booking UI dropdowns)
- [ ] Staff module: `StaffModule` with CRUD + availability management endpoints
- [ ] Availability logic: block slots during `LeaveRequest` (currently only checks shifts)
- [ ] Unit tests: availability algorithm, conflict detection, reminder scheduling

**Frontend (Next.js)**
- [x] Appointments calendar page (FullCalendar week/day/month view)
- [x] New appointment form (date picker + slot selector)
- [~] Real-time Socket.io updates wired on calendar page (needs auth header on WS)
- [ ] Appointment detail page (`/appointments/[id]`) — status update buttons (check-in, complete, cancel)
- [ ] Staff + service dropdowns in booking form (currently UUID text inputs)
- [ ] Waitlist view page
- [ ] Check-in workflow for reception (scan/select patient → mark checked_in)

---

### M2 — Patient CRM

**Backend (NestJS)**
- [x] `GET /v1/patients` — paginated search (name, phone, NIF)
- [x] `POST /v1/patients` — create with consent, phone normalisation (E.164), NIF uniqueness
- [x] `GET /v1/patients/:id` — full profile
- [x] `PATCH /v1/patients/:id` — update demographics
- [x] `DELETE /v1/patients/:id` — soft delete
- [x] `POST /v1/patients/:id/notes` — add manual note
- [x] `GET /v1/patients/:id/timeline` — merged appointments + comms + invoices
- [ ] `GET /v1/patients/:id/documents` — list uploaded documents
- [ ] `POST /v1/patients/:id/documents` — upload file to Cloudflare R2
- [ ] `GET /v1/patients/:id/notes` — list all notes
- [ ] Patient consent management endpoint (update `consentGiven`, download consent PDF)
- [ ] Unit tests: phone normalisation, NIF uniqueness, timeline assembly

**Frontend (Next.js)**
- [x] Patient list page with search + pagination
- [x] Patient profile page with timeline (uses BFF `/bff/patient-screen/:id`; shows `healthPlan.product.name`; staleTime 60s)
- [x] New patient form with Zod validation
- [ ] Edit patient form (`/patients/[id]/edit`)
- [ ] Document upload panel on patient profile
- [ ] Notes panel with add-note form on patient profile
- [ ] Patient search as autocomplete (used in booking form)

---

### M6 — Billing & Invoicing

**Backend (NestJS)**
- [x] `POST /v1/invoices` — create invoice with line items, sequential number `INV-YYYY-NNNN`
- [x] `GET /v1/invoices` — list with filters (patient, status, date range)
- [x] `GET /v1/invoices/:id` — detail with items + payments
- [x] `POST /v1/invoices/:id/payments` — record payment, update status machine
- [~] `GET /v1/invoices/:id/receipt` — returns placeholder URL (PDF generation not implemented)
- [ ] PDF receipt generation with `@react-pdf/renderer` — logo, line items, payment summary
- [ ] Upload generated PDF to Cloudflare R2 and store `pdfR2Key` on invoice
- [ ] Return signed R2 URL (time-limited, e.g. 1 hour)
- [ ] Auto-create invoice when appointment status → `completed`
- [ ] `POST /v1/invoices/:id/cancel` endpoint
- [ ] Overdue invoice detection job (daily BullMQ cron, marks `issued` invoices past due date)
- [ ] Unit tests: invoice number sequence, payment status machine, amount calculation

**Frontend (Next.js)**
- [x] Invoice list page with status filter tabs (KPI cards populated from `/bff/billing-summary`; staleTime 30s)
- [x] Invoice detail page with payment recording form
- [~] Receipt PDF download button (shows placeholder URL)
- [ ] New invoice form (`/billing/new`) — patient picker + service line item builder
- [ ] Invoice status badge + overdue highlight
- [ ] Invoice summary widget on dashboard

---

### Cross-cutting — Phase 1

- [ ] `@cms/types` — add `Staff`, `Service`, `Room` types and Zod schemas
- [ ] `@cms/types` — `StaffAvailability` schema for the booking form
- [ ] API rate limiting (`@nestjs/throttler`) — 60 req/min public, 10 req/min auth
- [ ] Request logging middleware (NestJS `Logger`)
- [ ] Sentry integration (`@sentry/nestjs`) wired in `main.ts`
- [ ] Unit test suite setup (`jest.config.ts`, shared test helpers)
- [ ] Integration test suite (`supertest` + real test DB)
- [ ] Keycloak dev realm set up manually (realm `maissaude`, clients `api` + `web`, 7 roles)
- [ ] Auth flow in Next.js (`next-auth` or manual Keycloak redirect + token storage)
- [ ] `AuthGuard` in Next.js (`(app)/layout.tsx` — redirect to `/login` if no token)
- [ ] API client in Next.js (`lib/api.ts` — fetch wrapper that attaches Bearer token)

---

## Phase 2 — Communication (Months 3–5)

### M3 — WhatsApp Integration

**Backend (NestJS) — `apps/api/src/modules/whatsapp/`**
- [ ] Prisma tables: `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_templates` (add to schema)
- [ ] `POST /v1/whatsapp/webhook` — Meta Cloud API webhook handler (`@Public()`)
- [ ] Webhook signature verification (X-Hub-Signature-256)
- [ ] `WhatsappConversationService` — upsert conversation, route to bot or agent inbox
- [ ] Bot FSM (Redis state per phone number): `IDLE → MENU → BOOK_SERVICE → … → DONE`
  - [ ] State: `IDLE` — detect greeting, show menu
  - [ ] State: `MENU` — handle option selection (book / exam / plan / agent)
  - [ ] State: `BOOK_SERVICE → SELECT_SPECIALTY → SELECT_DOCTOR → SELECT_DATE → SELECT_TIME → CONFIRM`
  - [ ] State: `EXAM_STATUS` — look up exam results, send secure link
  - [ ] State: `HEALTH_PLAN` — show balance/expiry info
  - [ ] State: `AGENT_REQUEST` — escalate to inbox, assign staff
  - [ ] 30-min inactivity timeout resets FSM to IDLE
- [ ] `WhatsappSendService` — send text/template via Meta Cloud API (`axios`)
- [ ] Wire BullMQ reminder processor → send `appointment_reminder_*` template via WhatsApp
- [ ] Agent inbox endpoints:
  - [ ] `GET /v1/whatsapp/inbox` — open conversations assigned to current staff
  - [ ] `POST /v1/whatsapp/inbox/:conversationId/reply` — send message as agent
  - [ ] `PATCH /v1/whatsapp/inbox/:conversationId/assign` — assign to staff member
  - [ ] `PATCH /v1/whatsapp/inbox/:conversationId/close`
- [ ] Log every message to `communication_log` (links to patient via phone lookup)
- [ ] 9 approved WhatsApp templates registered in `whatsapp_templates` table

**Frontend (Next.js)**
- [ ] Agent inbox page (`/inbox`) — conversation list, chat thread, reply input
- [ ] Conversation assignment + close actions
- [ ] Real-time new message notification (Socket.io or polling)
- [ ] WhatsApp-style message bubble UI

---

### M4 — Health Plan Management

**Backend (NestJS) — `apps/api/src/modules/health-plans/`**
- [ ] `GET /v1/health-plan-products` — list products (Familiar / Empresarial)
- [ ] `POST /v1/health-plan-products` — create plan product (admin only)
- [ ] `POST /v1/health-plans` — subscribe patient or company to a plan
- [ ] `GET /v1/health-plans/:id` — plan detail with utilisation counters
- [ ] `PATCH /v1/health-plans/:id` — update plan (suspend, cancel, renew)
- [ ] `POST /v1/health-plans/:id/members` — add member to corporate plan
- [ ] `DELETE /v1/health-plans/:id/members/:memberId`
- [ ] `GET /v1/companies` + `POST /v1/companies` — corporate client management
- [ ] Utilisation counter: increment `usageCount` when invoice method = `health_plan`
- [ ] Expiry notification job (BullMQ cron): WhatsApp template at 30 / 15 / 7 days before expiry
- [ ] Auto-renew logic on expiry date

**Frontend (Next.js)**
- [ ] Health plans list page (`/health-plans`)
- [ ] Plan detail page with member roster
- [ ] Subscribe patient to plan (from patient profile)
- [ ] Corporate HR self-service portal (Phase 4)

---

### M5 — Exam Results Portal

**Backend (NestJS) — `apps/api/src/modules/exams/`**
- [ ] `POST /v1/exams/requests` — create exam request linked to appointment
- [ ] `GET /v1/exams/requests` — worklist for lab_tech (pending requests)
- [ ] `GET /v1/exams/requests/:id`
- [ ] `POST /v1/exams/requests/:id/results` — upload result file to R2, notify patient
- [ ] `GET /v1/exams/results/:id/download` — generate time-limited signed R2 URL (token in DB)
- [ ] WhatsApp notification on result upload (`exam_result_ready` template with secure link)
- [ ] Token expiry: download URLs expire after 72 hours
- [ ] `GET /v1/exams/results` — patient self-service list (scoped to own results)
- [ ] R2 upload service (`apps/api/src/common/services/r2.service.ts`) — `@aws-sdk/client-s3`

**Frontend (Next.js)**
- [ ] Lab tech worklist page (`/exams/worklist`)
- [ ] Result upload form (file picker → R2)
- [ ] Patient exam results page (`/my/results`) — download links

---

## Phase 3 — Clinical Operations (Months 5–8)

### M7 — Clinical Records (EMR-lite)

**Backend (NestJS) — `apps/api/src/modules/clinical/`**
- [ ] Prisma tables: `clinical_notes`, `prescriptions`, `referrals` — **do not exist yet**, despite this line previously claiming otherwise (verified against `packages/database/prisma/schema.prisma`; only the generic, unstructured `PatientNote` model exists). Given the client is now CAP, a psychology clinic, this module's shape (session notes, treatment plans) likely needs a fresh spec pass rather than resuming the old SOAP/ICD-10/prescription design written for a medical clinic — see `REVIEW.md` §6
- [ ] `POST /v1/appointments/:id/clinical-note` — create SOAP note (doctor only)
- [ ] `GET /v1/appointments/:id/clinical-note`
- [ ] `PATCH /v1/clinical-notes/:id` — edit within 24h window, admin override
- [ ] `POST /v1/clinical-notes/:id/prescriptions` — add drug prescription
- [ ] `GET /v1/clinical-notes/:id/prescriptions`
- [ ] `POST /v1/clinical-notes/:id/referrals` — internal/external referral
- [ ] ICD-10 code search endpoint (`GET /v1/icd10?q=`)
- [ ] Auto-lock notes after 24h (BullMQ scheduled job per note)
- [ ] Vitals capture (BP, HR, temp, weight) on SOAP Objective section
- [ ] Audit: every clinical note view logged to `audit_log`

**Frontend (Next.js)**
- [ ] SOAP note editor page (doctor-only, accessed from appointment detail)
- [ ] ICD-10 code search autocomplete
- [ ] Prescription list with print view
- [ ] Referral form + status tracking
- [ ] Patient clinical summary sidebar (last 3 visits, active prescriptions)

---

### M8 — Staff & Resource Scheduler

**Backend (NestJS) — `apps/api/src/modules/staff/`**
- [ ] `GET /v1/staff` — list staff (currently missing, blocks booking UI)
- [ ] `POST /v1/staff` — create staff record + Keycloak user sync
- [ ] `GET /v1/staff/:id/availability` — recurring weekly slots
- [ ] `POST /v1/staff/:id/availability` — set recurring availability
- [ ] `GET /v1/staff/:id/shifts` — shift calendar for a month
- [ ] `POST /v1/staff/:id/shifts` — create/update daily shift
- [ ] `POST /v1/staff/:id/leave` — submit leave request
- [ ] `PATCH /v1/staff/leave/:id` — approve / reject (admin)
- [ ] `GET /v1/rooms` — list rooms with equipment
- [ ] Room conflict detection in appointment booking

**Frontend (Next.js)**
- [ ] Staff list + profile page (`/admin/staff`)
- [ ] Availability editor (weekly recurring grid)
- [ ] Shift planner calendar (month view, drag-to-assign)
- [ ] Leave requests management page

---

### M9 — Home Visit Manager

**Backend (NestJS) — `apps/api/src/modules/home-visits/`**
- [ ] Prisma table: `home_visits` — **does not exist yet**, despite this line previously claiming otherwise (verified against `packages/database/prisma/schema.prisma`)
- [ ] `POST /v1/home-visits` — patient or receptionist creates request
- [ ] `GET /v1/home-visits` — list (pending / assigned / completed)
- [ ] `PATCH /v1/home-visits/:id/assign` — assign nurse/doctor
- [ ] `PATCH /v1/home-visits/:id/status` — in_transit | arrived | completed
- [ ] `PATCH /v1/home-visits/:id/location` — update GPS coordinates (mobile app)
- [ ] `GET /v1/home-visits/:id/track` — real-time location (Socket.io event)
- [ ] Address validation via Google Maps API
- [ ] WhatsApp notification when visit is assigned and when staff is en route

**Frontend (Next.js + React Native)**
- [ ] Home visit request form (patient-facing, web)
- [ ] Visit management board for reception (`/home-visits`)
- [ ] Assignment + status update for admin
- [ ] React Native: nurse/doctor location update screen (sends GPS every 30s)

---

## Phase 4 — Growth (Months 9–12)

### M10 — Analytics & Reporting

**Backend (NestJS) — `apps/api/src/modules/analytics/`**
- [ ] Materialised views: `mv_daily_appointments`, `mv_monthly_revenue` (refresh job)
- [ ] `GET /v1/analytics/kpis` — no-show rate, online booking %, avg wait time
- [ ] `GET /v1/analytics/revenue` — monthly revenue chart data
- [ ] `GET /v1/analytics/appointments` — volume by service, by doctor, by day-of-week
- [ ] `GET /v1/analytics/patients` — new patients / returning, age distribution
- [ ] `GET /v1/analytics/health-plans` — utilisation per plan, renewal rates
- [ ] PDF export endpoint (Puppeteer or WeasyPrint for monthly report)
- [ ] Excel/CSV export for finance

**Frontend (Next.js)**
- [ ] Analytics dashboard (`/analytics`) — KPI cards + Recharts graphs
- [ ] Revenue chart (monthly bar chart)
- [ ] Appointments heatmap (day/hour)
- [ ] Export buttons (PDF / Excel)

---

### Self-Service Portals (Phase 4)

**Patient Portal**
- [ ] Patient login via Keycloak (role: `patient`)
- [ ] `/my/appointments` — book, view, cancel own appointments
- [ ] `/my/results` — view + download exam results
- [ ] `/my/plan` — health plan status + utilisation
- [ ] `/my/invoices` — invoice history + payment links

**Corporate HR Portal**
- [ ] HR login (role: `corporate_hr`)
- [ ] `/hr/members` — add/remove employees from corporate plan
- [ ] `/hr/usage` — anonymised usage report per employee
- [ ] `/hr/invoices` — monthly company invoices

---

### Vinti4 Payment Gateway (Phase 4)

- [ ] Vinti4 API integration service (`apps/api/src/common/services/vinti4.service.ts`)
- [ ] `POST /v1/invoices/:id/pay/vinti4` — initiate payment, return redirect URL
- [ ] Vinti4 callback webhook handler — confirm payment, update invoice status
- [ ] Payment method `vinti4` shown in invoice UI with QR code

---

### React Native Mobile App (Phase 2–4)

- [x] `apps/mobile` scaffold (Expo placeholder)
- [ ] Expo app bootstrap — navigation, auth, API client
- [ ] Nurse/doctor: daily schedule view
- [ ] Nurse/doctor: appointment check-in + SOAP note entry (Phase 3)
- [ ] Home visit GPS tracking screen (Phase 3)
- [ ] Patient mobile: appointment booking + results view (Phase 4)

---

## Ongoing / Cross-cutting

### Security
- [ ] Field-level encryption for NIF, DOB, clinical notes (AES-256-GCM) — `EncryptionService`
- [ ] Rate limiting (`@nestjs/throttler`) — 60/min public, 10/min auth, 1000/min WhatsApp webhook
- [ ] Helmet headers in NestJS `main.ts`
- [ ] OWASP ZAP scan in CI pipeline
- [ ] Quarterly penetration test plan documented

### Testing
- [ ] Unit test suite: patients service, appointments service, billing service
- [ ] Integration tests: patient CRUD flow, booking flow, payment flow
- [ ] E2E tests (Playwright): patient creation → booking → check-in → invoice → payment
- [ ] Performance tests (k6): 50 concurrent users, p95 < 500ms on availability endpoint

### DevOps
- [ ] Keycloak realm export/import automation for dev setup
- [ ] Staging environment live (staging.maissaudecv.com)
- [ ] Production environment live (app.maissaudecv.com)
- [ ] Sentry projects created (api + web)
- [ ] Grafana + Prometheus monitoring stack
- [ ] Loki log aggregation
- [ ] Daily PostgreSQL backup to R2 with restore test
- [ ] Uptime monitoring (Better Uptime or similar)

---

## Immediate Next Steps (Start Here)

These are the highest-priority unblocked tasks right now:

1. **Fix `GET /appointments/:id`** — currently returns all appointments instead of one record (`appointments.controller.ts:56`)
2. **Add `StaffModule` + `ServicesModule`** — `GET /staff` and `GET /services` are missing, which blocks the booking UI dropdowns
3. **Add Next.js auth layer** — `AuthGuard` in `(app)/layout.tsx`, API client with Bearer token, login callback handler
4. **Set up Keycloak dev realm** — create realm `maissaude`, clients `api` and `web`, all 7 roles
5. **Implement PDF receipt generation** — `@react-pdf/renderer` + R2 upload in `billing.service.ts:getReceiptUrl`
6. **New invoice form** — `/billing/new` page is missing (linked from billing list but not created)
7. **Unit tests** — `patients.service.spec.ts`, `appointments.service.spec.ts`, `billing.service.spec.ts`
8. **Patient edit form** — `/patients/[id]/edit` page missing
