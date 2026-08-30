# CAP 360 — Database Schema

> **Database:** PostgreSQL 16 · **ORM:** Prisma 6
> All timestamps are `TIMESTAMPTZ` (UTC) unless noted `DATE`. Soft deletes use `deleted_at`.
> **Canonical source is now `packages/database/prisma/schema.prisma`** — this document is a
> human-readable mirror of it, regenerated to match. If the two ever disagree, the Prisma schema
> wins; open an issue/PR to bring this file back in sync.
>
> Column names below are the actual Postgres column names (Prisma's `@map`/table-name mapping
> already applied) — camelCase in the Prisma schema itself, snake_case here to match the DB.

---

## 1. Core Domain Tables

### 1.1 `patients`

```sql
CREATE TABLE patients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "fullName"              VARCHAR(150),                  -- nullable: NULL means erased (right to erasure)
  "dateOfBirth"           VARCHAR(255),                  -- AES-256-GCM ciphertext of "YYYY-MM-DD"; nullable (erasure)
  gender                  VARCHAR(10) NOT NULL,          -- male | female | other
  nif                     VARCHAR(255),                  -- AES-256-GCM ciphertext; nullable
  "nifHash"               VARCHAR(64),                   -- HMAC-SHA256 blind index for exact-match lookup on nif
  phone                   VARCHAR(30),                   -- nullable (erasure) — NULLs don't collide under the unique index
  email                   VARCHAR(150),
  address                 VARCHAR(300),
  "emergencyContactName"  VARCHAR(150),
  "emergencyContactPhone" VARCHAR(30),
  "consentGiven"          BOOLEAN NOT NULL DEFAULT false,
  "consentGivenAt"        TIMESTAMPTZ,
  "healthPlanId"          UUID REFERENCES health_plans(id),
  "deletedAt"             TIMESTAMPTZ,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX ON patients(phone);
CREATE UNIQUE INDEX ON patients("nifHash");
CREATE INDEX ON patients("fullName");
CREATE INDEX ON patients("deletedAt");
```

`nif` and `dateOfBirth` are encrypted at the application layer (`EncryptionService`, AES-256-GCM,
format `ivHex:authTagHex:dataHex`) — the columns are wide `VARCHAR` to hold ciphertext, not the
original `NUMERIC`/`DATE` shape. `nifHash` is a deterministic HMAC-SHA256 blind index used only for
exact-match lookup/uniqueness on the encrypted `nif`; it is never returned by the API.

Right to erasure (`PatientsRepository.softDelete`) nulls `fullName`, `dateOfBirth`, `nif`,
`nifHash`, `phone`, `email`, `address`, `emergencyContactName`, `emergencyContactPhone` — `gender`
and `healthPlanId` are kept (not identifying on their own), as are all related records
(appointments, invoices, notes, documents), for legal/billing retention.

Fields present in the original design but never implemented: `nationality`, `phone_secondary`,
`zone`, `primary_doctor_id`, `photo_url`, `tags`, generic `notes`. Not planned.

### 1.2 `staff`

```sql
CREATE TABLE staff (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "keycloakId"    VARCHAR(36) NOT NULL UNIQUE,
  "fullName"      VARCHAR(150) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  role            VARCHAR(30) NOT NULL,   -- admin | doctor | nurse | receptionist | lab_tech | corporate_hr
  "jobTitle"      VARCHAR(100),
  "specialtyCode" VARCHAR(50),
  phone           VARCHAR(30),
  "deletedAt"     TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON staff(role);
CREATE INDEX ON staff("deletedAt");
```

### 1.3 `staff_invitations`

```sql
CREATE TABLE staff_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           VARCHAR(64) NOT NULL UNIQUE,
  email           VARCHAR(150) NOT NULL,
  "fullName"      VARCHAR(150) NOT NULL,
  role            VARCHAR(30) NOT NULL,
  "jobTitle"      VARCHAR(100),
  "specialtyCode" VARCHAR(50),
  phone           VARCHAR(30),
  availability    JSONB,                  -- proposed weekly StaffAvailability rows, applied on accept
  "invitedBy"     VARCHAR(150),
  "expiresAt"     TIMESTAMPTZ NOT NULL,    -- 7 days from creation
  "acceptedAt"    TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON staff_invitations(email);
CREATE INDEX ON staff_invitations(token);
```

