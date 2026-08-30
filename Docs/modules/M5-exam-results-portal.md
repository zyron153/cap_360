# M5 — Exam & Results Portal

> **Priority:** 🟠 High · **Phase:** 2 (Months 3–5)
> **Dependencies:** M2 (Patient CRM), M7 (EMR — exam linking)

---

## 1. Overview

Manages the full lifecycle of diagnostic exam requests — from request creation through lab processing to secure digital result delivery to the patient via WhatsApp. Eliminates manual result hand-off and provides a digital archive per patient.

> **Implementation status: 🎭 UI mockup only.** An `exam_requests` table exists in the schema
> (self-labelled a "Phase 1 stub") but has **no controller or service at all** — nothing can create,
> list, or update one through the API. There is no `exam_results` table and no result field of any
> kind, so the worklist, upload, secure-download-token, and DICOM viewer features below (§3.2–§3.4)
> have nothing to build on yet. Nothing in this document is implemented.

---

## 2. Supported Exam Categories

| Category | Examples |
|---|---|
| Cardiology | ECG, Holter 24h, MAPA, Echocardiogram |
| Ultrasound | Abdominal, Pelvic, Mammary, Scrotal, Prostatic, Neck, Thyroid, Soft Tissue |
| Lab | Blood tests, urine analysis |
| Dental Imaging | Panoramic X-ray |

---

## 3. Core Features

### 3.1 Exam Request Creation

Requests can be created:
- By a doctor from within a clinical note (M7) — pre-linked to appointment
- By receptionist on behalf of patient — standalone request
- By patient via WhatsApp bot or portal (Phase 4)

Request form captures:
- Patient (linked to CRM)
- Exam service type
- Requesting doctor
- Urgency: Routine / Urgent / Stat
- Clinical notes / indication
- Preferred date/time

On creation, the patient receives automatic WhatsApp message with preparation instructions (e.g., fasting requirements for abdominal ultrasound).

### 3.2 Lab / Technician Worklist

- Filtered view: assigned to me / all pending / in-progress / resulted
- Sort by urgency then scheduled time
- Mark as `sample_collected`, `in_progress`, `resulted`
- Assign to a specific technician

### 3.3 Result Upload

Staff (nurse, lab_tech) uploads result file:
- File types: PDF (reports), JPEG/PNG (images), DICOM (Phase 4 — imaging)
- Max file size: 20MB per upload
- Text summary field (optional — for quick doctor reference)
- File stored in Cloudflare R2 under `exam-results/{patient_id}/{exam_id}/`

On upload:
1. Exam request status → `resulted`
2. Secure download token generated (72h expiry)
3. Patient notified via `exam_result_ready` WhatsApp template
4. Referring doctor notified via in-app notification

### 3.4 Secure Patient Download

- Patient receives WhatsApp link: `https://files.maissaudecv.com/results/{token}`
- Token validated server-side; if expired → returns helpful error with clinic contact
- Download event logged in `audit_log` (timestamp, IP address)
- Files accessible from patient CRM timeline indefinitely (admin/doctor access)

---

## 4. Data Model

See `DATABASE-SCHEMA.md` → Section 6:
- `exam_requests`
- `exam_results`

---

## 5. API Endpoints

See `API-SPEC.md` → Section 6 (Exams & Results)

---

## 6. UI Screens

| Screen | Role | Description |
|---|---|---|
| Exam Worklist | Lab Tech / Nurse | Kanban or table of pending/in-progress exams |
| Exam Request Form | Receptionist / Doctor | Create new request |
| Result Upload | Lab Tech / Nurse | Upload file, add summary, confirm delivery |
| Patient Results | Patient (portal) | List of own results with download links |
| Exam Detail | Receptionist / Doctor | Full request + result + delivery status |

---

## 7. Business Rules

- Only authorised staff (nurse, lab_tech, admin) can upload results
- Results cannot be deleted — only flagged as superseded (new version uploaded)
- Download links expire after 72 hours; patient can request a new link via bot or reception
- DICOM files are stored but viewer integration (Cornerstone.js) is Phase 4

---

*Module M5 · v1.1 · updated 2026-08-30 against the current implementation*
