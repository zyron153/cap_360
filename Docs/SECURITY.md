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
- ✅ **Password policy:** min 10 chars, 1 uppercase, 1 digit (`ChangePasswordSchema`/
  `ResetPasswordSchema`/`ActivateInvitationSchema`, enforced by Zod)
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

## 4. Encryption

### 4.1 Data at Rest

| Data | Encryption |
|---|---|
| PostgreSQL database | AES-256 via Hetzner/AWS volume encryption |
| Redis cache | In-memory only; no sensitive data persisted to disk beyond session |
| R2 file storage | AES-256 server-side encryption (Cloudflare R2 default) |
| Backup files | AES-256 encrypted before upload to S3/R2 |

### 4.2 Data in Transit

- All external communications: TLS 1.3
- Internal service-to-service (within K8s cluster): mutual TLS (mTLS) enforced via service mesh (Linkerd or Istio)
- Database connections: `sslmode=require` in PostgreSQL connection string
- Redis: TLS enabled; auth password required

### 4.3 Sensitive Fields

The following fields are encrypted at the application layer (in addition to disk encryption) using AES-256-GCM before storage:

- ✅ `patients.nif` — with a separate HMAC-SHA256 blind-index column for exact-match lookup, since AES-GCM ciphertext isn't searchable
- ✅ `patients.dateOfBirth`
- ❌ `clinical_notes.*`, `prescriptions.*` — not applicable yet: these tables don't exist (M7 is a UI mockup with no backend; see `DATABASE-SCHEMA.md` §8)

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
| WhatsApp webhook | 1000 req/min | No IP limit (Meta IPs whitelisted) | ❌ Not applicable — no WhatsApp webhook exists (M3 is a UI mockup) |

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

NGINX enforces:
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
| Clinical note / prescription created | ❌ Not applicable — these tables don't exist (M7 mockup) |
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

❌ **Entirely not applicable today.** M3 (WhatsApp Integration Hub) has no backend at all — no
webhook handler, no bot, no agent inbox (see `DATABASE-SCHEMA.md` §10). Outbound WhatsApp sending
exists only for appointment reminders/confirmations (`NotificationsProcessor.sendWhatsApp`),
which calls the Meta Cloud API directly with plain text bodies — no template management, no 24h-
window handling.

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
- SSH access to servers via key pairs only (no password auth)
- Automatic OS security patches enabled
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