Activation (`StaffService.activateInvitation`) creates the Keycloak user first, then the local
`staff` row; if the local write fails, the just-created Keycloak user is deleted (best-effort) so
a failed activation never leaves an orphaned Keycloak account with no app-side record.

### 1.4 `services`

```sql
CREATE TABLE services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(150) NOT NULL,
  code              VARCHAR(30) NOT NULL UNIQUE,
  description       VARCHAR(500),
  "durationMinutes" INT NOT NULL DEFAULT 30,
  price             NUMERIC(10,2) NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL
);
```

No `category`/`specialty`/`buffer_minutes` columns — those from the original design were never
implemented.

### 1.5 `rooms`

```sql
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  floor       VARCHAR(20),
  capacity    INT NOT NULL DEFAULT 1,
  equipment   JSONB,
  active      BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);
```

---

## 2. Appointment Module (M1)

### 2.1 `appointments`

```sql
CREATE TABLE appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"          UUID NOT NULL REFERENCES patients(id),
  "staffId"            UUID NOT NULL REFERENCES staff(id),
  "serviceId"          UUID NOT NULL REFERENCES services(id),
  "roomId"             UUID REFERENCES rooms(id),
  "scheduledAt"        TIMESTAMPTZ NOT NULL,
  "durationMinutes"    INT NOT NULL DEFAULT 30,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending | confirmed | checked_in | completed | cancelled | no_show
  source               VARCHAR(20) NOT NULL DEFAULT 'web',  -- web | whatsapp | phone | walk_in
  notes                VARCHAR(500),
  "cancellationReason" VARCHAR(300),
  "checkedInAt"        TIMESTAMPTZ,
  "completedAt"        TIMESTAMPTZ,
  "idempotencyKey"     VARCHAR(100) UNIQUE,   -- retried create() replays the original instead of duplicating
  "seriesId"           UUID REFERENCES appointment_series(id),
  "seriesIndex"        INT,                    -- 1-based position within the series, display only
  "deletedAt"          TIMESTAMPTZ,
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON appointments("patientId");
CREATE INDEX ON appointments("staffId");
CREATE INDEX ON appointments("scheduledAt");
CREATE INDEX ON appointments(status);
CREATE INDEX ON appointments("deletedAt");
CREATE INDEX ON appointments("seriesId");
CREATE INDEX ON appointments("patientId", "deletedAt");   -- BFF patient-screen timeline
CREATE INDEX ON appointments("scheduledAt", "deletedAt"); -- calendar range query
```

There is **no DB-level unique/exclusion constraint preventing double-booking** — conflict
detection is enforced at the application layer (`AppointmentsService.create`): a Redis lock per
30-minute grid bucket per staff member (and per room, when one is assigned) serialises concurrent
requests for the same slot, and a `findConfirmedInRange` overlap check rejects a genuine conflict
before the row is written. `getAvailability` shares the same business-hours/holiday/leave/conflict
logic so the booking UI can't offer a slot that then gets rejected on submit.

### 2.2 `appointment_series`

```sql
CREATE TABLE appointment_series (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"       UUID NOT NULL REFERENCES patients(id),
  "staffId"         UUID NOT NULL REFERENCES staff(id),
  "serviceId"       UUID NOT NULL REFERENCES services(id),
  "roomId"          UUID REFERENCES rooms(id),
  frequency         VARCHAR(10) NOT NULL,  -- daily | weekly | monthly
  interval          INT NOT NULL DEFAULT 1,  -- every N [frequency units]
  "endDate"         DATE,                    -- exactly one of endDate / occurrenceCount is set
  "occurrenceCount" INT,                     -- (enforced at the application layer, not the DB)
  "idempotencyKey"  VARCHAR(100) UNIQUE,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

A recurring-booking template, not a scheduling engine of its own: creating one immediately
generates every occurrence as an ordinary row in `appointments` (linked back via `seriesId`), each
going through the exact same booking checks as a manually-created appointment. Generation is
best-effort — an occurrence that fails its own checks (a holiday, a slot taken since) is skipped
and reported back rather than aborting the rest of a multi-month series.

### 2.3 `appointment_reminders`

```sql
CREATE TABLE appointment_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "appointmentId" UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL,    -- whatsapp | sms | email (only whatsapp is actually sent — see M1 module doc)
  "scheduledFor"  TIMESTAMPTZ NOT NULL,
  "bullJobId"     VARCHAR(100),
  "sentAt"        TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON appointment_reminders("appointmentId");
