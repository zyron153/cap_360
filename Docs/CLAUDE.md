# CAP 360 — Docs Index

Guide to `Docs/`. Read this first, then the specific document you need.

## Source of truth

| Question | Document |
|---|---|
| What's actually built vs. planned, ground truth | [REVIEW.md](REVIEW.md) — full audit, findings tracked with fix status |
| What's done / in progress / next | [PROGRESS.md](PROGRESS.md) — overwritten each session |
| Task checklist across all phases | [TODO.md](TODO.md) — mirrors REVIEW.md's phase checklist |
| Session-by-session execution log | [PLAN.md](PLAN.md) — sprint tasks with verification evidence |

If REVIEW.md / TODO.md and a spec document disagree, the audit docs win — the specs describe
aspirational designs, several written for the pre-rebrand client.

## Specs (aspirational — check "Implementation status" notes inside each)

| Area | Document |
|---|---|
| Product requirements, 10 modules, 4-phase roadmap | [PRD.md](PRD.md) |
| Stack, system diagram, auth flow, env vars, perf | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Prisma schema mirror (canonical: `packages/database/prisma/schema.prisma`) | [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) |
| REST routes, request/response shapes, status codes | [API-SPEC.md](API-SPEC.md) |
| RBAC matrix, roles, guard flow | [ROLES-PERMISSIONS.md](ROLES-PERMISSIONS.md) |
| Security posture, encryption, audit, LGPD | [SECURITY.md](SECURITY.md) |
| Test strategy and what really exists | [TESTING.md](TESTING.md) |
| Local dev / staging / prod, CI/CD | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Next.js route map | [FRONTEND-ROUTES.md](FRONTEND-ROUTES.md) |
| Performance instrumentation + optimization passes | [PERFORMANCE_UPGRADES.md](PERFORMANCE_UPGRADES.md) |
| Visual design system | [DESIGN-PHILOSOPHY.md](DESIGN-PHILOSOPHY.md) |
| WhatsApp bot conversation design (M3 — not built) | [WHATSAPP-BOT-FLOWS.md](WHATSAPP-BOT-FLOWS.md) |
| Early gap analysis (historical snapshot) | [CODING-READINESS.md](CODING-READINESS.md) |

## Per-module detail

`modules/M1`…`M10` — one file per module, each with an "Implementation status" note at the top.
Built: M1 Appointments, M2 Patient CRM, M6 Billing/Financeiro, M7 Clinical Records, M8 Staff.
UI mockup only, no backend: M3 WhatsApp, M5 Exams, M9 Home Visits, M10 Analytics.

## Working notes

- Client is **CAP**, a psychology clinic in Cabo Verde (rebranded from "Mais Saúde CV").
- Monorepo: `apps/api` (NestJS), `apps/web` (Next.js 15), `packages/{database,types,config}`.
- Auth is self-hosted (argon2id + Redis sessions); Keycloak was removed 2026-08-31.
- `AUTH_BYPASS=true` for local dev; fails safe if unset.
- Schema changes use `prisma db push`, not migrations.
- After a session, overwrite [PROGRESS.md](PROGRESS.md).
