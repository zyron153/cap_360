# CAP 360 — Coding Readiness Analysis

> **Prepared:** June 2026
> **Purpose:** Cross-reference all architecture docs, identify gaps, and list everything that must be resolved or created before a developer can write the first line of production code.
> **Verdict (original):** The project is well-architected but had 6 blocking gaps and 14 non-blocking gaps before coding could start.
> **Status (June 2026):** All 6 blocking gaps are resolved. Coding is underway. See updated gap statuses below.

> **2026-08-30 note:** this is now a historical, point-in-time snapshot from very early in the
> project. Coding has since progressed far past "underway" — core modules (Appointments, Patients,
> Billing/Financeiro, Staff) are built and covered by ~225 automated tests. The "✅ Complete" column
> in §1 tracks **documentation existing**, not features being implemented as described — several of
> those documents' contents have since been found to describe aspirational designs that were
> simplified or never built (see each doc's own "Implementation status" note, added in this pass).
> For current, ground-truth gap tracking, see `TODO.md` and `REVIEW.md` instead of this file.

---

## 1. Overall Assessment

| Category | Status | Notes |
|---|---|---|
| Business requirements (PRD) | ✅ Complete | 10 modules, 18 features, 4-phase roadmap |
| System architecture | ✅ Complete | Stack, diagrams, data flow, env vars, BFF pattern, observability |
| Database schema | ✅ Complete | All tables, indexes, constraints |
| API contract | ✅ Complete | All endpoints, roles, payloads, error codes; BFF section added v1.1 |
| Roles & permissions | ✅ Complete | Full RBAC matrix + Keycloak config |
| WhatsApp bot flows | ✅ Complete | FSM states, templates, handoff logic |
| Security & compliance | ✅ Complete | Encryption, audit, LGPD alignment |
| Deployment & CI/CD | ✅ Complete | Docker, K8s manifests, pipelines |
| Testing strategy | ✅ Complete | Unit, integration, E2E, perf, security |
| **Prisma schema file** | ✅ **RESOLVED** | `packages/database/prisma/schema.prisma` — 29 tables, migrations applied |
| **Monorepo scaffold** | ✅ **RESOLVED** | pnpm workspaces + Turbopack + `turbo.json` fully set up |
| **Keycloak realm export** | ✅ **RESOLVED** (as of this pass) | `infra/keycloak/cap-realm.json`, imported automatically by `docker compose up` |
| **Seed data script** | ✅ **RESOLVED** | `packages/database/src/seed.ts` (not under `prisma/`) |
| **Environment example files** | ✅ **RESOLVED** | Root `.env.example` and per-app `.env` templates created |
| **UI wireframes / screens** | ✅ **REPLACED** | All 12 sidebar screens implemented as working Next.js pages |
| **BSP / WhatsApp credentials** | ⚠️ PENDING | 360dialog or Twilio account not yet set up |
| **Domain names / DNS** | ⚠️ PENDING | api.maissaudecv.com, app.maissaudecv.com not confirmed |

---

## 2. Blocking Gaps (must resolve before coding starts)

These are hard blockers — code cannot be written, run, or tested without them.

---

### BLOCK-01 · Missing Prisma Schema (`schema.prisma`)

**Impact:** The entire data layer is blocked. Prisma generates TypeScript types, the database client, and migration files from `schema.prisma`. Without it:
- No type-safe DB queries
- No migrations to run
- No seed script can reference models
- Integration tests cannot run

**What's needed:** Translate the entire `DATABASE-SCHEMA.md` SQL definition into a `schema.prisma` file at `packages/database/prisma/schema.prisma`.

**What exists:** Complete SQL DDL in `DATABASE-SCHEMA.md` — the translation is mechanical, not creative.

**Estimated effort:** 2–3 hours

---

### BLOCK-02 · Missing Monorepo Scaffold

**Impact:** The entire development environment cannot start. `DEPLOYMENT.md` defines the repo structure (`apps/api`, `apps/web`, `apps/whatsapp-hub`, `packages/database`, etc.) and uses `pnpm workspaces` + Turbo, but none of these files exist.

**What's needed:**
- Root `package.json` with `pnpm` workspaces config
- `pnpm-workspace.yaml`
- `turbo.json` (build pipeline)
- `tsconfig.base.json` (shared TypeScript config)
- Each app's own `package.json` with correct dependencies
- `apps/api` bootstrapped as NestJS app
- `apps/web` bootstrapped as Next.js 14 app
- `apps/whatsapp-hub` bootstrapped as NestJS app
- `packages/database` with Prisma dependencies

**Estimated effort:** 4–6 hours (or use a Turborepo starter and adapt)

---

### BLOCK-03 · Missing Keycloak Realm Export

**Impact:** `docker-compose.yml` mounts `./infrastructure/keycloak/realm-export.json` to auto-import the realm on startup. Without it, Keycloak starts blank — no realm, no clients, no roles. Every developer who runs `docker compose up` gets a broken auth server.

**What's needed:** A `realm-export.json` file that defines:
- Realm `maissaude`
- Client `api-server` (confidential, service accounts)
- Client `web-app` (public, redirect URIs)
- Client `mobile-app` (public)
- All 7 roles: `admin`, `doctor`, `nurse`, `receptionist`, `lab_tech`, `patient`, `corporate_hr`
- Password policy, brute-force protection, session timeouts
- Protocol mappers (to embed `patient_id` in JWT for patient role)

The configuration is fully defined in `ROLES-PERMISSIONS.md` — it needs to be serialised into Keycloak's JSON export format.

**Estimated effort:** 2–3 hours

---

### BLOCK-04 · Missing `.env.example` Files

**Impact:** Any developer cloning the repo cannot start. `DEPLOYMENT.md` says `cp apps/api/.env.example apps/api/.env` — but those files don't exist. Without them, the app won't start (missing DB URL, Redis URL, Keycloak URL, etc.).

**What's needed:** Three `.env.example` files:
- `apps/api/.env.example`
- `apps/web/.env.example.local`
- `apps/whatsapp-hub/.env.example`

All required variables are already documented in `ARCHITECTURE.md §7.1`. It's a transcription task, not a design task.

**Estimated effort:** 30 minutes

---

### BLOCK-05 · Missing Database Seed Script

**Impact:** Without seed data, the app boots to an empty state — no services, no rooms, no staff accounts, no specialties. The booking widget cannot render (no services to select), the calendar is blank, and no login accounts exist for testing.

**What's needed:** `packages/database/prisma/seed.ts` that creates:
- 5 services (Cardiologia, Pediatria, Odontologia, ECG, Ultrassom)
- 3 rooms (Sala 1, Sala Dental, Sala de Exames)
- 3 doctor accounts (linked to Keycloak)
- 2 receptionist accounts
- 1 lab_tech account
- 1 admin account
- 1 corporate company + corporate health plan
- 5 sample patients with phone numbers
- 10 appointments spread over next 7 days

Referenced in `DEPLOYMENT.md §3.1` and `TESTING.md §8.1` — both list the desired content.

**Estimated effort:** 3–4 hours

---

### BLOCK-06 · Missing GitHub Repository

**Impact:** The CI/CD pipeline references `github.com/maissaude/maissaude-360` and uses GitHub Container Registry (`ghcr.io/maissaude/api`). Without the repository:
- No version control
- No CI/CD pipeline
- No branch strategy (develop / staging / main)
- No secret management for staging/prod

**What's needed:** GitHub organisation `maissaude` (or personal repo) and repository `maissaude-360` created with branch protection rules on `main` and `staging`.

**Estimated effort:** 30 minutes (admin task, not a coding task)

---

## 3. Non-Blocking Gaps (should resolve within first sprint)

These don't stop coding from starting but will cause pain if ignored.

---

### GAP-01 · Port Mismatch ✅ RESOLVED

Canonical ports are: Web=3000, API=3001, WhatsApp Hub=3002. Implemented and consistent across all config files.

---

### GAP-02 · Undecided: Hetzner vs AWS

**Where:** Stack table and disaster recovery both say "Hetzner Cloud (EU) **or** AWS eu-west-1". This is an OR that must become an AND.

**Resolution needed:** Decision required before infrastructure is provisioned. Affects: backup bucket target (S3 vs Hetzner Object Storage), K8s setup (K3s vs EKS), and secrets provider (Vault vs AWS Secrets Manager). **Recommendation:** Hetzner for MVP (lower cost, EU compliance); AWS migration if scale demands it.

---

### GAP-03 · Undecided: 360dialog vs Twilio (WhatsApp BSP)

**Where:** `ARCHITECTURE.md §2.5` and `WHATSAPP-BOT-FLOWS.md` both say "360dialog or Twilio". The webhook URL format and SDK are different between the two.

**Resolution needed:** Choose one BSP before writing the webhook handler. **Recommendation:** 360dialog — lower monthly cost, simpler API, purpose-built for WhatsApp.

---

### GAP-04 · No NGINX Configuration File

**Where:** `DEPLOYMENT.md §6.3` shows a K8s Ingress manifest but `infrastructure/nginx/` is listed in the repo structure with no content. The security headers in `SECURITY.md §5.4` reference specific NGINX directives that must be configured.

**Resolution needed:** An `infrastructure/nginx/nginx.conf` file with TLS, rate limiting, CORS, and security headers.

---

### GAP-05 · No Dockerfile for Each App

**Where:** `DEPLOYMENT.md §5.1` builds Docker images with `docker build -t ... ./apps/api` but no `Dockerfile` exists for any of the three apps (`api`, `web`, `whatsapp-hub`).

**Resolution needed:** Three Dockerfiles, one per app, using multi-stage builds (build → production). All should run as non-root users per `SECURITY.md §10`.

---

### GAP-06 · Unresolved: `patient_id` JWT Claim for Patient Role

**Where:** `SECURITY.md §2.2` says tokens carry `patient_id` for patient role. Keycloak does not natively add a `patient_id` claim — it needs a custom protocol mapper that queries the DB or maps from a Keycloak user attribute.

**Resolution needed:** Decide how `patient_id` is linked in Keycloak: (a) stored as a custom user attribute during patient registration, or (b) the API resolves `patient_id` from `sub` (Keycloak user ID) on each request. Option B is simpler and avoids a Keycloak-DB dependency.

---

### GAP-07 · Missing `GET /patients/me` Endpoint ✅ RESOLVED

`GET /v1/patients/me` is implemented in `PatientsController` — reads `patient_id` from JWT claim and delegates to `findById`. The remaining `/me` endpoints (`appointments`, `invoices`, `health-plans`) are still pending per the patient self-service portal (Phase 4).

---

### GAP-08 · No Health Plan Service CRUD (`/health-plan-products`)

**Where:** `DATABASE-SCHEMA.md` defines `health_plan_products` (the catalogue of plan tiers). `API-SPEC.md §5` covers `/health-plans` (subscriptions) but there are no endpoints to create/list/edit the product catalogue.

**Resolution needed:** Add `GET /health-plan-products`, `POST /health-plan-products`, `PATCH /health-plan-products/:id` to the API spec.

---

### GAP-09 · No Company CRUD Endpoints

**Where:** `DATABASE-SCHEMA.md §5.3` defines the `companies` table. There are no API endpoints to create or manage companies, which are required before a corporate health plan can be assigned.

**Resolution needed:** Add `GET /companies`, `POST /companies`, `PATCH /companies/:id` to the API spec.

---

### GAP-10 · Invoice Number Sequence ✅ RESOLVED

Implemented using `pg_advisory_lock` keyed on the year in `BillingRepository.nextInvoiceNumber()`. Format: `INV-YYYY-NNNN`. Thread-safe; no PostgreSQL sequence or Redis dependency needed.

---

### GAP-11 · Exam Result Download Token Generation Not Specified

**Where:** `DATABASE-SCHEMA.md §6.2` has `download_token VARCHAR(255)` and `token_expires_at`. The API says "Token expires in 72 hours. Access is logged." But the token generation algorithm is unspecified.

**Resolution needed:** Specify token generation. **Recommendation:** `crypto.randomBytes(32).toString('hex')` — 64-char hex, stored hashed (SHA-256) in DB, sent as plaintext to patient. Standard secure token pattern.

---

### GAP-12 · No Public Holidays Table / Configuration

**Where:** `M8-staff-resource-scheduler.md` says "Public holidays (configurable calendar)" block availability. No table is defined in `DATABASE-SCHEMA.md` and no API endpoint manages it.

**Resolution needed:** Add a `public_holidays` table and admin endpoint (`POST /settings/public-holidays`), or at minimum define the approach (hardcoded list per year vs. dynamic table).

---

### GAP-13 · Concurrent Slot Lock ✅ RESOLVED

Implemented in `AppointmentsService.create()` using Redis `SET NX PX` with key `slot:{staffId}:{scheduledAt.toISOString()}` and 30-second TTL. Released in the `finally` block after the appointment is created or the conflict is detected.

---

### GAP-14 · No Frontend Route Map ✅ RESOLVED

`Docs/FRONTEND-ROUTES.md` documents all Next.js App Router paths with roles and descriptions. All 12 sidebar pages are implemented.

---

## 4. External Dependencies (non-code, but code-blocking)

These require action from the clinic owner or project manager before certain features can be developed or tested.

| Dependency | Blocking | Status | Action Required |
|---|---|---|---|
| Meta Business Account verification | WhatsApp bot (M3) | ⚠️ Not started | Clinic must verify FB Business Manager |
| WhatsApp WABA approved | All WhatsApp features | ⚠️ Not started | Submit via 360dialog/Twilio |
| WhatsApp message templates approved | Reminders, notifications | ⚠️ Not started | Submit 9 templates for Meta review (7–10 days) |
| SendGrid account + domain verification | Email notifications | ⚠️ Not started | Create account, verify noreply@maissaudecv.com |
| Africa's Talking account | SMS fallback | ⚠️ Not started | Create account, top up credits |
| Google Maps API key | Home visits (M9) | ⚠️ Not started | Enable Maps + Places APIs, restrict key |
| Cloudflare R2 account | File storage | ⚠️ Not started | Create bucket `maissaude-files`, configure CORS |
| Domain DNS configuration | All public URLs | ⚠️ Not started | Point api/app subdomains to server |
| Keycloak hosting | Auth for all apps | ⚠️ Not started | Can self-host on same server as API |
| SSL certificates | All public URLs | ⚠️ Not started | Auto-managed via cert-manager (Let's Encrypt) |

> **Note:** Items marked "Not started" do not block local development — they can be mocked. They **do** block staging and production deployment.

---

## 5. What You Have (is sufficient to code Phase 1)

If the 6 blocking gaps are resolved, you can immediately build:

| Feature | Ready to Code? | Blocking Gap |
|---|---|---|
| Patient CRM (M2) | ✅ after BLOCK-01–05 | Needs Prisma schema + scaffold |
| Appointment Engine — calendar | ✅ after BLOCK-01–05 | Needs Prisma schema + scaffold |
| Appointment Engine — booking widget | ✅ after BLOCK-01–05 | — |
| Automated reminders (BullMQ) | ✅ after BLOCK-01–05 | — |
| WhatsApp agent inbox | ✅ after BLOCK-01–05 + BSP | Needs 360dialog account for staging |
| Basic billing / invoicing | ✅ after BLOCK-01–05 + GAP-10 | Invoice sequence must be decided |
| Check-in workflow | ✅ after BLOCK-01–05 | — |
| Auth / RBAC | ✅ after BLOCK-01–03 | Needs Keycloak realm file |
| WhatsApp bot FSM | ✅ after all above | Needs BSP account for live testing |
| Health plans | ✅ after BLOCK-01–05 + GAP-08/09 | Missing product & company endpoints |
| Exam portal | ✅ after BLOCK-01–05 + R2 setup | Needs storage account for file uploads |
| EMR / Clinical notes | ✅ after BLOCK-01–05 | — |
| Analytics dashboard | ✅ after all modules | Materialised views need data |

---

## 6. Recommended First Actions (ordered)

| # | Action | Owner | Effort | Blocks |
|---|---|---|---|---|
| 1 | Create GitHub repository `maissaude-360` | PM / Dev Lead | 30 min | Everything |
| 2 | Scaffold monorepo (pnpm + Turbo + apps) | Dev Lead | 4–6 hrs | Everything |
| 3 | Write `schema.prisma` from DATABASE-SCHEMA.md | Backend Dev | 2–3 hrs | All backend |
| 4 | Create `realm-export.json` for Keycloak | Backend Dev | 2–3 hrs | Auth |
| 5 | Create `.env.example` files | Any Dev | 30 min | Local dev |
| 6 | Write seed script `prisma/seed.ts` | Backend Dev | 3–4 hrs | Testing |
| 7 | Decide Hetzner vs AWS | PM + Dev Lead | 1 hr | Infra |
| 8 | Decide 360dialog vs Twilio | PM + Dev Lead | 1 hr | WhatsApp |
| 9 | Resolve port assignments (GAP-01) | Dev Lead | 15 min | Docs |
| 10 | Add `/me` endpoints to API-SPEC.md | Backend Dev | 1 hr | Patient portal |
| 11 | Add company + plan product endpoints | Backend Dev | 1 hr | Health plans |
| 12 | Define invoice number sequence (GAP-10) | Backend Dev | 30 min | Billing |
| 13 | Write FRONTEND-ROUTES.md | Frontend Dev | 1–2 hrs | Frontend dev |
| 14 | Create Dockerfiles (3 apps) | DevOps | 2 hrs | CI/CD |
| 15 | Create `infrastructure/nginx/nginx.conf` | DevOps | 1–2 hrs | Deployment |

---

## 7. Files That Need to Be Created Next

In priority order:

```
packages/database/prisma/schema.prisma        ← BLOCK-01 (critical)
packages/database/prisma/seed.ts              ← BLOCK-05 (critical)
infrastructure/keycloak/realm-export.json     ← BLOCK-03 (critical)
apps/api/.env.example                         ← BLOCK-04 (critical)
apps/web/.env.example.local                   ← BLOCK-04 (critical)
apps/whatsapp-hub/.env.example                ← BLOCK-04 (critical)
package.json (root)                           ← BLOCK-02 (critical)
pnpm-workspace.yaml                           ← BLOCK-02 (critical)
turbo.json                                    ← BLOCK-02 (critical)
tsconfig.base.json                            ← BLOCK-02 (critical)
apps/api/package.json                         ← BLOCK-02 (critical)
apps/web/package.json                         ← BLOCK-02 (critical)
apps/whatsapp-hub/package.json                ← BLOCK-02 (critical)
FRONTEND-ROUTES.md                            ← GAP-14 (high)
infrastructure/nginx/nginx.conf               ← GAP-04 (high)
apps/api/Dockerfile                           ← GAP-05 (medium)
apps/web/Dockerfile                           ← GAP-05 (medium)
apps/whatsapp-hub/Dockerfile                  ← GAP-05 (medium)
```

---

## 8. What Is Intentionally Out of Scope (Phase 1)

The following are documented but explicitly deferred to Phase 4 — do not attempt to implement:

- Vinti4 payment gateway (F-17)
- Patient self-service portal (F-15)
- Corporate HR portal (F-16)
- ~~DICOM imaging viewer (F-18)~~ — **cut entirely**, not just deferred: the client is now CAP, a psychology clinic, with no ultrasound/ECG imaging use case (see `Docs/PRD.md` §7)
- Mobile app (React Native) — Phase 3 is first use
- Advanced BI/analytics exports

---

*CAP 360 · Coding Readiness Analysis v1.0 · June 2026 · annotated 2026-08-30 as a historical snapshot*