CREATE INDEX ON appointment_reminders("scheduledFor");
```

### 2.4 `waitlist`

```sql
CREATE TABLE waitlist (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"         UUID NOT NULL REFERENCES patients(id),
  "serviceId"         UUID NOT NULL REFERENCES services(id),
  "staffId"           UUID REFERENCES staff(id),
  "preferredDateFrom" DATE,
  "preferredDateTo"   DATE,
  notes               VARCHAR(300),
  status              VARCHAR(20) NOT NULL DEFAULT 'waiting',  -- waiting | notified | booked | expired
  "notifiedAt"        TIMESTAMPTZ,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON waitlist("patientId");
CREATE INDEX ON waitlist("serviceId");
CREATE INDEX ON waitlist(status);
```

---

## 3. Patient CRM Module (M2)

### 3.1 `patient_documents`

```sql
CREATE TABLE patient_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"  UUID NOT NULL REFERENCES patients(id),
  type         VARCHAR(30) NOT NULL,  -- national_id | consent_form | exam_result | prescription | referral | other
  "fileName"   VARCHAR(200) NOT NULL,
  "r2Key"      VARCHAR(300) NOT NULL,
  "mimeType"   VARCHAR(100) NOT NULL,
  "sizeBytes"  INT NOT NULL,
  "uploadedBy" UUID NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON patient_documents("patientId");
```

Only a download-URL endpoint exists today (`GET /documents/:id/download-url`) — there is **no
upload endpoint**, so nothing in the running app can currently populate this table.

### 3.2 `patient_notes`

```sql
CREATE TABLE patient_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId" UUID NOT NULL REFERENCES patients(id),
  content     VARCHAR(2000) NOT NULL,
  "createdBy" UUID REFERENCES staff(id),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON patient_notes("patientId");
```

Generic free-text notes — no `is_private` flag, no SOAP structure. This is not a clinical note
(M7's `ClinicalNote` was never built; see §8).

### 3.3 `communication_log`

```sql
CREATE TABLE communication_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"  UUID NOT NULL REFERENCES patients(id),
  channel      VARCHAR(30) NOT NULL,
  direction    VARCHAR(10) NOT NULL,  -- inbound | outbound
  subject      VARCHAR(200),
  body         TEXT,
  status       VARCHAR(30) NOT NULL,
  "externalId" VARCHAR(100),
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON communication_log("patientId");
CREATE INDEX ON communication_log(channel);
```

---

## 4. Health Plans Module (M4)

### 4.1 `companies`

```sql
CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  "taxId"     VARCHAR(50) NOT NULL UNIQUE,
  email       VARCHAR(150),
  phone       VARCHAR(30),
  address     VARCHAR(300),
  active      BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON companies(active);
```

### 4.2 `health_plan_products`

```sql
CREATE TABLE health_plan_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150) NOT NULL,
  code            VARCHAR(30) NOT NULL UNIQUE,
  description     VARCHAR(500),
  "companyId"     VARCHAR(36) REFERENCES companies(id),  -- NULL = family/individual product
  "monthlyFee"    NUMERIC(10,2) NOT NULL,
  "maxMembers"    INT,
  "coverageRules" JSONB,
  active          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON health_plan_products("companyId");
