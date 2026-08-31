# Frontend Route Map

Next.js App Router routes for the `apps/web` application.

> **Regenerated 2026-08-30** from the actual `apps/web/app/**/page.tsx` tree — the previous version
> of this doc described a route structure (nested `/admin/*`, `/companies/*`,
> `/health-plans/products/*`, a `(patient)` self-service portal, `/appointments/[id]`,
> `/patients/[id]/documents`) that **does not exist**. The real app is much flatter: most
> list+detail interactions happen via modals/tabs on one page rather than separate routes, several
> pages are mockup shells for not-yet-built modules (M3/M5/M7/M9/M10 — see their module docs), and
> there is no patient-facing portal at all.
>
> **Updated 2026-08-31:** Keycloak removed — `/login` is now a real form and `/forgot-password` /
> `/reset-password` are new; the old `/login/callback` OAuth redirect and all three
> `apps/web/app/api/auth/*` Route Handlers are gone.

## Route Groups

### `(auth)` — unauthenticated

| Path | File | Description |
|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Real email + password form — posts to `/api/auth/login` |
| `/activate` | `(auth)/activate/page.tsx` | Staff invitation acceptance (token from `POST /staff/invite`'s email) — not in the original doc at all |
| `/forgot-password` | `(auth)/forgot-password/page.tsx` | Not in the original doc — added 2026-08-31 with the Keycloak removal |
| `/reset-password` | `(auth)/reset-password/page.tsx` | Same — token-based, linked from the forgot-password email |

❌ No `/login/callback` page, and no `apps/web/app/api/auth/*` Route Handlers at all anymore — the
old OAuth/PKCE exchange with Keycloak is gone. `/api/auth/*` now reaches the API's own real
`/auth/*` routes through the generic `/api/*` rewrite, same as every other API call (see Auth
Guard section below).

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

✅ **Self-hosted, no library** (`@react-keycloak/web`/`next-auth` were never dependencies, and the
old Keycloak PKCE exchange is gone too). `middleware.ts` checks the `cap_session` cookie's mere
presence and redirects to `/login` if it's missing (with a `next=` param to return to); this is a
UX-level shortcut, not real verification — the cookie could be stale/invalid, and the actual auth
decision happens server-side. Role-based restrictions are enforced there, by the API's
`RolesGuard` (route-level `@Roles`, not page-level) reading the Redis session's role — the
frontend has no independent role check of its own.
