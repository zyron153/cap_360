# M9 — Home Visit Manager

> **Priority:** 🟡 Medium · **Phase:** 3 (Months 5–8)
> **Dependencies:** M2 (Patient CRM), M7 (EMR), M6 (Billing)

---

## 1. Overview

Manages the full lifecycle of home medical and nursing visits — a key differentiator service for Mais Saúde CV. Provides request capture, staff assignment, real-time status tracking, and post-visit clinical note and billing integration.

> **Implementation status: 🎭 UI mockup only — no backend at all.** No `home_visits` table, no
> `/home-visits/*` routes, no status-tracking, no map integration, and (per M7 above) no SOAP-note
> integration to post a visit into even if one existed. There is also no React Native mobile app in
> this repo (`apps/` contains only `api` and `web`) — §6's mobile-app priority has nothing to run
> on. Nothing in this document is implemented.

---

## 2. Core Features

### 2.1 Home Visit Request

Requests created by:
- Receptionist on phone call
- Patient via WhatsApp bot (Flow 1 → Home Visit option)
- Patient via self-service portal (Phase 4)

Request captures:
- Patient (linked to CRM)
- Service type (medical visit, nursing visit, IV, injection, wound care, etc.)
- Patient address (manual entry or saved from profile)
- Optional GPS coordinates (lat/lng) for map display
- Urgency: Routine / Urgent / Emergency
- Reason / chief complaint
- Preferred date and time window

### 2.2 Staff Assignment

- Admin or receptionist views pending requests on the Home Visit board
- Assigns to an available doctor or nurse
- Map view shows patient addresses as pins; assigned staff current locations (if mobile app tracking enabled)
- Assignment sends WhatsApp notification to assigned staff member with patient address and Google Maps link

### 2.3 Visit Status Tracking

| Status | Who Sets It | Trigger |
|---|---|---|
| `requested` | System | Visit request submitted |
| `assigned` | Admin/Receptionist | Staff member assigned |
| `departed` | Staff (mobile app) | Staff leaves clinic |
| `at_patient` | Staff (mobile app) | Staff arrives at address |
| `completed` | Staff (mobile app) | Visit finished |
| `cancelled` | Admin | Cancelled before departure |

Timestamps recorded for each transition.

### 2.4 Post-Visit Actions

On `completed`:
1. Staff prompted to create SOAP note (M7) — pre-linked to visit
2. Invoice auto-generated with home visit service fee (M6)
3. Patient receives WhatsApp message confirming visit completion and invoice

### 2.5 Map Integration

- Google Maps Embed API in admin view shows all today's visit pins
- Address validated against Google Maps Places API on input
- Staff receives Google Maps deep-link for navigation

---

## 3. Data Model

See `DATABASE-SCHEMA.md` → Section 10:
- `home_visits`

---

## 4. API Endpoints

See `API-SPEC.md` → Section 10 (Home Visits)

---

## 5. UI Screens

| Screen | Role | Description |
|---|---|---|
| Home Visit Board | Receptionist / Admin | Kanban by status: Requested → Assigned → In Progress → Completed |
| Visit Map | Admin | Map view of today's visits with staff locations |
| Visit Request Form | Receptionist | Create new visit request |
| My Visits (Mobile) | Nurse / Doctor | List of assigned visits with navigation links and status buttons |
| Visit Detail | All | Full visit record with status history, notes, invoice |

---

## 6. Mobile App Priority

Home Visit Manager is the primary use case for the React Native mobile app (Phase 3). Staff in the field need to:
- See assigned visits with map navigation
- Update visit status with one tap
- Create post-visit SOAP note on mobile
- Work offline with status sync when connectivity restored

---

## 7. Business Rules

- Emergency visits skip assignment approval and go direct to urgent notification to all available staff
- A visit cannot be marked `completed` without an assigned staff member
- GPS tracking of staff is opt-in and requires explicit staff consent
- Home visit fee is higher than in-clinic fee; billable at separate service rate

---

*Module M9 · v1.1 · updated 2026-08-30 against the current implementation*