```

### 4.3 `health_plans` (subscriptions)

```sql
CREATE TABLE health_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId"       UUID NOT NULL REFERENCES health_plan_products(id),
  "holderPatientId" UUID,
  "companyId"       UUID REFERENCES companies(id),
  "planNumber"      VARCHAR(50) NOT NULL UNIQUE,   -- client-computed (count+1), not a DB sequence — see M4 module doc
  "startDate"       DATE NOT NULL,
  "endDate"         DATE,
  active            BOOLEAN NOT NULL DEFAULT true,
  "usageCount"      INT NOT NULL DEFAULT 0,        -- exists, nothing increments it
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON health_plans("holderPatientId");
CREATE INDEX ON health_plans("companyId");
```

A `Patient` links to its plan via `patients."healthPlanId" → health_plans.id` (one active plan per
patient, not a join table). There is no `corporate_plan_members` table — a corporate plan's
membership model was never built out beyond this single FK.

---

## 5. Exams & Results Module (M5)

### 5.1 `exam_requests`

```sql
CREATE TABLE exam_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"     UUID NOT NULL,
  "appointmentId" UUID REFERENCES appointments(id),
  "serviceId"     UUID NOT NULL REFERENCES services(id),
  "requestedBy"   UUID NOT NULL,
  notes           VARCHAR(500),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending',
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON exam_requests("patientId");
```

Self-labelled a "Phase 1 stub" in the schema itself. **No result field exists at all** — no
`resultR2Key`, no `resultedAt`, no `exam_results` table. Even if a future UI let a lab tech upload
a result, there is nowhere in the current schema for that file reference to live.

---

## 6. Billing / Financeiro Module (M6)

### 6.1 `invoices`

```sql
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceNumber" VARCHAR(20) NOT NULL UNIQUE,  -- INV-2026-0001, session-advisory-lock-guarded sequence
  "patientId"     UUID NOT NULL REFERENCES patients(id),
  "appointmentId" UUID REFERENCES appointments(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  -- draft | issued | partially_paid | paid | overdue | cancelled
  subtotal        NUMERIC(10,2) NOT NULL,
  total           NUMERIC(10,2) NOT NULL,
  "amountPaid"    NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           VARCHAR(500),
  "dueDate"       DATE,
  "issuedAt"      TIMESTAMPTZ,
  "pdfR2Key"      VARCHAR(300),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON invoices("patientId");
CREATE INDEX ON invoices(status);
CREATE INDEX ON invoices("issuedAt");
CREATE INDEX ON invoices(status, "createdAt");   -- BFF billing-summary
CREATE INDEX ON invoices("patientId", status);   -- patient invoice timeline
```

A weekly job marks `issued`/`partially_paid` invoices past their `dueDate` as `overdue` and emails
admins a digest; `recordPayment` runs insert+resum+status-update in one transaction with a guard
against `amountPaid` exceeding `total`; `POST /invoices/:id/cancel` sets `status = 'cancelled'`
(rejecting an already-`paid` invoice) and triggers an E-Fatura cancel job if the invoice had
already been accepted by the tax authority. No `health_plan_id` column — invoices aren't currently
linked to a health plan.

### 6.2 `invoice_items`

```sql
CREATE TABLE invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId" UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  "serviceId" UUID REFERENCES services(id),   -- NULL = off-catalogue/custom line item
  description VARCHAR(200) NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  "unitPrice" NUMERIC(10,2) NOT NULL,
  total       NUMERIC(10,2) NOT NULL
);

CREATE INDEX ON invoice_items("invoiceId");
```

A catalogued service billed at a price other than `services.price` is a price override — logged
always, and admin-only when `serviceId` is set (an off-catalogue item has no catalogue price to
override, so anyone who can create invoices can add one).

### 6.3 `payments`

```sql
CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId"      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount           NUMERIC(10,2) NOT NULL,
  method           VARCHAR(30) NOT NULL,  -- cash | bank_transfer | health_plan | vinti4
  reference        VARCHAR(100),
  "idempotencyKey" VARCHAR(100) UNIQUE,
  "paidAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON payments("invoiceId");
