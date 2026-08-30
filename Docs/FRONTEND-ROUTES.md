# Frontend Route Map

Next.js App Router routes for the `apps/web` application.

> **Regenerated 2026-08-30** from the actual `apps/web/app/**/page.tsx` tree — the previous version
> of this doc described a route structure (nested `/admin/*`, `/companies/*`,
> `/health-plans/products/*`, a `(patient)` self-service portal, `/appointments/[id]`,
> `/patients/[id]/documents`) that **does not exist**. The real app is much flatter: most
> list+detail interactions happen via modals/tabs on one page rather than separate routes, several
> pages are mockup shells for not-yet-built modules (M3/M5/M7/M9/M10 — see their module docs), and
> there is no patient-facing portal at all.

## Route Groups

### `(auth)` — unauthenticated

| Path | File | Description |
|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Redirects into Keycloak's own login page |
| `/activate` | `(auth)/activate/page.tsx` | Staff invitation acceptance (token from `POST /staff/invite`'s email) — not in the original doc at all |

❌ No `/login/callback` page — the OAuth callback is a Route Handler, not a page (see API Proxy /
Auth section below).

### `(app)` — requires authentication

| Path | File | Roles (route-level `@Roles`, not page-level) |
|---|---|---|
| `/dashboard` | `(app)/dashboard/page.tsx` | all staff |
| `/appointments` | `(app)/appointments/page.tsx` | admin, receptionist, doctor, nurse |
| `/appointments/new` | `(app)/appointments/new/page.tsx` | admin, receptionist |
| `/patients` | `(app)/patients/page.tsx` | admin, receptionist, doctor, nurse |
| `/patients/new` | `(app)/patients/new/page.tsx` | admin, receptionist |
| `/patients/[id]` | `(app)/patients/[id]/page.tsx` | admin, receptionist, doctor, nurse |
| `/patients/[id]/edit` | `(app)/patients/[id]/edit/page.tsx` | admin, receptionist — not in the original doc |
| `/billing` | `(app)/billing/page.tsx` | admin, receptionist |
| `/billing/new` | `(app)/billing/new/page.tsx` | admin, receptionist |
| `/billing/[id]` | `(app)/billing/[id]/page.tsx` | admin, receptionist |
| `/health-plans` | `(app)/health-plans/page.tsx` | admin, receptionist, corporate_hr — one page handles products + subscriptions, not a `/products` sub-tree |
| `/staff` | `(app)/staff/page.tsx` | admin — not under `/admin/*` |
| `/settings` | `(app)/settings/page.tsx` | admin |
| `/parametrizacoes` | `(app)/parametrizacoes/page.tsx` | admin — service pricing, business hours, clinic info; not in the original doc |
| `/access` | `(app)/access/page.tsx` | admin — not in the original doc; role/permission-related |

🎭 **Mockup shells with no real backend** (see each module's doc for what's actually built, if anything):

| Path | File | Stands in for |
|---|---|---|
| `/whatsapp` | `(app)/whatsapp/page.tsx` | M3 — WhatsApp Integration |
| `/exams` | `(app)/exams/page.tsx` | M5 — Exam Results |
| `/records` | `(app)/records/page.tsx` | M7 — Clinical Records |
| `/visits` | `(app)/visits/page.tsx` | M9 — Home Visits |
| `/analytics` | `(app)/analytics/page.tsx` | M10 — Analytics |

❌ Doesn't exist at all: `/appointments/[id]` detail page, `/appointments/waitlist`,
`/patients/[id]/documents`, `/companies*` (no page — Companies is only ever managed inline from the
Health Plans page, if at all), `/admin/rooms` (no page, and no backend either — see
`M8-staff-resource-scheduler.md`), `/admin/holidays`, `/admin/audit`.

### `(patient)` — patient self-service portal

❌ **Doesn't exist.** No `(patient)` route group, no booking/results/invoices/profile pages for
patients. `GET /patients/me` is the only patient-facing API route, and nothing in `apps/web` calls it.

---

## API Proxy

✅ Real, via `next.config.ts` rewrites: `/api/:path*` → `` `${NEXT_PUBLIC_API_URL ?? "http://localhost:4001"}/v1/:path*` ``.
🟡 Note the hardcoded fallback is port **4001**, while the API's own default listen port
(`API_PORT` in `apps/api/src/main.ts`) is **3001** — harmless as long as `.env.local` sets
`NEXT_PUBLIC_API_URL` explicitly (which local setup does), but the fallback value itself doesn't
match the API's default.

## Auth Guard

🟡 **Not `@react-keycloak/web` or `next-auth`** — neither package is a dependency. Auth is a
custom implementation: three Next.js Route Handlers (`app/api/auth/login`, `/callback`, `/logout`)
drive the OAuth/PKCE exchange with Keycloak directly. Role-based restrictions are enforced
server-side by the API's `RolesGuard` (route-level `@Roles`, not page-level) — whether the `(app)`
layout also redirects unauthenticated/wrong-role users client-side was not re-verified in this pass.
