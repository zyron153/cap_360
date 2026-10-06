# CAP 360 — Security & Compliance

> **Version:** 1.1 · **Date:** August 2026
> Healthcare data security requirements for Cabo Verde context, with LGPD (Brazil) as compliance reference.
> This document states the **target** security posture; inline notes mark what's actually
> implemented today vs. still planned. See `REVIEW.md` for the full audit this pass is based on.

---

## 1. Threat Model

| Threat | Likelihood | Impact | Primary Control |
|---|---|---|---|
| Unauthorised access to clinical records | Medium | Critical | RBAC + MFA + audit log |
| Patient data breach (DB exfiltration) | Low | Critical | Encryption at rest + VPC isolation |
| WhatsApp message interception | Low | High | TLS in transit; end-to-end via Meta |
| Exam result link abuse | Medium | High | Token expiry (72h) + access logging — ❌ not applicable yet: M5 has no result-file field or download endpoint at all |
| Brute-force login | Medium | Medium | Per-account Redis lockout + per-IP rate limiting — ✅ real, see §2.1 |
| SQL injection | Low | Critical | Prisma parameterised queries; no raw SQL |
| Insider threat (staff) | Low | High | Audit log; RBAC; role-minimum access |
| Account takeover | Low | High | MFA for admin/doctor; TOTP |

---

## 2. Authentication

> **2026-08-31: Keycloak has been removed entirely**, replaced with a self-hosted, staff-only
> auth system (no external identity provider of any kind). Everything below in §2 describes the
> real, current system, not a target — this is one of the few sections of this document where
> "target" and "actual" are now the same thing.

### 2.1 Password & Session

- ✅ **Password hashing:** argon2id (`PasswordService`, via the `argon2` npm package's native
  binding) — no plaintext or reversibly-encrypted password is ever stored
- ✅ **Password policy:** min 10 chars, 1 uppercase, 1 digit (`PasswordSchema` in
  `packages/types/src/auth.ts`, shared by `ChangePasswordSchema`, `ResetPasswordSchema` and the admin
  routes, enforced by Zod; the web UI mirrors it to show the rules up front)
- ✅ **Admin-set passwords (no email invitations):** an admin chooses a user's password when creating
  the account (`POST /staff`) and can change it later (`PATCH /staff/:id/password`, "Alterar senha").
  Only the argon2id hash is stored; the plaintext exists only in the request body (the audit
  interceptor records method/URL, not bodies) — the API never returns or generates passwords, and the
  "Gerar" button creates one in the browser with `crypto.getRandomValues`. An admin password change ends
  **all of that user's open sessions** (`SessionService.destroyAllForStaff`; the admin's own session is
  spared when they change their own password), so a compromised old password or a stolen session stops
  working immediately. Trade-offs: there is no forced change on first login, so the admin knows the
  user's initial password until the user changes it themselves (Settings → Alterar Palavra-passe or
  the forgot-password email); and the self-service change / email reset don't end other sessions. The
  dev `AUTH_BYPASS` only applies when there is no valid session (a real login cookie always wins)
- ✅ **Brute-force protection, real and two-layered:**
  - Per-IP: `POST /auth/login` and `POST /auth/forgot-password` are throttled to 5 req/min
    (stricter than the global 300/min default) via `@nestjs/throttler`
  - Per-account: a Redis counter (`login:fail:<email>`) locks the account for 15 minutes after 5
    failed attempts within a 15-minute window (`SessionService.recordFailure`/`isLocked`) —
    independent of the IP a request comes from
  - A login attempt against an unknown email still runs a real argon2 verify (against a fixed
    dummy hash) before rejecting, so response timing can't reveal whether the account exists
- ✅ **Session timeout:** 8 hours, sliding — every authenticated request that resolves a valid
  session extends its Redis TTL by another 8 hours (`SessionService.get`)