```

No `card` payment method, no `received_by` staff reference — never implemented.

### 6.4 `efatura_submissions`

```sql
CREATE TABLE efatura_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceId"    UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending | submitting | accepted | rejected | cancelled | error
  atcud          VARCHAR(100),
  "efaturaRef"   VARCHAR(100),
  "errorCode"    VARCHAR(50),
  "errorMessage" VARCHAR(500),
  "retryCount"   INT NOT NULL DEFAULT 0,
  "submittedAt"  TIMESTAMPTZ,
  "acceptedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON efatura_submissions(status);
```

Submission to the Cabo Verde tax authority (SAF-T CV / mw.efatura.cv) runs via a BullMQ queue with
retry; `patient.nif` is decrypted just before building the payload. Not present in the original
design doc at all — added when E-Fatura was actually built.

### 6.5 `expenses` and `income`

```sql
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description     VARCHAR(200) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  date            DATE NOT NULL,
  supplier        VARCHAR(150),
  method          VARCHAR(30) NOT NULL,
  reference       VARCHAR(100),
  "receiptR2Key"  VARCHAR(300),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  notes           VARCHAR(500),
  "requestedById" UUID REFERENCES staff(id),
  "approvedById"  UUID REFERENCES staff(id),
  "approvedAt"    TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON expenses(status);
CREATE INDEX ON expenses(date);

CREATE TABLE income (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description VARCHAR(200) NOT NULL,
  category    VARCHAR(100) NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  date        DATE NOT NULL,
  notes       VARCHAR(500),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON income(date);
```

The Financeiro module (expenses with an approval workflow + receipt upload, manual income separate
from invoice payments, an overview dashboard) — not in the original design at all.

---

## 7. Staff & Resource Scheduling Module (M8)

### 7.1 `staff_shifts`

```sql
CREATE TABLE staff_shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"   UUID NOT NULL REFERENCES staff(id),
  "shiftDate" DATE NOT NULL,
  "startTime" VARCHAR(5) NOT NULL,   -- "HH:MM", not a TIME column
  "endTime"   VARCHAR(5) NOT NULL,
  notes       VARCHAR(200),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("staffId", "shiftDate")
);

CREATE INDEX ON staff_shifts("shiftDate");
```

### 7.2 `staff_availability`

```sql
CREATE TABLE staff_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"     UUID NOT NULL REFERENCES staff(id),
  "dayOfWeek"   INT NOT NULL,  -- 0=Sunday … 6=Saturday
  "startTime"   VARCHAR(5) NOT NULL,
  "endTime"     VARCHAR(5) NOT NULL,
  "slotMinutes" INT NOT NULL DEFAULT 30,
  active        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE("staffId", "dayOfWeek", "startTime")
);
```

### 7.3 `leave_requests`

```sql
CREATE TABLE leave_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"   UUID NOT NULL REFERENCES staff(id),
  "startDate" DATE NOT NULL,
  "endDate"   DATE NOT NULL,
  reason      VARCHAR(300),
  status      VARCHAR(30) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON leave_requests("staffId");
