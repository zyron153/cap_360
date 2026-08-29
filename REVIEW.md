# CAP 360 — Full Implementation Review

**Reviewer stance:** senior engineer audit, read-only. Nothing in the codebase was changed to produce this document.
**Scope:** the whole app — every API module, every web route, the Prisma schema, auth/security posture, and how reality compares to `Docs/PRD.md`, `Docs/ROLES-PERMISSIONS.md`, `Docs/SECURITY.md`, `Docs/modules/M*.md`, and `Docs/TODO.md`.
**Grouping:** the checklist follows the PRD's own **Phase 1–4** roadmap (`Docs/PRD.md` §8), not the order features were built in.
**Confidence:** every claim below is grounded in a specific file. Where I inferred behavior rather than executing it, I say so.

---

## 0. Executive Summary

CAP 360 is meaningfully further along than a prototype — the appointments engine has real distributed-lock conflict resolution, the billing/E-Fatura pipeline is a genuine integration with Cabo Verde's tax authority, and the new Financeiro module is solid, tested code. That's the good news, and it's substantial.

The bad news is that the project is running on a PRD written for a **different client**. `Docs/PRD.md` describes "Mais Saúde CV," a multi-specialty clinic offering Cardiology, Dental, Ophthalmology, ECG/Holter/MAPA, and ultrasound imaging. The actual client — CAP, a psychology clinic — was substituted into the code's branding (name, NIF, email, address) but **not into the product requirements, the roles matrix, the security spec, or the database schema's own header comment**, all of which still describe the old business. That mismatch isn't cosmetic: ICD-10 diagnosis coding, dental service catalogues, and DICOM imaging viewers are in the roadmap for a business that does none of those things, while the roadmap has nothing to say about session notes, therapy-specific consent, or the extra sensitivity of "this person is a mental-health patient" as a fact in itself.

Underneath that, four of the ten planned modules — **WhatsApp Hub, Clinical Records, Home Visits, Analytics** — are UI shells with hardcoded arrays and zero backend behind them. That's not a criticism of leaving them for later; it's a note that anyone glancing at the sidebar today would reasonably believe those features work, and they don't. Nothing persists, nothing is real.