- ❌ No refresh-token rotation — there's no token to rotate; sessions are a single opaque
  server-side identifier, revoked instantly by deleting the Redis key (logout, or a future
  "revoke all sessions" feature that doesn't exist yet)

### 2.2 Session Cookies

- ✅ **Cookie:** `cap_session`, an opaque random 32-byte (64 hex char) id — nothing about the
  staff member is derivable from the cookie value itself, unlike a JWT
- ✅ **Flags:** `httpOnly` (not readable from JS — mitigates XSS token theft), `Secure` (HTTPS-only
  in production; disabled in dev since local HTTP has no TLS), `SameSite=Lax` (sent on top-level
  navigation, not on cross-site subresource/XHR requests — CSRF-resistant for this app's
  same-origin, rewrite-proxied request pattern)
- ✅ **Session data:** Redis only (`session:<id>` → `{ staffId, email, roles }`), never Postgres —
  see `DATABASE-SCHEMA.md`
- 🟡 **Single session per login, no multi-device tracking:** logging in elsewhere doesn't revoke
  other sessions, and there's no "sessions" list a user can review/revoke individually (the
  Settings page's Security tab says as much rather than pointing at a nonexistent portal)

### 2.3 Multi-Factor Authentication (MFA)

❌ **Not implemented at all.** The table below is the *original design's* target — it required a
Keycloak-specific mechanism (`requiredActions: ["CONFIGURE_TOTP"]`) that no longer exists, and no
replacement (custom TOTP, WebAuthn, etc.) has been built. Treat every row as aspirational.

| Role | Requirement | Method |
|---|---|---|
| admin | Mandatory | TOTP (Google Authenticator / Authy) |
| doctor | Mandatory | TOTP |
| receptionist | Recommended | TOTP |
| nurse / lab_tech | Recommended | TOTP |
| patient | Optional | SMS OTP |
| corporate_hr | Mandatory | TOTP |

---

## 3. Authorisation (RBAC)

- All API routes decorated with `@Roles(...)` guard in NestJS
- Roles come from the Redis session (`SessionService`), captured once at login time — not
  re-queried from Postgres per request. A role change takes effect on that staff member's next
  login, not immediately (no live session-role refresh exists)
- Resource-level isolation enforced in service layer (not just route level)
- 🟡 The one implemented "admin override" today — billing an invoice line item at a price other
  than the service catalogue price — is admin-only and visible via a server `Logger.warn`, not a
  dedicated `is_admin_override: true` field in `audit_log` (the request is still captured as a
  normal audited mutation, just without that specific flag)

See `ROLES-PERMISSIONS.md` for full permission matrix.

---

### 3.1 Clinical-note access (M7)

Notes are **author-only** — a doctor reads and edits only what they wrote; admin reads and edits all;
nurse/receptionist/lab_tech/corporate_hr have no access (see `modules/M7-clinical-records-emr.md` §3).
One deliberate, narrow exception (decided 2026-10-05, for a doctor covering a colleague): while a patient
is **in treatment today** (an appointment today that is `checked_in` or `completed`, put there by someone
*other than the reader*), any doctor may *read* the other authors' **finalized** notes for that patient —
read-only, never drafts, lapsing at the end of the Cabo Verde day, and every such read is audit-marked.
The appointment records who checked the patient in and who completed it (`checkedInByStaffId` /
`completedByStaffId`), so a doctor can't unlock a patient's notes by booking and checking them in
themself. Residual weakness: a second person (reception or a colleague) doing that check-in still opens it
— bounded to a day and audited; a stricter owner/admin-granted share was offered and not chosen.

**The exception is reviewable.** `GET /clinical-notes/access-log` (admin only; a doctor gets 403) lists every
cross-author read, newest first — who read, which patient, how many notes or which note and author — built from
the audit marks. Verified against real doctor sessions (integration spec
`clinical-note-discard-and-access-log`): doctor B reading doctor A's notes while the admin had checked the
patient in produces exactly the list-read and by-id-read rows; A's reads of their own notes and the admin's
reads produce none.

**A hole closed (2026-10-06): appending a query string voided the audit row.** `AuditInterceptor` took
`resource`/`resourceId` from the raw URL, so `GET /clinical-notes/<id>?x=…` overflowed `resourceId`
(`VarChar(36)`), the insert failed (logged and swallowed — audit failures never break a request) and a
cross-author read left no trace. The interceptor now uses the path only (the full URL stays in `metadata.url`)
and truncates to the column widths. Regression-tested (unit, and live through the access log).

**Writes.** A doctor may discard only their own **draft** (admin: any draft); a finalized note is never
deletable, and neither is a draft that a prescription or referral refers to (the foreign keys are
`ON DELETE RESTRICT`, so the database refuses too). A prescription/referral may reference only the caller's
own note for that patient; an internal referral may only be addressed to an active doctor/admin other than
the referrer. Not-yours is a 404 everywhere; an unresolvable reference inside a body is one generic 400.

## 4. Encryption

### 4.1 Data at Rest

| Data | Encryption |
|---|---|
| PostgreSQL database | Sensitive columns are AES-256-GCM encrypted by the app (`FIELD_ENCRYPTION_KEY`). 🟡 No volume-level encryption is configured on the Hostinger VPS (not verified) |
| Redis cache | In-memory only; no sensitive data persisted to disk beyond session |
| R2 file storage | AES-256 server-side encryption (Cloudflare R2 default) |
| Backup files | 🟡 Today: gzip dumps in `backups/` on the VPS (dir 700, files 600), **not encrypted and not off-server**. Plan: encrypt before upload to B2/S3/R2 |

### 4.2 Data in Transit

- All external communications: TLS 1.2/1.3 (Let's Encrypt cert on nginx; plain HTTP for the domain redirects to HTTPS)
- Internal service-to-service: ❌ no K8s/mTLS; the Compose network is private (only nginx publishes host ports)
- Database connections: 🟡 no `sslmode` set — plain TCP inside the private Compose network
- Redis: 🟡 no TLS and no password; reachable only on the private Compose network

### 4.3 Sensitive Fields

The following fields are encrypted at the application layer (in addition to disk encryption) using AES-256-GCM before storage:

- ✅ `patients.nif` — with a separate HMAC-SHA256 blind-index column for exact-match lookup, since AES-GCM ciphertext isn't searchable
- ✅ `patients.dateOfBirth`
- ✅ `clinical_notes.presentingConcerns/observations/assessment/plan/riskNotes` and `prescriptions.notes`,
  `prescription_items.drugName/dosage/frequency/instructions` — encrypted on every write and decrypted on every
  read in `ClinicalRecordsRepository` (no blind index: nothing searches clinical text). Structured metadata
  (`riskLevel`, `sessionType`, `durationMinutes`, dates, ids) is plaintext on purpose so lists can filter and
  order in SQL.
- ❌ `referrals.reason` (free text, up to 1000 chars) is **not** encrypted — it can carry clinical content
  ("needs psychiatric review for …"). A deliberate, documented scope decision of the original M7 build; flagged
  for the owner to revisit (it needs an in-place re-encryption migration of existing rows). See
  `modules/M7-clinical-records-emr.md` §4.

Encryption is `EncryptionService` (Node's built-in `crypto`, AES-256-GCM, format
`ivHex:authTagHex:dataHex`). **Key management does not match this section's target**: the key is
read from the `FIELD_ENCRYPTION_KEY` environment variable, not HashiCorp Vault — no Vault
deployment exists in this stack. Rotate/secure it the same way other secrets in `.env` are
handled until a real secrets manager is in place.

---

## 5. API Security

### 5.1 Rate Limiting

| Endpoint Group | Limit | Tool | Status |
|---|---|---|---|
| Everything (global default) | 300 req/min per IP | `@nestjs/throttler`, in-memory storage | ✅ Enforced |
| Public (booking widget) | 60 req/min per IP | Same, `@Throttle` override | ✅ Enforced |
| Auth endpoints (`/auth/login`, `/auth/forgot-password`) | 5 req/min per IP | `@Throttle` override | ✅ Enforced, plus a separate per-account Redis lockout independent of IP — see §2.1 |
| WhatsApp webhook | 1000 req/min | No IP limit (Meta IPs whitelisted) | ⚠️ Webhook exists (`POST /whatsapp/webhook`), throttled at 600 req/min; no IP allowlist — the HMAC signature is the authentication |

Rate limiting is per-IP, in-memory, and per-process — it resets on restart and doesn't share state
across multiple API instances. Fine for a single dev/staging instance; revisit (Redis-backed
storage) before running more than one API replica in production.

### 5.2 Input Validation

- All request bodies validated via `class-validator` DTOs in NestJS
- Prisma parameterised queries for all DB operations (no raw SQL)
- File uploads: MIME type validation server-side; virus scan via ClamAV on upload

### 5.3 CORS

- Allowed origins: configured via the `ALLOWED_ORIGINS` env var (comma-separated), defaulting to
  `http://localhost:3000` in dev. No production domain is hardcoded anywhere — set
  `ALLOWED_ORIGINS` per environment when a real domain exists (the `maissaudecv.com` domain from
  the original design predates the CAP rebrand and was never actually wired in).
- Credentials: true

### 5.4 HTTPS & Headers

🟡 What `infra/nginx/tls.conf.example` actually sets today: HSTS `max-age=63072000` (no `includeSubDomains`), `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy no-referrer-when-downgrade`; **no CSP yet**. The block below is the target.

NGINX should enforce:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "default-src 'self'; ..." always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;
```

---

## 6. Audit Logging

Every mutating request (and any GET route explicitly marked `@AuditView()`) is written to
`audit_log` at the HTTP-request level — one row per request, with `action` = HTTP method and
`resource`/`resourceId` from the route, not the original design's one-row-per-DB-change shape:

| Action Type | Status |
|---|---|
| Patient record viewed | ✅ Two routes: `GET /patients/:id` and `GET /patients/:id/timeline`, via `@AuditView()`. Not every read is logged — only these, deliberately, to avoid auditing every list/search query |
| Patients + Financeiro mutations get a before/after diff | ✅ `metadata.diff: { before, after }`, only the fields actually submitted — not a full-record dump |
| Clinical note / prescription created or edited | ✅ Generic mutating-request rows (`POST`/`PATCH` on `clinical-notes`, `prescriptions`, …). Note reads (`GET /patients/:id/clinical-notes`, `/clinical-notes`, `/clinical-notes/:id`) are `@AuditView()`; a read that returns **another clinician's** notes (see §3.1) also records `metadata.diff.after = { basis: "patient in treatment today", … }` |
| Cross-author clinical-note reads reviewable | ✅ `GET /clinical-notes/access-log` (admin only) over the marks above — see §3.1. `resource`/`resourceId` are the route path only (the query string used to leak into them and could void the row); the full URL is in `metadata.url` |
| Clinical draft discarded | ✅ `DELETE /clinical-notes/:id` is a mutating request, so it is audited; the row's `metadata.diff.before = { patientId, authorStaffId, appointmentId, createdAt }` records whose draft it was (never its text) |
| Denied attempts (404/403) at clinical notes | ❌ Not audited — the interceptor only logs requests that succeed, so a doctor probing a colleague's note id leaves nothing (ids are UUIDs, so this is probing-by-guess, not enumeration). Logging failed attempts would change the volume of `audit_log` for every route; left as an owner decision |
| `metadata.url` keeps the query string | 🟡 Search terms typed into `GET /clinical-notes?q=…` (a patient name) are stored in `audit_log` as part of the URL. The table is admin-only and append-only, but it is PII the "erase a patient" flow does not reach |
| Admin role escalation | ❌ Not implemented as a distinct action |
| Login success/failure | 🟡 Real, but low-value: `POST /auth/*` is a mutating request, so it hits the generic audit interceptor like any other route — but only on success. A **successful** login/logout/forgot-password writes a row (`resource: "auth", resourceId: "login"/"logout"/"forgot-password"`), verified live. A **failed** login (wrong password, locked account) writes **nothing** — the interceptor's `tap()` only fires on the success channel, and a rejected login throws. Even the successful rows carry no actor (`actorId`/`actorEmail` are empty — `request.user` is never set for `@Public()` routes). Genuinely capturing login attempts (especially failures, which matter most for security monitoring) would need a dedicated write inside `AuthService`, not a side-effect of the generic interceptor |
| File downloaded (exam result) | ❌ Not applicable — no exam-result download exists yet |
| Invoice created/modified | 🟡 Creation and cancellation are logged as generic mutating requests; no line-item delta beyond that |
| Patient record deleted (erasure) | ✅ Logged as the mutating `DELETE /patients/:id` request |

Audit logs are:
- ✅ **Genuinely append-only at the database level**, not just application convention: a
  `BEFORE UPDATE OR DELETE` trigger rejects any modification, enforced even against the app's own
  Postgres role (which is a superuser and would otherwise bypass a plain `REVOKE`). See
  `packages/database/prisma/manual-sql/audit-log-immutable.sql` — not reapplied by
  `prisma db push`/`migrate`, so it must be re-run by hand on any fresh database.
- ❌ Retention for 7 years — not implemented; no partitioning or purge policy exists
- ❌ Exportable for compliance audits — no export endpoint exists; would currently mean a direct DB query

---

## 7. Patient Data Privacy (LGPD-aligned)

### 7.1 Consent

- 🟡 **Simpler than this section's target**: consent is a single `consentGiven` boolean + optional
  `consentGivenAt` timestamp on the patient record — not a signed document, no purpose/version
  fields, no separation between data-processing/marketing/sharing consent.
- ✅ The value is real everywhere it's collected: the reception "New Patient" form requires the
  checkbox, and the public self-service booking flow (`findOrCreateByPhone`) requires the same
  literal-`true` `consentGiven` field on `PublicBookingSchema` — it no longer silently assumes
  consent on that path (previously hardcoded `true` regardless of what the caller sent).

### 7.2 Data Subject Rights

| Right | Implementation |
|---|---|
| Right to access | ❌ Not implemented — no export endpoint exists |
| Right to rectification | 🟡 `PATCH /patients/:id` lets staff correct any field; no patient-initiated request flow |
| Right to erasure | ✅ Soft-delete nulls every direct-PII field (not just `deletedAt`); billing/appointment records retained. Live-verified against the real database |
| Right to portability | ❌ Not implemented — same gap as "right to access" |
| Right to withdraw consent | ❌ Not implemented as a distinct flow — `consentGiven` can be set to `false` via `PATCH`, but nothing downstream (reminders, communications) currently checks it before sending |

### 7.3 Data Minimisation

- Only collect data necessary for clinical care and billing
- `nif` is optional; there is no `nationality` field at all (never implemented)
- Booking `source` (web/whatsapp/phone/walk_in) is stored per-appointment, not anonymised anywhere in reporting — there is no analytics module yet for this to flow into (M10 is a mockup)

---

## 8. WhatsApp Security

✅ **Phase 1 inbox (2026-09-19)** — see `modules/M3-whatsapp-integration.md`:
- Inbound webhook is `@Public()`, authenticated only by Meta's `X-Hub-Signature-256` HMAC of the raw
  body (constant-time compare, **fails closed** when the app secret isn't configured). The GET verify
  handshake checks the verify token the same way. Secrets live in the `integration_whatsapp`
  setting and are masked in `GET /settings`.
- Message bodies are AES-256-GCM encrypted at rest; `communication_log` gets only "a message was
  received", never the text. Thread reads are audited (`@AuditView`).
- The Socket.io `/whatsapp` namespace is unauthenticated (same as the calendar one), so it only ever
  emits a conversation id; content is fetched through the authenticated REST API.
- Right to erasure: soft-deleting a patient deletes their conversations and messages.
- Free-text replies are refused outside Meta's 24h window.

⚠️ Still open: reminders and confirmations (`NotificationsProcessor`) send plain text, not
Meta-approved templates, so they only deliver inside the 24h window; no bot, no SLA tracking.

---

## 9. File Security

- ✅ Files stored in Cloudflare R2, presigned server-generated download URLs (`R2Service`) —
  matches this section for the one place file storage is actually used today (billing receipts,
  expense receipts)
- 🟡 Patient-facing 72-hour signed URLs — not applicable yet, since there's no patient-facing
  download flow (right to portability isn't implemented; exam results don't exist)
- ❌ File access logged in `audit_log` — not implemented; R2 downloads aren't currently audited
- There is a download-URL endpoint for `PatientDocument` but **no upload endpoint** — nothing in
  the running app can populate that table via the API today

---

## 10. Infrastructure Security

- PostgreSQL accessible only from within the private VPC (not publicly exposed)
- Redis accessible only from within the private VPC — now holds real security-sensitive state
  (sessions, login-lockout counters, password-reset tokens), not just job queues and slot locks
- SSH access to servers via key pairs only (no password auth) — ✅ on the VPS since 2026-10-03: password auth off, root `prohibit-password`, day-to-day work as the non-root `deploy` user (note: the `docker` group is root-equivalent)
- Automatic OS security patches enabled — ✅ `unattended-upgrades`
- ✅ ufw allows only 22, 80, 443, 8080, 8443 (staging); fail2ban on SSH; only nginx publishes container ports
- ✅ Secrets: `.env.prod` is mode 600 on the VPS and never in git; CI uses environment-scoped GitHub secrets, one SSH key per environment, and the `PRODUCTION` environment requires a reviewer and only deploys from `prod`
- 🟡 The GitHub repo is **public** and `Docs/VPS_CONFIG.md` lists the VPS IP and layout — decide: private repo (loses the required-reviewer gate on GitHub Free) or move that file out of git
- Docker images: non-root user; read-only filesystem where possible
- Dependency scanning via Snyk or GitHub Dependabot on CI/CD

---

## 11. Incident Response

1. Detect — Sentry alert or Grafana anomaly triggers PagerDuty notification
2. Contain — Revoke compromised tokens; block IPs; take affected service offline if needed
3. Assess — Review audit logs; determine scope
4. Notify — Inform clinic management within 1 hour; patients within 72 hours if data exposed
5. Remediate — Patch, rotate credentials, deploy fix
6. Post-mortem — Document timeline, root cause, and prevention measures

See also: Cabo Verde data protection authority notification requirements (consult local legal counsel).

---

*CAP 360 · Security & Compliance v1.2 · updated 2026-08-31 — Keycloak removed, self-hosted auth*

## e-Fatura credentials (DNRE)

- The OAuth client secret, the refresh token, the signing certificate (`.p12`/PEM) and its password
  are stored AES-256-GCM encrypted (`EncryptionService`) in `integration_efatura_secrets`. No endpoint
  returns them — only booleans (`hasClientSecret`, `connected`, `hasCertificate`) and the
  certificate's subject/expiry. `GET /settings` filters both e-Fatura keys out, and
  `PATCH /settings/integration/efatura*` is rejected.
- The platform host is fixed in code (`https://services.efatura.cv`, `https://iam.efatura.cv/...`);
  there is no admin-editable URL, so the server cannot be pointed at an internal address.
- Signed documents are kept encrypted (`efatura_submissions.signedXml`): they contain the patient's
  name and NIF. Error messages shown to staff are our own; raw platform bodies are never stored or logged.
- Only an admin can configure the integration or change the clinic's name/NIF (the emitter of every document).
- The signing key can sign invoices in the clinic's name: protect `FIELD_ENCRYPTION_KEY` and database
  backups accordingly, and revoke/rotate the DNRE credentials if either leaks.
