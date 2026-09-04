# M7 — Clinical Records (Psychology Practice)

> **Priority:** 🟡 Medium · **Phase:** 3 (Months 5–8)
> **Dependencies:** M2 (Patient CRM), M1 (Appointments)

---

## 1. Overview

A structured clinical-notes, prescription, and referral module for CAP's psychology practice.
**This replaces the module's original spec entirely** — the doc this replaced was written for a
general-medicine clinic (SOAP notes with vitals, ICD-10 diagnosis codes, prescription pads assuming
every doctor prescribes) before the practice rebranded to CAP, a psychology-focused clinic. Building
that as-is would have modeled the wrong practice. The requirements below came from a direct
conversation with the practice about what a session note, access model, and safety concern actually
look like here — see the roadmap plan's Phase 4 for that discussion's record.

> **Implementation status: ✅ real, built and tested.** `clinical_notes`, `prescriptions`,
> `prescription_items`, and `referrals` tables exist (`packages/database/prisma/schema.prisma`).
> Backend: `apps/api/src/modules/clinical-records/` (17 unit tests). Frontend: a
> `ClinicalRecordsSection` on the patient profile page (`patients/[id]/page.tsx`), and
> `records/page.tsx` — previously 100% fake mock data, now a real "my recent notes across every
> patient" worklist.

---

## 2. Core Features

### 2.1 Structured Session Notes

Each note captures, in four required sections (a therapy-adapted equivalent of SOAP, not the
original medical-vitals version):

| Field | Content |
|---|---|
| `presentingConcerns` | Client-reported concerns, mood, history since last session |
| `observations` | Clinician's observations — affect, behaviour, presentation |
| `assessment` | Clinical impression, progress against treatment goals |
| `plan` | Interventions planned, homework, focus for next session |

Plus `sessionType` (individual / couples / group / initial assessment), optional
`durationMinutes`, and optionally linked to the `Appointment` it documents (`appointmentId`).

No auto-save, no rich-text editor, no "locked notes require an unlock reason from admin" workflow
— the original spec's polish items, none of which were part of what was actually asked for. What
*was* kept: a note is editable by its author for 24h after creation (checked against `createdAt`
in `ClinicalRecordsService`, not a stored lock flag), and by admin at any time afterward.

### 2.2 Risk Flagging

`riskLevel` (`none` / `low` / `moderate` / `high`) on every note, with a required `riskNotes` free
-text field once it's above `none` (enforced in `CreateClinicalNoteSchema`'s `.refine()` — Zod
can't see the catalogue... rather, can't cross-reference a DB row, so this is a pure schema-level
check). Shown as a colored badge everywhere a note appears (the patient page's note list, the note
detail view, and the `/records` worklist) — not buried in a paragraph of free text.

### 2.3 Prescriptions

A prescription has one or more line items (`drugName`, `dosage`, `frequency`, optional
`durationDays`/`instructions`), optionally linked to the note it came from. No PDF generation, no
letterhead, no "Mais Saúde signature block" — those were print-output polish from the original
spec; nothing asked for them here. Kept because this practice has prescribing capability
(consistent with the wider MD/psychiatrist affiliation).

### 2.4 Referrals

`internal` (to another CAP clinician — `targetStaffId`) or `external` (free-text
`externalProviderName`/`externalSpecialty`). A `status` (`pending` / `scheduled` / `completed` /
`declined`) tracks it forward; both the referrer and (for internal referrals) the target clinician
can update it. No automatic booking-request creation or WhatsApp notification on referral — that
was the original spec's idea for internal referrals specifically; this version just records the
referral itself, and booking the resulting appointment is a manual, separate action today.

### 2.5 What was deliberately dropped from the original spec

- **ICD-10 code search** — a general-medicine diagnostic-coding requirement with no equivalent
  asked for here.
- **Ordering exams from a note** — this module has no exam-request feature; M5 (Exams) is separate
  and was never asked to integrate with this one.
- **Vitals (BP/HR/temp/weight)** — not relevant to a psychology session note.

