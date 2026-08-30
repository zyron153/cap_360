# CAP 360 — Technical Architecture

> **Version:** 1.2 · **Date:** June 2026
> Companion document to PRD v1.0

---

## 1. Overview

Mais Saúde 360 is a cloud-native, multi-tenant Healthcare ERP/CRM. The architecture prioritises:

- **Reliability** over cleverness — proven technologies with strong community support
- **Data sovereignty** — all patient data hosted in EU-compliant regions
- **WhatsApp-first UX** — structured bot as primary patient touchpoint
- **Progressive delivery** — each phase ships independently and can be validated in isolation

---

## 2. Technology Stack

### 2.1 Frontend

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Web Framework | Next.js (React) | 15 | App Router; Turbopack dev mode (5–10× faster HMR); SSR |
| UI Component Library | shadcn/ui + Tailwind CSS | Latest | Accessible, unstyled components; rapid iteration |
| State Management | Zustand + React Query | Latest | Perf store (Zustand); server state caching + dedup (React Query) |
| Forms | React Hook Form + Zod | Latest | Type-safe form validation |
| Calendar | FullCalendar | 6+ | Multi-view appointment calendar; lazy-loaded via `next/dynamic` |
| Charts | Recharts | Latest | Analytics dashboard |
| i18n | next-intl | Latest | Portuguese (pt-CV) primary; English admin option |
| Mobile App | React Native (Expo) | Latest | iOS + Android from single codebase |

### 2.2 Backend

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Performance; same language as frontend |
| Framework | NestJS | 10+ | Structured, modular; decorator-based DI |
| ORM | Prisma | 6 | Type-safe queries; migration support; query event logging |
| Task Queue | BullMQ (Redis) | Latest | Reminder scheduling; async jobs |
| WebSockets | Socket.io | Latest | Real-time calendar updates; agent inbox |
| Validation | class-validator + class-transformer | Latest | DTO-level request validation |

### 2.3 Data Layer

| Component | Technology | Rationale |
|---|---|---|
| Primary DB | PostgreSQL 16 | ACID compliance; relational integrity for medical records |
| Cache / Queue | Redis 7 | Session store; BullMQ job queue; rate limiting |
| File Storage | Cloudflare R2 (or AWS S3) | S3-compatible; GDPR-eligible; cost-efficient |
| Search | PostgreSQL Full-Text Search (pg_trgm) | 🟡 Planned, but the actual implementation is simpler: plain case-insensitive `contains` matching, no `pg_trgm` extension or GIN index (see `modules/M2-patient-crm.md` §2.4) |
| Backups | pg_dump → R2/S3 (daily) | 30-day retention; automated via cron |

### 2.4 Infrastructure & DevOps

| Component | Technology | Rationale |
|---|---|---|
| Containerisation | Docker + Docker Compose | Reproducible environments |
| Orchestration | Kubernetes (K3s or EKS) | Rolling deploys; horizontal scaling |
| Hosting | Hetzner Cloud (EU) or AWS eu-west-1 | EU data compliance; Hetzner for cost savings |
| CI/CD | GitHub Actions | Build → test → deploy pipeline |
| Secrets | HashiCorp Vault or AWS Secrets Manager | Centralised secret rotation |
| Monitoring | Grafana + Prometheus | Metrics; alerting |
| Logging | Loki + Grafana | Structured log aggregation |
| Error Tracking | Sentry | Frontend + backend error capture |
| Uptime Monitoring | Better Uptime | 99.5% SLA tracking |

### 2.5 External Integrations

| Service | Provider | Purpose |
|---|---|---|
| WhatsApp Business API | Meta Cloud API via 360dialog or Twilio | Bot + agent inbox + reminders |
| Email (transactional) | SendGrid | Booking confirmations; result notifications |
| SMS | Africa's Talking | SMS fallback for CV/Africa numbers |
| Payment Gateway | Vinti4 (Phase 4) | Local Cabo Verde payments |
| Authentication | Keycloak (self-hosted) | RBAC; MFA; GDPR audit logs; SSO |
| Maps | Google Maps API | Home visit address validation + routing |
| ~~Imaging~~ | ~~DICOM viewer (Cornerstone.js)~~ | **Cut** — client is now CAP, a psychology clinic; no ultrasound/ECG use case (see `Docs/PRD.md` F-18) |

