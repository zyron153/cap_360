# Performance Upgrades — Mais Saúde 360

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Full-Stack Performance Instrumentation | ✅ Done |
| 2 | API Waterfall Detection & Audit | ✅ Done |
| 3 | BFF (Backend for Frontend) Endpoints | ✅ Done |
| 4 | Frontend Data Loading Tuning | ✅ Done |
| 5 | Navigation Optimization | ✅ Done |
| 6 | Database Query Optimization | ✅ Done |
| 7 | Final Implementation Pass | ✅ Done |

---

## ✅ Phase 1 — Full-Stack Performance Instrumentation

Instruments the full stack so every future optimization has a before/after measurement. Nothing optimized — only measured.

### Backend (3 files)

**`apps/api/src/common/context/request-context.ts`** — NEW
Node.js `AsyncLocalStorage` scopes per-request state through the entire call stack including Prisma callbacks.

**`apps/api/src/common/interceptors/performance.interceptor.ts`** — NEW
Wraps every request. On response sets headers:
- `X-Request-Id`, `X-Request-Duration`, `X-Query-Count`, `X-Query-Time`

Logs `[PERF]` for every request and `[SLOW]` for requests >100ms. Registered as the first `APP_INTERCEPTOR` in `app.module.ts`.

**`apps/api/src/prisma/prisma.service.ts`** — MODIFIED
Enabled `log: [{ emit: 'event', level: 'query' }]`. Pushes each query's duration to `RequestContext`. Warns on slow queries (>100ms).

### Frontend (4 files)

**`apps/web/app/web-vitals.tsx`** — NEW
`useReportWebVitals` hook (Next.js built-in). Logs LCP, FID, CLS, FCP, TTFB to console with color-coded rating. Pushes to perf store.

**`apps/web/lib/perf-store.ts`** — NEW
Zustand store tracking per-route metrics: transition time, API calls, duplicate calls, SQL query count/time, Web Vitals. Monkey-patches `window.fetch` to intercept timing and read `X-Query-*` response headers.

**`apps/web/components/dev/PerfPanel.tsx`** — NEW
Floating ⚡ PERF overlay (bottom-right, `z-[9999]`). Shows route transition time, API calls, duplicate detection (DUP label), SQL stats, Web Vitals. Dev only.

**`apps/web/app/(app)/layout.tsx`** — MODIFIED
Added `<PerfPanel />` (dev only).

### Bundle Analyzer
- Added `@next/bundle-analyzer` to `apps/web/package.json`
- `next.config.ts` wraps config with `withBundleAnalyzer({ enabled: ANALYZE === 'true' })`
- Run: `ANALYZE=true pnpm --filter @cap/web build`

---

## ✅ Phase 2 — API Waterfall Detection & Audit

Read-only audit of all pages and backend services. No code changes.

### Frontend findings

| ID | Page | Issue | Severity |
|----|------|-------|----------|
| F1 | appointments | No `staleTime` — every revisit refetches | Medium |
| F2 | appointments | Socket invalidates all `["appointments"]` queries (too broad) | High |
| F3 | appointments | Query key doesn't encode date range | Medium |
| F4 | patients | No `staleTime` | Medium |
| F5 | patients | Plan filter applied client-side after fetching all rows | Low |
| F6 | patients/[id] | 2 HTTP requests for 1 screen (patient + timeline) | High |
| F7 | patients/[id] | No `staleTime` on either query | Medium |
| F8 | billing | KPI cards (Emitidas, Receita, Vencidas) always show "—" — never fetched | Medium |
| F9 | billing | No `staleTime` | Medium |
| F10 | billing/[id] | Payment mutation invalidates all `["invoices"]` (over-invalidation) | Medium |
| F11 | billing/[id] | No `staleTime` | Medium |

### Backend findings

| ID | Service | Issue | Severity |
|----|---------|-------|----------|
| B1 | appointments.reschedule | N+1 Bull queue loop — 3 sequential `getJob()` calls | High |
| B2 | appointments.getAvailability | 2 independent queries run sequentially | Low |
| B3 | patients.create | Phone + NIF uniqueness checks run sequentially | Low |
| B4 | patients.findAll | No `select` — returns full row including encrypted NIF | Medium |
| B5 | patients.findById | Returns flat patient, no health plan relation | Medium |
| B6 | billing.recordPayment | 3 sequential queries; first over-fetches full invoice to read `total` | High |
| B7 | billing.findById | Always includes `items + payments` — wasteful for receipt endpoint | Medium |
| B8 | billing.update | Returns `items + payments` after payment when only status needed | Low |
| B9 | healthPlans.findAllPlans | Always includes full `product` (with `coverageRules` JSON) + full `company` | Medium |
| B10 | companies.deactivate | Loads full company + health plans tree just to check existence | Low |

---

## ✅ Phase 3 — BFF (Backend for Frontend) Endpoints

Created screen-oriented endpoints that collapse multiple API calls into one.

### New files

**`apps/api/src/modules/bff/bff.service.ts`**
- `getPatientScreen(id)` — 4 parallel Prisma queries in a single request:
  patient (with `healthPlan.name`), appointments (take 20), communications (take 20), invoices (take 20). Assembles and sorts timeline server-side. Fixes F6 + B5.
