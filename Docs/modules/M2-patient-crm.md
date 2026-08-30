# M2 — Patient CRM

> **Priority:** 🔴 Critical · **Phase:** 1 (Months 1–3)
> **Dependencies:** None (foundational module)

---

## 1. Overview

The Patient CRM is the single source of truth for every patient in the clinic. All other modules (appointments, billing, exams, WhatsApp) reference and enrich the patient record. It replaces the current state of zero structured patient data.

> **Implementation status:** core CRUD, search, consent tracking, and GDPR-style erasure
> (encrypted PII, hard-nulled on soft-delete) are built and tested. The **Document Manager** screen
> has no backend behind it (only a signed download-url route exists, nothing creates a document
> row); the **communication log** table exists but nothing writes to it; **tags**, **duplicate
> review/merge**, and **full-text search** described below were never built.

---

## 2. Core Features

### 2.1 Unified Patient Profile

Each patient record contains:

**Demographics** *(✅ = implemented, ❌ = never built)*:
- ✅ Full name, date of birth (both **encrypted at rest**, AES-256-GCM), gender
- ❌ Nationality — no field exists
- ✅ NIF (Cabo Verde tax ID, also encrypted, with a separate blind-index hash for exact-match search) — used for invoice generation
- ❌ Photo — no field, no upload path

**Contact:**
- ✅ Phone (unique identifier) — normalized and validated against the Cabo Verde `+238` country
  code specifically, not a generic E.164 check
- ❌ Secondary phone, zone (neighbourhood/district) — no fields exist
- ✅ Email, residential address

**Clinical context:**
- ❌ Primary physician assignment — no field
- ✅ Active health plan (linked from M4, one FK, not a membership table)
- ❌ Tags — no field exists

**Administrative:**
- ✅ Emergency contact name and phone
- ❌ Consent forms and privacy agreements as uploaded documents — consent is a single
  `consentGiven` boolean + `consentGivenAt` timestamp, not a document

### 2.2 Patient History Timeline

✅ Implemented via `GET /patients/:id/timeline`, merging **appointments + communications +
invoices** (newest first, capped at 20 per type). ❌ Exam requests/results and home-visit history
are not included — neither module has a backend to pull from.

### 2.3 Communication Log

🟡 The `communication_log` table exists and is queried by the timeline above, but **nothing
currently writes to it** — there's no WhatsApp webhook (M3 doesn't exist) and no SendGrid/Africa's
Talking integration to log deliveries from. Manual staff notes go to the separate `patient_notes`
table instead, not this log. Follow-up tasks with due dates: not implemented.

### 2.4 Patient Search

🟡 Search by name/phone/email uses a plain case-insensitive `contains` match, not PostgreSQL
`pg_trgm`/full-text search or relevance ranking. NIF search is necessarily **exact-match only**
(via a blind-index hash) since the column is encrypted — a partial NIF will not match. Filtering
by health-plan status exists (`planFilter`); filtering by tag or last-visit date does not (no tags
field exists at all).

### 2.5 Duplicate Detection

🟡 Simpler than described: `POST /patients` rejects outright (`409 Conflict`) on an existing
phone or NIF match — there's no "present potential duplicates for review" flow and no merge tool.

---

## 3. Data Model

See `DATABASE-SCHEMA.md` → sections 1.1, 3.1, 3.2, 3.3:
- `patients`
- `patient_documents`
- `patient_notes`
- `communication_log`

---

## 4. API Endpoints

See `API-SPEC.md` → Section 2 (Patients)

---

## 5. Access Control

🟡 Actual RBAC is **coarse route-level `@Roles` guards**, not the per-field matrix below — a doctor
and a nurse see the exact same patient fields as a receptionist (no "own/assigned only" narrowing,
no field-level redaction of clinical notes). Real behaviour, from `patients.controller.ts`:

| Route | Allowed roles |
|---|---|
| List / view / timeline | admin, receptionist, doctor, nurse (all identical access) |
| `GET /patients/me` | `patient` role only (own record, via JWT `patient_id` claim) |
| Create / update | admin, receptionist only — **doctor and nurse cannot create or edit** a patient record |
| Soft-delete (erasure) | admin only |
| Add note | admin, receptionist, doctor, nurse |
| Documents (`download-url` only) | admin, doctor, nurse, receptionist, lab_tech, patient |

❌ `lab_tech` and `corporate_hr` (both real `StaffRole` values) have **no access at all** to the
patients module except the documents download-url route above. ❌ Tags and delete/merge don't
apply — neither feature exists (see §2.1 and §2.5).

---

## 5. UI Screens

| Screen | Description |
|---|---|
| Patient Search | Search bar + results table with quick-view card |
| Patient Profile | Full profile with tabs: Overview, History, Documents, Comms |
| New Patient Form | Multi-step registration (demographics → contact → consent) |
| Patient Timeline | Scrollable chronological activity feed |
| Communication Log | Threaded message view per channel |
| Document Manager | Upload, categorise, and download patient documents |

---

## 6. GDPR / Data Privacy

- 🟡 Consent is a single `consentGiven` boolean + `consentGivenAt` timestamp captured at
  registration — **not** a stored consent-form document
- ❌ Data portability (export full record as JSON/PDF): not implemented
- ✅ Right to erasure: soft-delete now genuinely nulls out direct PII (name, DOB, phone, NIF,
  email, address, emergency contact) via `patients.repository.ts`'s `softDelete()`, decrypting
  nothing further afterward; **billing records are retained** un-anonymised, linked only by patient
  ID, for tax/legal purposes — matches the "anonymised billing" intent in spirit, not literally
- ✅ Access log: `GET /patients/:id` is annotated `@AuditView()` and writes to the immutable
  `audit_log` table (append-only, enforced by a DB trigger — see `SECURITY.md`)
- ❌ Data retention / auto-archival after N years: not implemented — no scheduled job exists for it

---

*Module M2 · v1.1 · updated 2026-08-30 against the current implementation*
