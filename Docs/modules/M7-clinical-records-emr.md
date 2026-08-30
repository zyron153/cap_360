# M7 — Clinical Records (EMR-lite)

> **Priority:** 🟡 Medium · **Phase:** 3 (Months 5–8)
> **Dependencies:** M2 (Patient CRM), M1 (Appointments), M5 (Exams)

---

## 1. Overview

A lightweight Electronic Medical Records module that gives doctors a structured digital workspace for consultation notes, prescriptions, and referrals. Designed to be simple and fast — not a full hospital EMR — with strict access control to protect patient clinical privacy.

> **Implementation status: 🎭 UI mockup only — no backend at all.** No `clinical_notes`,
> `prescriptions`, or `referrals` table exists; no `/appointments/:id/clinical-note` route or
> equivalent exists. The only real, adjacent thing in the running app is `patient_notes` — a plain
> free-text staff note with no SOAP structure, no ICD-10 codes, and no lock/audit behaviour (see
> `M2-patient-crm.md` §2.1/§2.2). Nothing in this document is implemented.

---

## 2. Core Features

### 2.1 SOAP Note Editor

Each completed appointment can have one clinical note in SOAP format:

| Section | Content |
|---|---|
| **S — Subjective** | Patient-reported complaint, symptoms, history |
| **O — Objective** | Physical examination findings, vitals (BP, HR, temp, weight) |
| **A — Assessment** | Diagnosis with ICD-10 codes (Portuguese descriptions) |
| **P — Plan** | Treatment: medication, follow-up, referrals, exams ordered |

- Rich text editor (no markdown — simple formatting only)
- Auto-save every 30 seconds
- Notes locked 24 hours after creation (admin can unlock with reason)
- Doctor sees patient summary (demographics, active plan, last 3 visits) in sidebar while writing

### 2.2 ICD-10 Code Search

- Searchable ICD-10 database with Portuguese disease descriptions
- Type diagnosis name or code → dropdown of matching codes
- Multiple codes per assessment field
- Most frequently used codes pre-populated for each specialty

### 2.3 Prescription Generator

From within a clinical note:
- Add drug with name, dosage, frequency, duration, special instructions
- Multiple drugs per prescription
- Prescription printable as PDF (Mais Saúde letterhead)
- Prescription attached to patient CRM timeline

### 2.4 Referrals

Internal referrals:
- Select another Mais Saúde doctor by specialty
- System creates appointment booking request; patient notified via WhatsApp with booking link

External referrals:
- Free-text for external provider/hospital
- Printed referral letter with doctor signature block

### 2.5 Exam Requests from Notes

Doctor can create an exam request (M5) directly from the Plan section of a SOAP note. The exam is pre-linked to the current consultation.

---

## 3. Access Control

| Action | doctor | nurse | receptionist | admin |
|---|---|---|---|---|
| View clinical notes | own patients | assigned visits only | patient summary (no clinical detail) | read (no edit) |
| Create/edit SOAP note | ✅ | 🔒 | 🔒 | 🔒 |
| View prescriptions | own patients | ✅ | 🔒 | ✅ |
| Create prescriptions | ✅ | 🔒 | 🔒 | 🔒 |
| Create referrals | ✅ | 🔒 | 🔒 | 🔒 |

Notes are linked to a specific doctor; a doctor cannot view another doctor's notes for their patients without `admin` escalation (audit logged).

---

## 4. Data Model

See `DATABASE-SCHEMA.md` → Section 8:
- `clinical_notes`
- `prescriptions`
- `referrals`

---

## 5. API Endpoints

See `API-SPEC.md` → Section 8 (Clinical Records)

---

## 6. UI Screens

| Screen | Role | Description |
|---|---|---|
| EMR Editor | Doctor | Full SOAP note editor with sidebar patient summary |
| Prescription Pad | Doctor | Drug entry and prescription PDF preview |
| Referral Form | Doctor | Internal/external referral creation |
| Patient Summary | Receptionist / Nurse | Read-only demographic and recent visits (no clinical detail) |
| Clinical History | Doctor | Scrollable history of all SOAP notes for a patient |

---

## 7. Compliance Notes

- Clinical notes are considered sensitive health data — access is logged at every view
- Prescriptions must include doctor's name, CRM registration number, and date
- Referral letters include clinic address, doctor specialty, and patient NIF
- ICD-10 coding supports INPS (Instituto Nacional de Previdência Social) reporting requirements

---

*Module M7 · v1.1 · updated 2026-08-30 against the current implementation*