- `getBillingSummary()` — 3 parallel aggregates: issued count, collected amount, overdue count (this month). Fixes F8.

**`apps/api/src/modules/bff/bff.controller.ts`**
- `GET /v1/bff/patient-screen/:id`
- `GET /v1/bff/billing-summary`

**`apps/api/src/modules/bff/bff.module.ts`** — imports `PrismaModule`.

### Modified files

**`apps/api/src/app.module.ts`** — imports `BffModule`.

**`apps/api/src/modules/appointments/appointments.service.ts`**
- Fixed B1: replaced `for` loop with `Promise.all` for Bull queue lookups.

**`apps/api/src/modules/patients/patients.service.ts`**
- Fixed B3: phone + NIF uniqueness checks now run in parallel via `Promise.all`.

**`apps/api/src/modules/patients/patients.repository.ts`**
- Reduced timeline `take: 50 → 20` per collection.

**`apps/web/app/(app)/patients/[id]/page.tsx`**
- Replaced 2 `useQuery` calls with 1 BFF call to `/api/bff/patient-screen/:id`. Fixes F6.
- Now shows `healthPlan.name` instead of generic "Plano Ativo" badge. Fixes B5.
- Added `staleTime: 60_000`. Fixes F7.

**`apps/web/app/(app)/billing/page.tsx`**
- Added `useQuery` for `/api/bff/billing-summary` with `staleTime: 60_000`. Fixes F8.
- KPI cards (Emitidas, Receita Cobrada, Vencidas) now show real values.
- Added `staleTime: 30_000` on the invoices list query. Fixes F9.

---

## ✅ Phase 4 — Frontend Data Loading Tuning

Tuned React Query across all live-data pages. Targets: F1, F2, F3, F4, F10, F11.

### Global (`apps/web/app/providers.tsx`) — MODIFIED

Added to QueryClient defaults:
- `gcTime: 10 * 60 * 1000` — keeps cache alive 10 min after last observer detaches; survives React 19 StrictMode remount cycles
- `refetchOnWindowFocus: false` — eliminated DUPs caused by DevTools open/close triggering window blur+focus re-fetches

### Appointments page (`apps/web/app/(app)/appointments/page.tsx`) — MODIFIED

- **F1**: Added `staleTime: 60_000` to the calendar query
- **F3**: Moved `from`/`to` date computation to component scope; both now included in queryKey: `["appointments", "calendar", from, to]`
- **F2**: Socket `invalidateQueries` now targets the exact key `["appointments", "calendar", from, to]` instead of the over-broad `["appointments"]` prefix
- **Bug fix**: `to` date now uses `new Date(year, month+1, 0).getDate()` — eliminates hardcoded `-31` that produced `Invalid Date` on months with < 31 days (e.g. June → 500 error)
- Socket `reconnectionAttempts: 3` — stops console spam when API server is not running

### Patients page (`apps/web/app/(app)/patients/page.tsx`) — MODIFIED

- **F4**: Added explicit `staleTime: 30_000` (previously relying silently on global default)

### Billing detail page (`apps/web/app/(app)/billing/[id]/page.tsx`) — MODIFIED

- **F11**: Added `staleTime: 60_000` to the invoice detail query
- **F10**: `payMutation.onSuccess` now also invalidates `["billing-summary"]` so KPI cards on the billing list page reflect the payment immediately; list invalidation via `["invoices"]` prefix is intentionally kept broad (all pages/filters should reflect the payment)

---

## ✅ Phase 5 — Navigation Optimization

Reduced blank-screen time when navigating between routes.

### Sidebar prefetch (`apps/web/app/(app)/sidebar.tsx`) — MODIFIED

Added `prefetch={true}` to all sidebar `<Link>` elements. In Next.js 15 App Router, the default partial prefetch downloads only the loading skeleton; `prefetch={true}` also downloads the full page JS bundle while the user is viewing the sidebar. Since all sidebar links are always in the viewport, all bundles are downloaded eagerly after the layout mounts — navigation becomes instant in production.

> Hover-based `router.prefetch()` was investigated and ruled out: links are permanently in viewport, so viewport-based prefetch already fires immediately. Hover adds no benefit.

### Route-specific loading skeletons

The single `app/(app)/loading.tsx` (generic KPI-cards + table) was shown for ALL routes, including ones with a completely different layout. Added two route-specific skeletons that match the actual page structure:

**`apps/web/app/(app)/appointments/loading.tsx`** — NEW
Calendar-matching skeleton: header with view-toggle + CTA, 4 stats pills row, status legend pills, FullCalendar-shaped grid (toolbar + 7-col day headers + 5-week cell grid with scattered event placeholders).