```

Honored by `getAvailability`/`create()` (a `status = 'approved'` row covering the date blocks the
whole day), but **there is no submission or approval endpoint anywhere** — rows can only get here
by direct DB access. `type` (annual/sick/personal/unpaid) and `approved_by` from the original
design were never implemented.

### 7.4 `public_holidays`

```sql
CREATE TABLE public_holidays (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date           DATE NOT NULL,
  name           VARCHAR(100) NOT NULL,
  recurring      BOOLEAN NOT NULL DEFAULT true,   -- true = matches month/day every year, stored year is irrelevant
  "countryCode"  VARCHAR(5) NOT NULL DEFAULT 'CV',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(date, "countryCode")
);
```

Not in the original design at all. Honored by `getAvailability`/`create()` the same way leave is.

---

## 8. Clinical Records Module (M7) — not implemented

**No `clinical_notes`, `prescriptions`, or `referrals` table exists.** `Docs/TODO.md` previously
claimed these were "already in schema" — they are not (verified directly against
`schema.prisma`). The only patient-notes storage is the generic `patient_notes` table (§3.2), which
has none of SOAP structure, ICD-10 codes, a 24-hour edit lock, or role-gated visibility. Given the
client is now a psychology clinic, this module's real shape (session notes, treatment plans)
likely needs a fresh spec pass rather than resuming the original SOAP/ICD-10/prescription design
written for a general medical clinic.

---

## 9. Home Visit Module (M9) — not implemented

**No `home_visits` table exists** (same `Docs/TODO.md` drift as M7, now corrected). The
`/visits` page is a UI mockup with hardcoded data and no backend.

---

## 10. WhatsApp Integration Module (M3) — not implemented

**No `whatsapp_conversations`, `whatsapp_messages`, or `whatsapp_templates` table exists**, and no
`apps/api/src/modules/whatsapp` directory exists. The `ReminderChannel` enum and
`appointment_reminders` table from M1 are the one piece of groundwork already laid — they're ready
to be pointed at a real send service once one exists.

---

## 11. Analytics (M10) — not implemented

No materialised views exist. The Financeiro overview tab (`ResumoTab.tsx`) is the one piece of
real, live-data analytics anywhere in the app today — worth treating as the template for what M10
should look like rather than building it from the original design.

---

## 12. Audit Log

```sql
CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId"    VARCHAR(36),
  "actorEmail" VARCHAR(150),
  action       VARCHAR(100) NOT NULL,    -- HTTP method, e.g. "POST"
  resource     VARCHAR(100) NOT NULL,    -- route resource, e.g. "patients"
  "resourceId" VARCHAR(36),
  "ipAddress"  VARCHAR(45),
  "userAgent"  VARCHAR(300),
  metadata     JSONB,                    -- includes { diff: { before, after } } for Patients + Financeiro mutations
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_log("actorId");
CREATE INDEX ON audit_log(resource, "resourceId");
CREATE INDEX ON audit_log("createdAt");
```

Shape differs from the original design (`table_name`/`record_id`/`old_values`/`new_values`
generic-diff columns) — the actual implementation logs at the HTTP-request level (one row per
mutating request, or per `@AuditView()`-marked GET) with an optional before/after `diff` in
`metadata`, not a per-column DB-trigger-style change record.

**Genuinely append-only at the database level**, not just by convention: a
`BEFORE UPDATE OR DELETE` trigger rejects any attempt to modify or remove a row, enforced even
against the app's own Postgres role (which is a superuser — confirmed via `pg_roles`, meaning a
plain `REVOKE UPDATE, DELETE` would have been silently ineffective). See
`packages/database/prisma/manual-sql/audit-log-immutable.sql` — **not reapplied by
`prisma db push`/`migrate`**, so it must be re-run by hand against any fresh database (new dev
setup, restored backup, CI).

Retention (the original design's "7 years") is not implemented — no partitioning or purge policy
exists.

---

## 13. `settings` and `parametrizacoes`

```sql
CREATE TABLE settings (
  key         VARCHAR PRIMARY KEY,   -- "clinic" | "notifications" | "integration_whatsapp" | "integration_email_smtp" | …
  value       JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE parametrizacoes (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(100) NOT NULL,   -- parameter group, e.g. a dropdown's option set
  valor       VARCHAR(191) NOT NULL,
  codigo      VARCHAR(100),
  descricao   VARCHAR(255),
  ordem       INT NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON parametrizacoes(nome, ativo, "deletedAt");
```

Neither table existed in the original design. `settings` is a single-row-per-key JSON blob store
(clinic business hours, feature toggles, integration credentials); `parametrizacoes` backs
admin-configurable dropdown option lists.

---

## 14. Index Summary

| Table | Key Indexes |
|---|---|
| patients | phone (unique), nifHash (unique), fullName, deletedAt |
| appointments | patientId, staffId, scheduledAt, status, deletedAt, seriesId, (patientId, deletedAt), (scheduledAt, deletedAt); idempotencyKey (unique) |
| appointment_series | idempotencyKey (unique) |
| invoices | patientId, status, issuedAt, (status, createdAt), (patientId, status) |
| payments | invoiceId; idempotencyKey (unique) |
| efatura_submissions | status |
| leave_requests | staffId |
| audit_log | actorId, (resource, resourceId), createdAt |

---

*CAP 360 · Database Schema · regenerated from `schema.prisma` — 2026-08-30*