---

## 3. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  Next.js Web │  │ React Native │  │  WhatsApp (Patient) │   │
│  │  App (PWA)   │  │  Mobile App  │  │                     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘   │
└─────────┼─────────────────┼─────────────────────┼──────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway (NGINX)                          │
│              Rate limiting · TLS termination · CORS              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          ▼                    ▼                       ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  NestJS API      │  │  WhatsApp Hub    │  │  Keycloak Auth   │
│  (REST + WS)     │  │  (Webhook +Bot)  │  │  Server          │
│  Port 3001       │  │  Port 3002       │  │  Port 8080       │
└────────┬─────────┘  └────────┬─────────┘  └──────────────────┘
         │                     │
         ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Data Layer                                │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────────────┐    │
│  │ PostgreSQL   │  │  Redis   │  │  Cloudflare R2         │    │
│  │ (Primary DB) │  │ (Cache + │  │  (Files: PDFs, images) │    │
│  │              │  │  Queue)  │  │                        │    │
│  └──────────────┘  └──────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External Services                              │
│  360dialog/Twilio · SendGrid · Africa's Talking · Google Maps   │
│  Vinti4 (Phase 4) · Sentry · Grafana                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Module Dependency Map

```
M1 (Appointments) ──► M2 (Patient CRM)
M1 (Appointments) ──► M6 (Billing)
M3 (WhatsApp Hub) ──► M1 (Appointments)
M3 (WhatsApp Hub) ──► M2 (Patient CRM)
M4 (Health Plans) ──► M2 (Patient CRM)
M4 (Health Plans) ──► M6 (Billing)
M5 (Exams)        ──► M2 (Patient CRM)
M5 (Exams)        ──► M7 (EMR)
M7 (EMR)          ──► M2 (Patient CRM)
M8 (Staff Sched)  ──► M1 (Appointments)
M9 (Home Visits)  ──► M2 (Patient CRM)
M9 (Home Visits)  ──► M7 (EMR)
M10 (Analytics)   ──► ALL modules (read-only)
```

---

## 5. Data Flow: Appointment Booking

```
Patient (WhatsApp/Web)
  │
  ├─► [Web Widget] ──► POST /api/appointments/book
  │                         │
  │                         ▼
  │                   Validate slot availability
  │                   (Redis lock on slot)
  │                         │
  │                         ▼
  │                   Create appointment record (PG)
  │                   Create patient if new (PG)
  │                         │
  │                         ▼
  │                   Enqueue reminder jobs (BullMQ)
  │                   [48h, 24h, 2h before]
  │                         │
  │                         ▼
  │                   Send confirmation (WhatsApp/email)
  │
  └─► [WhatsApp Bot] ──► Webhook → Bot Handler
                              │
                              ▼
                        Parse intent → booking flow
                        (same booking service as web)
```

---

## 6. Authentication & Authorisation Flow

```
User requests protected route
  │
  ▼
NGINX → NestJS AuthGuard
  │
  ▼
JWT validation (signed by Keycloak)
  │
  ├─ Valid? → Extract roles from JWT claims
  │               │
  │               ▼
  │           RolesGuard checks required role
  │               │
  │               ├─ Authorised? → Controller proceeds
  │               └─ Denied?     → 403 Forbidden
  │
  └─ Invalid? → 401 Unauthorised → Client refreshes token via Keycloak
```

---

## 7. Environment Configuration

### 7.1 Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/maissaude360
REDIS_URL=redis://host:6379

# Auth
KEYCLOAK_URL=https://auth.maissaude360.cv
KEYCLOAK_REALM=maissaude
KEYCLOAK_CLIENT_ID=api-server
KEYCLOAK_CLIENT_SECRET=<secret>

# WhatsApp
WHATSAPP_API_URL=https://waba.360dialog.io/v1
WHATSAPP_API_KEY=<key>
WHATSAPP_PHONE_NUMBER_ID=<id>
WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>

# Email
SENDGRID_API_KEY=<key>
SENDGRID_FROM_EMAIL=noreply@maissaudecv.com

# SMS
AFRICASTALKING_USERNAME=<username>
AFRICASTALKING_API_KEY=<key>

# Storage
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET_NAME=maissaude-files
R2_PUBLIC_URL=https://files.maissaudecv.com