**`apps/web/app/(app)/patients/loading.tsx`** — NEW
Patients-matching skeleton: header + button, search bar + filter, table with avatar + name + phone + plan columns, pagination row. No KPI cards (generic had 4 that don't exist on this page).

---

## ✅ Phase 6 — Database Query Optimization

Reduced over-fetching on high-traffic queries and added composite indexes for the most common filter patterns.

### B4 — `patients.findAll` over-fetching (`apps/api/src/modules/patients/patients.service.ts`)

Added `select` to the `findMany` call: returns only the 10 fields the list page displays (`id`, `fullName`, `dateOfBirth`, `gender`, `phone`, `email`, `consentGiven`, `healthPlanId`, `createdAt`, `updatedAt`). Excludes `nif` (AES-256-GCM encrypted), `address`, `emergencyContactName`, `emergencyContactPhone`, `consentGivenAt`, `deletedAt` — none of which are shown in the list.

### B6+B7 — `billing.recordPayment` + `getReceiptUrl` over-fetching

**`apps/api/src/modules/billing/billing.repository.ts`** — Added `findByIdLite`:
```typescript
findByIdLite(id) → select: { id, status, total, invoiceNumber }
```
Replaces the full `findById` (which joins `items + payments + patient`) in two operations that only need a fraction of that data:
- B6: `recordPayment` — needed only `status` (guard check) and `total` (payment math)
- B7: `getReceiptUrl` — needed only `invoiceNumber` for the PDF URL

**`apps/api/src/modules/billing/billing.service.ts`** — Both methods now call `findByIdLite` and throw `NotFoundException` inline (no longer delegating to `findById`).

### B9 — `healthPlans.findAllPlans` loading `coverageRules` JSON blob (`apps/api/src/modules/health-plans/health-plans.repository.ts`)

Replaced `include: { product: true, company: true }` with a shared `planSelect` constant using `select` — excludes the `coverageRules` JSON field from `HealthPlanProduct`. Applied to both `findAllPlans` and `findPlanById`.

**Bug fixed here:** BFF service (`bff.service.ts`) was selecting `healthPlan: { select: { name: true } }` but `HealthPlan` has no `name` field — the plan name lives on `product.name`. Fixed to `healthPlan: { select: { planNumber, product: { select: { name } } } }`. Frontend `PatientScreenResponse` type and rendering updated accordingly (`healthPlan.product.name`).

### B10 — `companies.deactivate` existence check (`apps/api/src/modules/companies/`)

**Repository** — Added `exists(id): { id }` method that only selects `{ id: true }`.
**Service** — `deactivate` now calls `repo.exists(id)` instead of `findById` (which joins the full health plans + products tree just to confirm the company exists).

### Composite indexes (`packages/database/prisma/schema.prisma`)

Added 4 composite indexes targeting the most frequent filter patterns:

| Index | Table | Purpose |
|-------|-------|---------|
| `(patientId, deletedAt)` | appointments | BFF patient-screen: `WHERE patientId = ? AND deletedAt IS NULL` |
| `(scheduledAt, deletedAt)` | appointments | Calendar: `WHERE scheduledAt BETWEEN ? AND ? AND deletedAt IS NULL` |
| `(status, createdAt)` | invoices | BFF billing-summary: `WHERE status = 'issued' AND createdAt >= ?` |
| `(patientId, status)` | invoices | Patient invoice timeline: `WHERE patientId = ?` |

> **Migration required:** run `pnpm --filter @cap/database db:push` to apply the new indexes to the
> database — this project uses `prisma db push`, not `prisma migrate dev` (see `DEPLOYMENT.md`).

---

## ✅ Phase 7 — Final Implementation Pass

Closed the last two open audit items (B8, F5). B2 was intentionally skipped — the sequential pattern in `getAvailability` is an early-exit optimization (if staff has no availability, the second query is never made; parallelising would remove that saving).

### B8 — `billing.recordPayment` returns full invoice payload that the frontend discards

**`apps/api/src/modules/billing/billing.repository.ts`** — Added `updateStatus`:
```typescript
updateStatus(id, data) → select: { id, status, amountPaid }
```
**`apps/api/src/modules/billing/billing.service.ts`** — `recordPayment` now calls `repo.updateStatus` instead of `repo.update`. The response drops the full `items[]` + `payments[]` join — the frontend invalidates the cache and re-fetches the detail anyway, so the heavy payload was wasted work on every payment.

### F5 — Patient plan filter applied client-side on paginated data

**Root cause:** `planFilter` ("all" / "plan" / "none") was handled entirely in the browser after fetching the first 20 patients. A user viewing "Com Plano" would see at most 20 results filtered from page 1, never the real total, and pagination was broken.

**`packages/types/src/patient.ts`** — Added `planFilter: z.enum(["all","plan","none"]).default("all")` to `PatientSearchSchema`.

**`apps/api/src/modules/patients/patients.service.ts`** — `findAll` now applies the filter in the Prisma `where` clause:
```typescript
planFilter === "plan" ? { healthPlanId: { not: null } }
planFilter === "none" ? { healthPlanId: null }
```
Both the `count` and `findMany` queries share the same `where`, so pagination totals are correct.

**`apps/web/app/(app)/patients/page.tsx`** — `fetchPatients` now passes `planFilter` as a URL param; `planFilter` is included in the React Query key (`["patients", search, planFilter, page]`); removed client-side `.filter()` entirely; filter button resets `page` to 1 on change.