The single most important finding is in `apps/api/src/common/guards/jwt-auth.guard.ts:27`: authentication bypass is **on by default** — it activates whenever `AUTH_BYPASS` is simply *unset*, not only when someone explicitly turns it on. Every unauthenticated request becomes a hardcoded admin user. This is fine for local dev, and I understand why it exists (Keycloak's dev-mem instability, documented elsewhere in this session), but the polarity is backwards for anything that will ever run outside a laptop — the safe state should be the default, not something you have to remember to type `AUTH_BYPASS=false` to get back.

Field-level encryption for NIF and date of birth — which `Docs/SECURITY.md` mandates and which `schema.prisma:106` still claims is happening in a stale `///` comment — does not exist anywhere in the codebase. `Docs/TODO.md:371` confirms this was always intended and never built.

None of this means the project is in bad shape for what it actually is: a fast-moving internal tool built by one developer against a moving business target, with dev-bypass auth as an explicit, known, temporary tradeoff. It means the gap between "what the sidebar promises" and "what's real" is wide enough that it should be closed or clearly labeled before anyone outside this session relies on it.

---

## 1. Critical Findings (fix before this touches real patient data)

These are ranked by consequence, not by where they sit in the codebase.

### 1.1 — Auth bypass defaults to *on*
**Status: ✅ Fixed.** Bypass now requires the literal `AUTH_BYPASS=true` in both the guard and the middleware; an unset var fails safe. `.env`/`.env.example` updated with the explicit opt-in on both apps. TDD: `jwt-auth.guard.spec.ts` (4 tests). Live-verified: app loads under the new explicit flag with no behavior change for this dev environment.
**File:** `apps/api/src/common/guards/jwt-auth.guard.ts:27`, mirrored in `apps/web/middleware.ts`
```ts
if (process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS !== "false") {
  request.user = { sub: "...", realm_access: { roles: ["admin"] } };
  return true;
}
```
An **unset** `AUTH_BYPASS` env var is bypass-on. The only thing standing between "wide open, full admin, no login" and a real deployment is remembering that `NODE_ENV=production` gets set correctly everywhere, every time, including in staging, demo, and CI environments that people spin up casually. Invert this: require `AUTH_BYPASS=true` to *enable* the hole, so a forgotten env var fails safe instead of failing open. This is doubled now that the same pattern lives in both the API guard and the Next.js middleware — two places that both need the same env discipline instead of one.

### 1.2 — No field-level encryption, despite the schema claiming otherwise
**Status: ✅ Fixed for `nif`** (the field the stale comment was actually about). New `EncryptionService` (AES-256-GCM, stdlib `crypto`, key from `FIELD_ENCRYPTION_KEY`). `Patient.nif` is encrypted at rest; a new `nifHash` (HMAC-SHA256 blind index) column enables exact-match lookup/search/uniqueness without decrypting every row — `contains`-style substring search on NIF is no longer possible, exact search still is. Every read site that touches `patient.nif` was found and fixed: `PatientsRepository`, `BillingRepository.findById` (invoice preview/receipt), `EFaturaProcessor` (the actual tax-authority submission). `nifHash` itself is stripped from API responses (brute-forceable given NIF's small keyspace, no legitimate frontend use). 3 pre-existing plaintext NIFs in the dev DB were backfilled. TDD: `encryption.service.spec.ts`, `patients.repository.spec.ts`, `billing.repository.spec.ts`, `efatura.processor.spec.ts` (29 tests total). Live-verified end-to-end: create → decrypt-on-read, exact-NIF search, migrated-row decrypt, and the real invoice-detail endpoint all confirmed against the running DB.
**Deliberately not done:** `date_of_birth` encryption (also named in SECURITY.md) — DOB is used for sorting/range queries/age display throughout the app; encrypting it needs an application-level filtering strategy, not just an encrypt/decrypt wrapper, and is a bigger call than this pass should make unilaterally.
**Files:** `packages/database/prisma/schema.prisma:106` (comment), `Docs/SECURITY.md` §4.3, `Docs/TODO.md:371`
```prisma
/// AES-256-GCM encrypted at application layer
nif  String? @db.VarChar(50)
```
`grep -r "AES|encrypt|createCipher" apps/api/src` returns nothing that touches patient data — the only `crypto` imports in the app are `randomBytes`/`randomUUID`/`createHmac` for token generation, unrelated to encryption at rest. `nif` is rendered as plain text in the invoice preview (`FaturaPreviewModal`), stored as plain text, searched as plain text. The `VarChar(50)` column width is itself evidence the field was never sized for ciphertext — a real AES-256-GCM blob (IV + tag + base64) for a 9-digit NIF would need well over 50 characters. Either implement the encryption this comment promises, or delete the comment so nobody downstream trusts it.

### 1.3 — Invoice pricing has no server-side floor
**Status: ✅ Fully fixed, including the RBAC gate.** `unitPrice > 0` was already Zod-enforced. `create()` looks up the catalogue price for any line item with a `serviceId`; if the billed price differs, only `admin` may proceed (everyone else gets `ForbiddenException`), and the override is logged either way (patient, service, catalogue vs. billed price). Custom/off-catalogue line items (no `serviceId`) aren't restricted — there's no catalogue price to override — though in practice `serviceId` is a required field on every line item, so that carve-out is currently unreachable via the real API (harmless, just worth knowing if you're reading the code). TDD: 6 tests in `billing.service.spec.ts`, incl. the Forbidden path.
**File:** `apps/api/src/modules/billing/billing.service.ts:28-50`, `billing.controller.ts` (now passes caller roles through)
```ts
for (const item of dto.items) {
  const total = item.unitPrice * item.quantity;   // client-supplied, unchecked
  ...
}
```
`create()` never cross-checks `item.unitPrice` against `Service.price`. The frontend's "Outro valor" checkbox already signals that manual overrides are an intended feature — that's a reasonable requirement — but there's no role gate, no audit trail distinguishing an override from a catalogue price, and no floor/ceiling sanity check. Combined with §1.4 below (the audit log doesn't capture *what* changed, only *that* something changed), a wrong or fraudulent price on an invoice is invisible after the fact.

### 1.4 — Audit log only sees mutations, records no diff, and fails silently
**Status: ✅ Fixed all three gaps** (before/after diffing scoped to Patients + Financeiro, per explicit decision — see below). The silent `.catch(() => {})` now logs the failure via `Logger.error` instead of vanishing it. A new `@AuditView()` decorator (mirrors the existing `@Roles`/`@Public` pattern) lets specific GET routes opt into audit logging without flooding the table with routine reads — applied to `GET /patients/:id` ("patient record viewed", the exact case SECURITY.md names). Before/after diffing: `RequestContext` (the existing AsyncLocalStorage used for SQL-timing) grew a `setAuditDiff(before, after)` slot a service can fill mid-request; `AuditInterceptor` attaches it to the same audit_log row if present, so there's no second DB round-trip just to capture a diff. Wired into `PatientsService.update/softDelete` and `FinanceiroService.updateExpense/decideExpense/deleteExpense/updateIncome/deleteIncome` — each diff shows only the fields actually submitted, not a full-record dump. TDD: `request-context.spec.ts` (3), `audit.interceptor.spec.ts` (+2), `patients.service.spec.ts` (+3), `financeiro.service.spec.ts` (+5). Live-verified: PATCHed a real patient's email through the running API, then read the actual `audit_log` row back from Postgres — `metadata.diff` showed exactly `{before:{email:null}, after:{email:"..."}}`.
**File:** `apps/api/src/common/interceptors/audit.interceptor.ts`, `apps/api/src/common/context/request-context.ts`
```ts
if (!MUTATING_METHODS.has(request.method)) return next.handle();  // GETs are invisible
...
this.prisma.auditLog.create({ data: { action: method, resource, ... } })
  .catch(() => { /* Audit failures must never break the request */ });  // and lost forever
```
Three separate gaps stacked on top of each other:
- `Docs/SECURITY.md` explicitly requires "Patient record viewed" to be logged. Reads are entirely excluded here — only POST/PATCH/PUT/DELETE are audited. For a psychology clinic, "who *looked at* this file" is often the more sensitive question, not just "who edited it."
- `action` is the raw HTTP verb (`"PATCH"`), not a semantic event (`"clinical_note_edited"`), and there's no before/after value capture — `Docs/SECURITY.md`'s own spec wants exactly that for clinical notes.
- If the audit write fails, the `.catch(() => {})` swallows it with no log line anywhere. A DB hiccup during a sensitive action means that action is now unaccountable, and nobody will ever know it happened.

### 1.5 — MFA is specified, nowhere configured
**Status: ✅ Fixed for new accounts.** `KeycloakAdminService.createUser()` now sets `requiredActions: ["CONFIGURE_TOTP"]` for admin/doctor/corporate_hr specifically (the roles SECURITY.md marks mandatory, not the recommended-only ones) — new staff in those roles are forced through TOTP enrollment on first login. TDD: `keycloak-admin.service.spec.ts` (6 tests, one per role).
**Not actionable right now:** retroactive enforcement for accounts that already exist in a live realm — that needs a one-time realm-admin action against a real, persistent Keycloak instance. The only one currently running is local dev (H2 in-memory, wiped on restart, seeded test accounts) — nothing real to retrofit yet. Relevant again once a staging/production realm exists.
**Files:** `Docs/SECURITY.md` §2.3 (admin/doctor/corporate_hr: mandatory TOTP), `infra/keycloak/cap-realm.json`
`grep -i "otpPolicy|requiredActions|CONFIGURE_TOTP" infra/keycloak/cap-realm.json` returns nothing. Password policy and brute-force protection *are* configured (`cap-realm.json:11,21`) — MFA simply isn't, for any role. Moot while auth-bypass is active, but it needs to exist before that flag ever flips off in a real environment.

### 1.6 — Money-moving flows have no idempotency key and no transaction boundary
**Status: ✅ Fully fixed, including client-supplied idempotency keys.** `BillingRepository.recordPaymentAtomic` does the insert, re-sum, and status update inside one `prisma.$transaction`. `AppointmentsService.create` locks *every* 30-min grid bucket the appointment's interval touches (not just its exact start time), so two overlapping-but-not-identical slot requests (10:00–10:30 vs 10:15–10:45) correctly contend for a shared lock key; a partial lock failure rolls back whatever it already acquired. On top of that: `Payment` and `Appointment` both got a nullable, unique `idempotencyKey` column — a client-generated UUID sent with the request. A retried request (double-click, timeout retry) with the same key replays the original result instead of touching the DB again; the check runs *before* any status/conflict validation, since the original request may have already changed the state a naive re-check would reject against (e.g. this payment is what made the invoice "paid"). Frontend: all 4 real submission points (payment form, both appointment-booking forms, the dashboard quick-add modal) generate one key per attempt via `crypto.randomUUID()`, stable across retries of the same submit, regenerated after success. TDD: `billing.repository.spec.ts`/`billing.service.spec.ts`/`appointments.service.spec.ts` (+7 combined). Live-verified against the real server: POSTed the same payment and the same appointment-booking request twice each with an identical idempotency key — both times, exactly one row exists in the DB and both HTTP responses were byte-identical.
**Files:** `billing.service.ts` (`recordPayment`), `appointments.service.ts` (`create`), `billing.repository.ts`, `appointments.repository.ts`, `packages/database/prisma/schema.prisma`, plus 4 frontend call sites
`recordPayment` does read-sum → insert → read-sum-again → update-status as four separate round-trips, not one `$transaction`. Two concurrent payment submissions (a double-click, a client retry after a timeout) can both pass the same status check and both insert — there's no unique constraint on `Payment` and no client-supplied idempotency key to de-dupe a retried request. Same shape of problem in appointment creation: the Redis lock only covers the exact same start timestamp, so two *overlapping-but-not-identical* slot requests (10:00–10:30 vs 10:15–10:45) don't contend for the same lock key and can both pass the DB conflict check before either commits.

### 1.7 — Public, unauthenticated read endpoints are explicitly exempted from rate limiting
**Status: ✅ Fixed.** All four public GET routes (`services`, `staff`, `availability`, `invitations/:token`) now carry `@Throttle({default:{limit:60,ttl:60_000}})` matching SECURITY.md's 60 req/min per IP, replacing `@SkipThrottle()`. No unit test — this codebase has no throttling test infrastructure and Jest mocks can't meaningfully exercise real request-timing/counting — instead live-verified against the running server: 65 rapid requests to `/v1/public/services` returned exactly 60×200 then 5×429.
**File:** `apps/api/src/modules/public/public.controller.ts:20,26,32`
```ts
@Public()
@Controller("public")
export class PublicController {
  @SkipThrottle() @Get("services") ...
  @SkipThrottle() @Get("staff") ...
  @SkipThrottle() @Get("availability") ...   // real DB work, no auth, no limit
```
`Docs/SECURITY.md` §5.1 specifies 60 req/min per IP for exactly this endpoint group. The write endpoints (`POST /bookings`, `POST /invitations/:token/activate`) correctly keep a strict `@Throttle`; someone evidently hit local rate-limit friction testing the read endpoints and reached for `@SkipThrottle()` without reconsidering it for production. `getAvailability` does real per-request database work (per `appointments.service.ts`'s slot-generation loop) and is a plausible scraping/DoS surface as it stands.

---

## 2. Privacy & Compliance — dedicated section

This is a **psychology clinic**. The fact that someone is a client at all is sensitive in a way that isn't true for, say, a dental practice — and the current implementation doesn't treat it that way anywhere. This section checks `Docs/SECURITY.md`'s own claims against what actually exists.

| SECURITY.md claim | Reality | Evidence |
|---|---|---|
| AES-256-GCM for `nif`, `date_of_birth`, clinical notes, prescriptions | **Not implemented.** No encryption code exists; `nif` is plain text end-to-end | §1.2 above |
| MFA mandatory for admin/doctor/corporate_hr | **Not configured** in Keycloak realm | §1.5 above |
| Audit log: "Patient record viewed" | **Not captured** — only mutations are logged | §1.4 above |
| Audit log retained 7 years, append-only | Schema has no retention/immutability enforcement (no partitioning, no `REVOKE UPDATE/DELETE`, purely convention) | `schema.prisma:642-658` |
| Right to erasure: "soft-delete clears PII" | **False as written.** `softDelete()` sets `deletedAt` only; every PII field (name, phone, NIF, address, emergency contact) stays in the row indefinitely | `patients.repository.ts:37-42` |
| Explicit consent form signed at registration | Enforced in the **New Patient modal** (Zod-required checkbox) but **silently bypassed** by `findOrCreateByPhone`, which hardcodes `consentGiven: true` with no form ever shown | `patients.service.ts:160-178` vs `patients/page.tsx:129-142` |
| Data hosted in EU/CV-compliant region, mTLS internally | Infra-level, unverifiable from code — flagging as "needs an ops answer," not a code defect | — |
| Exam result download links: time-limited, logged | M5 (exams) has no result-file field on `ExamRequest` at all — nothing to time-limit yet | `schema.prisma:535-551`, §3 M5 below |
| Row-level patient self-service isolation (`patient_id = auth.patient_id`) | Implemented in exactly **one** place (`documents.controller.ts:24-33`) and unreachable everywhere else — `Patient` has no `keycloakId`, no login path exists | §3 Phase 4 below |

**The `findOrCreateByPhone` consent gap (row 6) is the one I'd fix first in this section.** It's the kind of thing that looks like a minor helper function and is actually the entire consent guarantee quietly not applying to some fraction of patients, depending on which intake path created them. Anyone auditing "did we get consent from everyone in the system" would get a wrong answer by trusting the `consentGiven` column at face value.

**Specific to a psychology practice**, worth adding to the spec even though it's not in `SECURITY.md` today: consider whether patient names/reasons-for-visit should ever appear in a WhatsApp reminder body (once M3 is real), whether "patient" as a search-autocomplete result exposed to reception staff needs a narrower default view than full history, and whether the generic `PatientNote.content` field (free text, no structure, visible to any role with patient-notes access per the RBAC matrix) is the right place for anything resembling session content — it currently has none of the SOAP-note access restrictions (`ROLES-PERMISSIONS.md` §3.3) that clinical notes are supposed to have, because it isn't a clinical note, it's a generic sticky-note field that predates M7.

---

## 3. Phase-by-Phase Checklist

Status legend: ✅ built and wired · 🟡 partial/stubbed · ❌ not started · 🎭 UI mockup only (no backend)

### Phase 1 — Foundation

#### M1 — Smart Appointment Engine
- ✅ Slot availability calculation (`appointments.service.ts:76-125`)
- ✅ Booking with Redis-backed conflict lock (`appointments.service.ts:127-168`) — genuinely good engineering, see §5.1 for the one gap
- ✅ Calendar query by date/staff/patient range (`appointments.service.ts:176-194`)
- ✅ Status transitions incl. auto-invoice-on-complete (`appointments.service.ts:196-229`)
- ✅ Reschedule with reminder-job cleanup (`appointments.service.ts:231-258`)
- ✅ Waitlist join/list
- ✅ WhatsApp/SMS/email reminder scheduling via BullMQ (channel is hardcoded to `"whatsapp"` regardless of `ReminderChannel` enum having SMS/email options — `appointments.service.ts:295`)
- 🟡 `getAvailability` **ignores** clinic-wide business hours and `PublicHoliday` — only `create()` enforces them, so the booking UI can offer a slot that gets rejected on submit (`appointments.service.ts:76` vs `:131`)
- 🟡 `getAvailability` **ignores** `LeaveRequest` — a staff member on approved leave still shows as bookable (confirmed as a known gap in `Docs/TODO.md:79`)
- ❌ Room/equipment double-booking conflict detection — `Room` model exists, nothing checks it (`Docs/TODO.md:278`)
- ❌ Recurring appointments for health-plan members
- ❌ Drag-and-drop reschedule on the calendar UI (need to verify against `appointments/page.tsx` — FullCalendar is wired, drag handler not confirmed)

#### M2 — Patient CRM
- ✅ CRUD, search (name/phone/NIF/email), pagination
- ✅ Soft delete
- ✅ Timeline (appointments + comms + invoices merged, capped at 20 each)
- ✅ New/Edit patient forms with Zod validation
- 🟡 Phone "normalization" is cosmetic only — strips non-digits and re-adds `+`, with **no country-code or format validation**; a number typed without `+238` silently becomes a broken number that will never receive a WhatsApp reminder (`patients.service.ts:180-183`)
- 🟡 NIF has no format validation client or server side, and no DB-level uniqueness constraint (only an index) — the app-level duplicate check is a bare `findFirst`, so a race between two concurrent creates can produce two patients with the same NIF (`schema.prisma:107`, `patients.service.ts:73-90`)
- ❌ Document upload — `PatientDocument` table and a download-URL endpoint exist; **there is no upload endpoint**, so nothing can ever populate that table via the API (`documents.controller.ts`)
- ❌ Notes panel — `POST .../notes` exists, `GET .../notes` (list) does not appear wired to a UI panel
- ❌ Tagging system (VIP, Chronic, etc.) — no field for it in `Patient`

#### M6 — Billing & Invoicing → now **Financeiro**
- ✅ Invoice creation, line items, sequential numbering
- ✅ Payment recording with status machine (draft → issued → partially_paid → paid), tested in `billing.service.spec.ts`
- ✅ E-Fatura submission to the Cabo Verde tax authority via BullMQ queue + retry, with its own processor test suite
- ✅ PDF receipt generation + R2 upload, with a graceful placeholder-URL fallback when R2 isn't configured
- ✅ **New this session:** Despesas (expenses) with approval workflow, receipt upload, category tracking
- ✅ **New this session:** Entradas (manual income) separate from invoice payments
- ✅ **New this session:** Overview tab — balance, monthly chart, category breakdown
- 🟡 No overpayment guard on `recordPayment` — nothing stops `amountPaid` from exceeding `total` (§1.6 covers the concurrency angle; this is the separate validation angle)
- 🟡 No server-side price floor (§1.3)
- ❌ Overdue-invoice detection job (daily cron marking `issued` invoices past `dueDate`) — `Docs/TODO.md:133`; the `InvoiceStatus.overdue` enum value exists and nothing ever sets it
- ❌ `POST /invoices/:id/cancel` endpoint

### Phase 2 — Communication

#### M3 — WhatsApp Integration Hub
- 🎭 **Entirely a UI mockup.** `whatsapp/page.tsx` has zero `fetch`/`useQuery` calls; `CONVERSATIONS` is a hardcoded const array. No `apps/api/src/modules/whatsapp` directory exists. No bot FSM, no webhook handler, no agent inbox persistence, no Meta Cloud API integration anywhere.
- The `ReminderChannel` enum and `AppointmentReminder` scheduling infrastructure from M1 *do* exist and are ready to be pointed at a real send service — that's the one piece of groundwork already laid for this module.

#### M4 — Health Plan Management
- ✅ Plan products, company linkage, patient subscription (`health-plans.service.ts`, `health-plans.controller.ts`)
- ✅ Frontend: browse products, subscribe/change/remove plan from the patient's profile (`patients/page.tsx` `PlanModal`)
- 🟡 Plan-number generation is a **client-computed guess** (`count of existing plans for this product+year, +1`), not a DB sequence — two concurrent "add plan" submissions for the same product can race to the same number; the `@unique` constraint on `planNumber` will catch it as a raw 500, not a friendly error (`patients/page.tsx:204-214`, `schema.prisma:389`)
- ❌ Utilization counter — `HealthPlan.usageCount` exists in the schema, nothing increments it (`Docs/TODO.md:208`)
- ❌ Renewal reminders (30/15/7 days)
- ❌ Corporate HR admin add/remove employees, usage reports (Phase 4 per PRD, listed here for completeness)

#### M5 — Exam & Results Portal
- 🟡 `ExamRequest` model exists, self-labeled `// Phase 1 stub` in the schema comment (`schema.prisma:535`)
- ❌ No result field on the model at all — no `resultR2Key`, no `resultedAt`. Even if a lab tech "uploads a result" through some future UI, there's nowhere in the current schema for that file reference to live.
- ❌ Notification-on-result, 72h token expiry, patient download portal — all absent
- 🎭 `exams/page.tsx` has 1 real fetch call (likely a dropdown data source) against 3 hardcoded arrays — the worklist itself is not live data

### Phase 3 — Clinical Operations

#### M7 — Clinical Records (EMR-lite)
- 🎭 **Entirely a UI mockup.** `records/page.tsx`: `useState(RECORDS_INITIAL)` is the only data source; "new record" pushes into local React state and is gone on refresh. Zero backend calls.
- **No backing tables exist** — no `ClinicalNote`, `Prescription`, or `Referral` model. `Docs/TODO.md:245` claims these are "already in schema" — they are not; only the generic `PatientNote` (free-text, no SOAP structure, no ICD-10, no lock-after-24h) exists. This is a documentation-vs-reality drift worth fixing in the docs regardless of when the feature itself gets built.
- Given the client is now a psychology clinic, this module's real-world shape (session notes, treatment plans) probably needs a fresh spec pass rather than resuming the old SOAP/ICD-10/prescription design written for a medical clinic — see §6.

#### M8 — Staff & Resource Scheduler
- ✅ Staff CRUD, availability (weekly recurring), invitations with Keycloak user provisioning
- ✅ `StaffShift`, `LeaveRequest` models exist and have repository methods
- 🟡 Invitation activation isn't transactionally safe — if the local `Staff` row creation fails *after* the Keycloak user was already created, you get an orphaned Keycloak account with no app-side record and no cleanup path (`staff.service.ts:80-106`)
- ❌ Leave approval workflow reflected in availability (see M1 gap above — they're the same underlying issue)
- ❌ Room/equipment conflict detection (see M1)
- ❌ Shift-planner calendar UI (drag-to-assign)

#### M9 — Home Visit Manager
- 🎭 **Entirely a UI mockup.** `visits/page.tsx`: 1 real fetch call against 4 hardcoded arrays. No `HomeVisit` (or similarly named) table exists anywhere in the schema, despite `Docs/TODO.md:291` claiming otherwise. No geo/address-validation, no status tracking that persists, no assignment logic.

#### M10 — Analytics & Reporting
- 🎭 **Entirely a UI mockup.** `analytics/page.tsx`: zero fetch calls, 8 hardcoded const arrays driving the charts. No `apps/api/src/modules/analytics` exists. Every number on that dashboard right now is fictional.
- The Financeiro Overview tab built this session (`ResumoTab.tsx`) is the one piece of *real*, live-data analytics anywhere in the app — worth treating as the template for what M10 should actually look like, rather than building M10 from scratch later.

### Phase 4 — Growth
- ❌ Patient self-service portal — no login path exists; `Patient` has no `keycloakId`. One isolated, unreachable enforcement check exists in `documents.controller.ts:24-33` (checks `user.patient_id`) with nothing upstream that could ever produce such a JWT.
- ❌ Corporate HR portal — `corporate_hr` is a valid `StaffRole` enum value and appears in a couple of role lists, but no company-scoped data isolation (`WHERE company_id = :user.company_id`, per `ROLES-PERMISSIONS.md` §4.2) exists anywhere in the actual query code I reviewed.
- ❌ Vinti4 payment gateway
- ❌ DICOM viewer — plausibly **out of scope permanently** now that the client is a psychology clinic rather than one doing ultrasound/ECG imaging; worth explicitly cutting from the roadmap rather than carrying it forward as a stale requirement.

---

## 4. Code Quality & Best Practices

### 4.1 — The `Field` label component is reimplemented nine times
```
apps/web/app/(app)/appointments/new/page.tsx
apps/web/app/(app)/exams/page.tsx
apps/web/app/(app)/health-plans/page.tsx
apps/web/app/(app)/patients/new/page.tsx
apps/web/app/(app)/patients/page.tsx
apps/web/app/(app)/patients/[id]/edit/page.tsx
apps/web/app/(app)/records/page.tsx
apps/web/app/(app)/staff/page.tsx        (as FieldRow)
apps/web/app/(app)/visits/page.tsx
```
Same ~15-line label+error wrapper, copy-pasted nine times with drifting prop signatures (some take `error`, some take `hint`, one's named differently). This isn't just duplication for its own sake — it has already caused a real bug to exist in multiple places at once: `PLAN.md:174` records a fix ("Field component changed to implicit `<label>` wrapper so `getByLabel()` works") that was applied to *one* of these files and evidently never propagated to the other eight. `patients/page.tsx:45-57`'s copy still has the unfixed version — `<label>` and its input are siblings, not nested, so the label/input association isn't reliable for either accessibility tooling or `testing-library`'s `getByLabel`. `settings/page.tsx` does the right thing here, importing a shared `Field` from `components/settings/shared` — that pattern should be the one true version, in a shared, non-settings-specific location (e.g. `components/ui/field.tsx`), and the other nine should import it.

### 4.2 — No debounce on any search input
`grep -rl "debounce|useDeferredValue" apps/web/app` returns nothing. `patients/page.tsx:489` fires a full network request on every keystroke via the `useQuery` key including `search` directly. Cheap, contained fix (`use-debounce` or a manual `setTimeout`), worth doing once and applying everywhere search exists.

### 4.3 — The global Zod validation pipe is a no-op
**File:** `apps/api/src/common/pipes/zod-validation.pipe.ts:8-9`, registered at `main.ts:22`
```ts
transform(value: unknown) {
  if (!this.schema) return value;   // main.ts registers it with no schema
```
`app.useGlobalPipes(new ZodValidationPipe())` looks like blanket protection when skimming `main.ts`, but with no schema argument it does nothing on every request — the pipe is a no-op unless a controller *also* explicitly wraps its own `@Body()`/`@Query()` with `new ZodValidationPipe(SomeSchema)`. Every endpoint I checked does that correctly, but the global registration is misleading dead weight that gives false confidence to the next person reading `main.ts`. Either remove it, or make it genuinely global (e.g. a decorator-driven per-route schema lookup).

### 4.4 — Uneven use of NestJS `Logger`
Several places (`appointments.service.ts:223`) use raw `console.error` instead of NestJS's injectable `Logger`, which would give consistent formatting, log levels, and eventual Sentry/observability integration for free. Minor, but worth standardizing while the codebase is still small enough to do it in one pass.

### 4.5 — Test coverage: 7 of 14 API modules have zero unit tests
```
Has specs:    appointments, billing, efatura (×2), financeiro, patients, settings
No specs at all: bff, companies, documents, health-plans, notifications, parametrizacao, public, services, staff
```
`staff.service.ts` in particular has real business logic worth covering (the partial-failure invitation flow flagged in §3 M8). One `e2e` spec exists (`booking-flow.spec.ts`) covering a single happy path; nothing covers Financeiro, health-plans, or any error/edge-case scenario end-to-end.

### 4.6 — Positive findings worth naming
- No `window.confirm()` anywhere — every destructive action uses an in-app two-step confirmation UI, which is the right call and consistently applied.
- The Redis-backed slot lock in `appointments.service.ts` is a genuinely good pattern, not something I'd expect in a fast-moving internal tool — most implementations at this stage skip concurrency handling entirely.
- `R2Service.isConfigured()` fallbacks (billing receipts, this session's expense receipts) mean the app never hard-fails in dev just because cloud storage credentials aren't set — good pragmatic resilience.
- `GoneException` (410) for expired invitation tokens in `staff.service.ts:83` is the *correct* HTTP semantic where most implementations would lazily reach for a generic 400 or 404.
- The Financeiro module built this session followed every established convention in the codebase correctly (Zod schemas in `@cap/types`, repository/service/controller split, `ZodValidationPipe`, `@Roles`) and shipped with real test coverage — it's the newest code in the app and it's also the most consistent with its own conventions.

---

## 5. UX/UI Findings

### 5.1 — Form validation gaps that will produce bad data over time
- **DOB field** (`patients/page.tsx:95-97`) has no `max` attribute — a future date of birth is accepted client-side with no pushback, inconsistent with the *same file's* `PlanModal`, which correctly caps `startDate` at today (`patients/page.tsx:379`).
- **NIF field** — no format hint, no pattern, accepts anything.
- **Phone field** — placeholder shows the correct format (`+2389912345`) but nothing enforces it; combined with the normalization bug in §3 M2, malformed numbers silently enter the system and will fail silently at WhatsApp-send time, whenever that integration exists.

### 5.2 — Status/state indicated by color alone in places
Badge components (invoice status, expense status, e-fatura status) pair color with a text label consistently, which is good — I did not find a pure color-only indicator. Flagging as verified-fine rather than skipping it.

### 5.3 — Loading/error/empty states are consistently handled
Every list page reviewed (patients, faturas, despesas, entradas) has a real skeleton loading state, a distinct error state, and a distinct "nothing found" empty state with contextual copy (different message when a search filter is active vs. truly empty). This is a genuinely consistent, well-executed pattern across the whole app — worth naming as a strength, not just an absence of complaints.

### 5.4 — The sidebar makes no distinction between real and mock features
This is the UX finding I'd weight highest. "Registos Clínicos," "Visitas Domiciliárias," "Analytics," and "WhatsApp Hub" sit in the sidebar with the exact same visual weight as "Financeiro" and "Pacientes CRM." A staff member has no way to know, without clicking in and testing, that three of those four don't save anything they type. At minimum, this deserves a "Beta" or "Em breve" (coming soon) badge until the backend exists — the current presentation actively misleads.

### 5.5 — Design consistency
Card styling (`bg-white rounded-[16px] border ... shadow-[...]`), the brand color scale, and typography scale are applied consistently across every page I read, including the code built this session — there's a real, if informal, design system here and it's being followed, not just declared. No inline-style drift, no ad-hoc color values outside the Tailwind `brand`/`dim` scales, in anything I reviewed.

---

## 6. Redesign Suggestions

Scoped to "how would I build the next version of this," since that was explicitly invited. Not a request to implement any of it now.

1. **Rewrite the PRD around CAP, not the old medical-clinic client.** Cardiology/Dental/ICD-10/DICOM should come out; therapy-session structure, session notes, treatment-plan tracking, and consent flows specific to mental-health data should go in. This is a half-day documentation task that would make every subsequent planning decision (starting with M7's actual shape) land correctly the first time instead of resuming a spec that no longer describes the business.

2. **Invert the auth-bypass default** (§1.1) and add a startup-time loud warning (not just a log line — something that's impossible to miss) whenever the app boots with bypass active, so it's never silently true in an environment nobody meant it to be true in.

3. **Consolidate the money-moving write paths behind `prisma.$transaction`** — invoice creation + E-Fatura submission record, payment recording + status update, expense approval + summary invalidation. None of these need to be fast; they need to be atomic. This closes §1.6 and the E-Fatura orphan-record risk in §1.3's neighborhood at the same time.

4. **One shared `Field` component, one shared `useDebouncedSearch` hook.** Both are small, both are used in nine-plus places, both would pay for themselves the next time either needs a fix.

5. **Give the mock modules (WhatsApp, Records, Visits, Analytics) an honest "Beta" treatment** in the sidebar *now*, independent of when they get built for real — this is a one-line change per nav item and immediately fixes §5.4.

6. **Build M10 (Analytics) as a generalization of what `ResumoTab.tsx` already does**, rather than from scratch — same aggregation pattern (Prisma `groupBy`/`aggregate` over a date range), same `recharts` presentation, extended to appointments/patients/no-show data instead of only money.

7. **If a patient portal is ever actually wanted**, it needs `Patient.keycloakId` (or equivalent) added to the schema before anything else — right now there is structurally no way to link a login to a patient record, which is why the one isolation check that exists (`documents.controller.ts`) can never fire.

---

## 7. What I did not review

In the interest of an honest scope statement: I did not run the app end-to-end for this pass (typecheck/tests were already green from this session's earlier work and I didn't re-verify them here), did not review `apps/mobile` (explicitly a Phase 2+ placeholder), did not audit every line of every ~600–1200-line frontend page (`dashboard`, `parametrizacoes`, `staff`, `health-plans` were spot-checked via grep for known patterns rather than read in full), and did not attempt to verify infrastructure-level claims (VPC isolation, disk encryption, K8s manifests) since none of that exists as reviewable code in this repo yet.

---

## 8. Summary Checklist

- [x] Phase 1 — M1 Appointments: core booking loop works and is well-engineered; business-hours/holiday/leave gaps in availability calc
- [x] Phase 1 — M2 Patients: solid CRUD; phone normalization and consent-path gaps need fixing
- [x] Phase 1 — M6 Billing/Financeiro: strongest module in the app; needs price-floor and payment-idempotency hardening
- [ ] Phase 2 — M3 WhatsApp: mockup only, no backend
- [x] Phase 2 — M4 Health Plans: functional; plan-number race and no utilization tracking
- [ ] Phase 2 — M5 Exams: stub model, no result storage, mostly mock UI
- [ ] Phase 3 — M7 Clinical Records: mockup only, no backend, spec itself needs rewriting for a psych clinic
- [x] Phase 3 — M8 Staff Scheduler: functional; invitation flow not transactional, no room-conflict detection
- [ ] Phase 3 — M9 Home Visits: mockup only, no backend
- [ ] Phase 3 — M10 Analytics: mockup only, no backend
- [ ] Phase 4 — everything: not started, no schema support for a patient-facing login
- [x] Security — field encryption: **fixed for `nif`** (AES-256-GCM + blind-index hash, all read sites patched). DOB: checked — nothing server-side currently ranges/sorts on it, so no blocker found; still open pending a go-ahead
- [x] Security — MFA: **fixed for new accounts** (CONFIGURE_TOTP required on create for admin/doctor/corporate_hr); existing accounts need a one-time realm-admin action against a real (not local-dev) Keycloak, which doesn't exist yet
- [x] Security — auth-bypass default posture: **fixed** — now fails safe, needs explicit `AUTH_BYPASS=true`
- [x] Security — audit logging: **fully fixed** — silent-failure logging, targeted view-logging for patient records, and before/after diffing (Patients + Financeiro) via a `RequestContext`-based diff slot, live-verified against the real `audit_log` table
- [x] Security — invoice price overrides: **fully fixed** — visibility (logged when price ≠ catalogue) plus an admin-only RBAC gate on who can override
- [x] Security — payment/booking race conditions: **fully fixed** — atomic transactions, multi-bucket slot locking, and client-supplied idempotency keys end to end (schema, backend, all 4 frontend submission points), live-verified: duplicate submissions produce exactly one DB row
- [x] Security — public endpoint rate limiting: **fixed**, live-verified (60×200 then 429s)
- [x] Testing — 7/14 API modules covered originally; now also covers `common/guards`, `common/interceptors`, `common/context`, `common/services`, plus new repository-level specs for patients/billing

**Section 1 (Critical Findings) — all 7 items fully addressed**, including every "deliberately left out" follow-up except DOB encryption (open, pending confirmation) and MFA retroactive enforcement (blocked on a real Keycloak deployment existing). 166 API tests passing (was 106 at session start), typecheck clean on both apps, every fix live-verified against the running dev stack — not just Jest mocks. Next: Section 2 (Privacy & Compliance) — largely overlapping with what's now fixed, remaining gap is mainly the `findOrCreateByPhone` consent bypass.