# Maps
GOOGLE_MAPS_API_KEY=<key>

# App
NODE_ENV=production
API_PORT=3001
JWT_SECRET=<secret>
CORS_ORIGIN=https://maissaudecv.com,https://app.maissaudecv.com
```

### 7.2 Environments

| Environment | URL | Branch | Purpose |
|---|---|---|---|
| Development | localhost:3000 | `develop` | Active development |
| Staging | staging.maissaudecv.com | `staging` | UAT + QA |
| Production | app.maissaudecv.com | `main` | Live system |

---

## 8. Performance Targets & Scaling Strategy

| Metric | Target | Strategy |
|---|---|---|
| API response time (p95) | < 200ms | BFF endpoints; Redis caching; DB indexes; connection pooling (PgBouncer) |
| Booking flow E2E | < 90 seconds | Optimistic UI; slot pre-check before form |
| Calendar load | < 1 second | Paginated API; date-range scoped queries |
| Concurrent users | 50 at launch → 500 | Horizontal pod scaling in K8s |
| File uploads (exam PDFs) | < 5s for 10MB | Direct-to-R2 presigned URL upload |
| WhatsApp bot response | < 3 seconds | Async webhook processing; Redis state cache |

---

## 9. Performance Observability

Instrumentation is active in the current codebase (dev and production).

### 9.1 Backend — Per-Request Metrics

Every API request is wrapped by `PerformanceInterceptor` (`apps/api/src/common/interceptors/performance.interceptor.ts`), which uses Node.js `AsyncLocalStorage` to scope state through the full async call stack including Prisma event callbacks.

**Response headers set on every request:**

| Header | Value |
|---|---|
| `X-Request-Id` | UUID per request |
| `X-Request-Duration` | Total handler time in ms |
| `X-Query-Count` | Number of SQL queries executed |
| `X-Query-Time` | Sum of all Prisma query durations in ms |

**Server logs:**
- `[PERF] GET /v1/patients 200 38ms (2 queries, 12ms SQL)` — every request
- `[SLOW] GET /v1/appointments 312ms` — requests exceeding 100ms
- `[SLOW QUERY] 145ms — SELECT ...` — individual Prisma queries exceeding 100ms

### 9.2 Frontend — Development Panel

In `NODE_ENV=development`, a floating `⚡ PERF` panel appears bottom-right on every page. It tracks:

- Route transition time (ms)
- API calls made on the current route (URL, method, duration)
- Duplicate call detection (same URL appearing > 1 time, labeled `DUP`)
- SQL query count and total time (read from `X-Query-Count` / `X-Query-Time` response headers)
- Web Vitals: LCP, FCP, CLS, TTFB, INP (via `useReportWebVitals`)

Bundle analysis: `ANALYZE=true pnpm --filter @cap/web build` opens a treemap of client + server bundles.

### 9.3 BFF Pattern (Backend for Frontend)

Screen-oriented aggregate endpoints live at `/v1/bff/*`. They replace multi-round-trip UI patterns with a single request that runs all sub-queries in parallel server-side.

| Endpoint | Replaces | Improvement |
|---|---|---|
| `GET /v1/bff/patient-screen/:id` | `GET /patients/:id` + `GET /patients/:id/timeline` | 2 HTTP calls → 1; includes `healthPlan.product.name`; timeline capped at 20 per collection |
| `GET /v1/bff/billing-summary` | None (KPI stats were missing) | Issued count, collected amount, overdue count for billing dashboard |

---

### 9.4 React Query Tuning (Phase 4)

Global defaults in `apps/web/app/providers.tsx`:

```typescript
defaultOptions: {
  queries: {
    staleTime: 30_000,           // 30s — serve from cache before background re-fetch
    gcTime: 10 * 60 * 1000,      // 10min in-memory — survives React 19 StrictMode remount cycles
    retry: 1,
    refetchOnWindowFocus: false, // prevents DevTools open/close from firing duplicate fetches
  },
},
```

`refetchOnWindowFocus: false` was the primary fix for DUPs shown in the PERF panel. The React Query default (`true`) causes every active query to re-fetch whenever the browser window regains focus — opening DevTools triggers a blur+focus cycle, which looked like duplicate API calls.

Per-page `staleTime` overrides: appointments calendar `60_000` ms; billing detail `60_000` ms.

---

### 9.5 Navigation Optimization (Phase 5)

**Sidebar prefetch** (`apps/web/app/(app)/sidebar.tsx`): `prefetch={true}` on all `<Link>` elements. In Next.js 15 App Router the default partial prefetch downloads only the loading skeleton; `prefetch={true}` also fetches the full page JS bundle. Since all sidebar links are always in the viewport, all bundles are eagerly downloaded after the layout mounts — navigation is instant in production.

**Route-specific loading skeletons** (replaces the generic KPI+table skeleton shown on all routes):

| File | Matches |
|---|---|
| `apps/web/app/(app)/appointments/loading.tsx` | Calendar toolbar + stats pills + 7-column FullCalendar-shaped grid |
| `apps/web/app/(app)/patients/loading.tsx` | Search bar + filter chips + 9-row table with avatar/name/phone/plan columns |

---

### 9.6 Database Query Optimization (Phase 6)

**Composite indexes** added to `packages/database/prisma/schema.prisma`:

| Index | Table | Query pattern |
|---|---|---|
| `(patientId, deletedAt)` | appointments | BFF patient-screen: `WHERE patientId = ? AND deletedAt IS NULL` |
| `(scheduledAt, deletedAt)` | appointments | Calendar: `WHERE scheduledAt BETWEEN ? AND ? AND deletedAt IS NULL` |
| `(status, createdAt)` | invoices | BFF billing-summary: `WHERE status = ? AND createdAt >= ?` |
| `(patientId, status)` | invoices | Patient invoice timeline |

> Activate with `pnpm --filter @cap/database exec prisma db push --skip-generate` — this project
> uses `db push`, not `prisma migrate dev`, for day-to-day schema changes (see `DEPLOYMENT.md` §4).

**Lean repository methods** to avoid over-fetching:

| Method | Select | Replaces |
|---|---|---|
| `BillingRepository.findByIdLite(id)` | `id, status, total, invoiceNumber` | Full `findById` (items + payments + patient) in `recordPayment` and `getReceiptUrl` |
| `BillingRepository.updateStatus(id, data)` | `id, status, amountPaid` | Full `update` (returns items + payments) after recording a payment |
| `HealthPlansRepository.planSelect` | All plan fields except `coverageRules` JSON blob | `include: { product: true }` |
| `CompaniesRepository.exists(id)` | `id` only | Full `findById` (joins healthPlans + products) in `deactivate` guard check |

**Bug fixed:** `bff.service.ts` was selecting `healthPlan: { select: { name: true } }` but `HealthPlan` has no `name` column — name lives on `product.name`. Fixed to `healthPlan: { select: { planNumber, product: { select: { name } } } }`. Frontend `PatientScreenResponse` type and template updated accordingly.

---

### 9.7 Server-Side Filtering (Phase 7)

**Patient plan filter** moved from client-side `Array.filter()` to server-side Prisma `WHERE`:

```typescript
// packages/types/src/patient.ts — PatientSearchSchema
planFilter: z.enum(["all", "plan", "none"]).default("all")

// apps/api/src/modules/patients/patients.service.ts — findAll()
planFilter === "plan" ? { healthPlanId: { not: null } }
planFilter === "none" ? { healthPlanId: null }
```

Root cause of the prior bug: filtering after `data.data` (first 20 rows) produced wrong totals and broke pagination — a "Com Plano" search could never return more than whatever happened to be on page 1.

Frontend (`apps/web/app/(app)/patients/page.tsx`): `planFilter` is now a URL param on every fetch and is part of the React Query key `["patients", search, planFilter, page]`; client-side `.filter()` removed.

---

## 10. Disaster Recovery

| Scenario | Recovery Procedure | RTO | RPO |
|---|---|---|---|
| DB node failure | Promote read replica; restore from backup | 15 min | 24 hrs |
| API pod crash | K8s auto-restarts pod | < 1 min | 0 |
| Accidental data deletion | Restore from daily pg_dump | 1 hr | 24 hrs |
| WhatsApp API outage | SMS + email fallback; manual queue | N/A | 0 |
| Full region outage | Failover to backup Hetzner region | 4 hrs | 24 hrs |

---

*CAP 360 · Architecture Document v1.3 · spot-corrected 2026-08-30 against the current implementation*