---

## 3. Access Control

Access is scoped by **note authorship**, not a separate patient-clinician assignment table (this
app has no such registry anywhere else, and adding one wasn't warranted for this). The rule,
applied identically to notes and prescriptions:

- **admin** — reads and edits everything, no restriction, no time limit.
- **doctor** — reads and edits only what *they themselves* wrote. Requesting another clinician's
  note by id gets a 404, not a 403 — indistinguishable from "doesn't exist," so a caller can't even
  confirm a colleague has a note on file for a given patient (same posture as this session's
  `corporate_hr` cross-company fix elsewhere in the app).
- **nurse / receptionist / lab_tech / corporate_hr** — no access at all. The controllers are gated
  `@Roles("admin", "doctor")` at the class level, so these roles don't even reach the
  authorship check; they 403 outright.

Referrals are the one exception: both the referrer *and* an internal referral's target clinician
can see and update it (the target clinician needs to know a referral was sent to them).

Every read route carries `@AuditView()` — a clinical-note view is logged the same as a patient
record view, per `SECURITY.md`.

---

## 4. Data Model

`packages/database/prisma/schema.prisma` — `ClinicalNote`, `Prescription`, `PrescriptionItem`,
`Referral` (see that file directly; this doc no longer duplicates field lists that drift from the
real schema — that's exactly how the original version of this doc went stale).

`ClinicalNote`'s four structured fields plus `riskNotes`, and every `Prescription`/
`PrescriptionItem` text field (`notes`, `drugName`, `dosage`, `frequency`, `instructions`), are
AES-256-GCM encrypted at the application layer via `EncryptionService` — same posture as
`Patient.nif`/`dateOfBirth`, encrypted on every write and decrypted on every read in
`ClinicalRecordsRepository`. No blind index on any of them (nothing does an exact-match lookup on
clinical text). `Referral.reason` is **not** encrypted — SECURITY.md's own list only names clinical
notes and prescriptions specifically; revisit if that scope changes.

---

## 5. API Endpoints

All under `apps/api/src/modules/clinical-records/`, gated `@Roles("admin", "doctor")`:

```
POST   /patients/:patientId/clinical-notes
GET    /patients/:patientId/clinical-notes      — author-scoped (admin: all)
GET    /clinical-notes                          — author-scoped, across every patient ("mine")
GET    /clinical-notes/:id
PATCH  /clinical-notes/:id                      — author within 24h, or admin
POST   /patients/:patientId/prescriptions
GET    /patients/:patientId/prescriptions       — author-scoped (admin: all)
POST   /patients/:patientId/referrals
GET    /patients/:patientId/referrals           — referrer or target (admin: all)
PATCH  /referrals/:id/status                    — referrer, target, or admin
```

---

## 6. UI Screens

| Screen | Where | Description |
|---|---|---|
| Clinical Records section | `patients/[id]/page.tsx` | Tabbed (Notas Clínicas / Prescrições / Referenciações) section below the patient's timeline. "Nova Nota" opens the full structured form; clicking an existing note opens a read-only detail view. Only rendered for admin/doctor — other roles never see it. |
| Registos Clínicos worklist | `records/page.tsx` | A flat "my recent notes across every patient" list (admin: everyone's), linking into each patient's page. Replaced the page's previous 100%-fake mock table. |

---

## 7. Compliance Notes

- Clinical-note and prescription content is encrypted at rest (§4) — `SECURITY.md`'s "AES-256-GCM
  for clinical notes, prescriptions" claim is now real, not aspirational.
- Clinical-note access is logged at every read (`@AuditView()`), matching `SECURITY.md`'s
  "patient record viewed" requirement.
- Risk flags are structured data, not buried in prose, so they can't be missed on a quick scan of
  a patient's history.
- No ICD-10/INPS reporting integration exists or was asked for — the original spec's compliance
  notes assumed a general-medicine reporting requirement that doesn't apply here.

---

*Module M7 · v2.1 · updated 2026-09-04 — v2.0 rewrite plus field-level encryption*
