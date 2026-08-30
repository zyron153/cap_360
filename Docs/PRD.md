# Mais Saúde CV — Healthcare ERP/CRM Platform
## Product Requirements Document

> **Version:** 1.0 · **Date:** June 2026 · **Status:** Draft – Pending Stakeholder Review
> **Prepared for:** Mais Saúde CV – Palmarejo, Praia, Cabo Verde
> **Classification:** Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Proposed Solution: Mais Saúde 360 Platform](#3-proposed-solution-mais-saúde-360-platform)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [User Roles & Personas](#6-user-roles--personas)
7. [Feature Requirements & Prioritisation](#7-feature-requirements--prioritisation)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Technical Architecture](#9-technical-architecture)
10. [Success Metrics & KPIs](#10-success-metrics--kpis)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Build vs. Buy: Open Source Alternatives](#12-build-vs-buy-open-source-alternatives)
13. [Next Steps & Sign-Off](#13-next-steps--sign-off)
- [Appendix A: Glossary](#appendix-a-glossary)

---

## 1. Executive Summary

Mais Saúde CV is a private healthcare clinic located in Palmarejo, Praia, Cabo Verde, offering:

- Specialist medical consultations (Cardiology, Paediatrics, Gynaecology, Ophthalmology)
- Dental services (cavity treatment, whitening, orthodontic maintenance)
- Diagnostic exams (ECG, Holter, MAPA, Echocardiogram)
- Ultrasound imaging (Abdominal, Pelvic, Mammary, Scrotal, Prostatic, Neck, Soft Tissue, Thyroid)
- Home-visit medical and nursing services
- Family and Corporate Health Plans

A comprehensive audit of the clinic's website ([maissaudecv.com](https://maissaudecv.com)) reveals a critical operational gap: **every patient-facing call-to-action (CTA) redirects to a single WhatsApp number (+238 522 42 00)**. This means:

- All scheduling is manual and handled through informal chat messages
- There is no centralised patient record, appointment calendar, or billing system
- Staff spend significant time on repetitive coordination tasks instead of clinical care
- Patient experience is inconsistent, with no automated reminders, confirmations, or follow-ups
- Business intelligence (patient volume, revenue, no-show rates) is effectively zero

> **Strategic Goal:** Replace the WhatsApp-only workflow with a purpose-built Healthcare ERP/CRM — **Mais Saúde 360** — that automates scheduling, patient management, billing, and internal operations, while retaining WhatsApp as a structured, trackable communication channel.

---

## 2. Current State Analysis

### 2.1 Website CTA Audit

| CTA Label | Location | Destination | Issue |
|---|---|---|---|
| Agendar Consulta | Hero banner (primary button) | WhatsApp wa.link/8jooz1 | No structured data captured |
| Agenda a sua consulta | Hero section (secondary) | WhatsApp API +238 522 42 00 | No calendar, no confirmation |
| Entre em Contato | About Us section | Contact page → WhatsApp | Manual routing required |
| Agendar Consulta | Health Plans section | WhatsApp API +238 522 42 00 | No plan selection flow |
| Saiba Mais (Consultas) | Specialty listing | Internal page only | No booking from listing |
| Saiba Mais (Exames) | Exam listing | Internal page only | No exam request form |
| WhatsApp floating widget | All pages (bottom-right) | WhatsApp chat | Untracked conversations |
| Newsletter form | Footer | Email only | Not linked to CRM |

### 2.2 Pain Points Identified

#### Operational Pain Points
- No-show risk with zero automated reminders or confirmations
- Double-booking possible as appointments are tracked manually or not at all
- Staff context-switching between WhatsApp, phone calls, and paper registers
- Health plan subscribers have no self-service portal for appointments or history
- Home-visit scheduling requires extra coordination with no route optimisation

#### Clinical Pain Points
- No centralised patient history — doctors have no prior visit context
- Exam results cannot be digitally delivered or archived per patient
- Referral tracking between specialties is absent

#### Business Pain Points
- Revenue leakage from untracked consultations and unissued invoices
- No reporting on most requested services, peak hours, or patient demographics
- Health plan renewal rates are untracked, risking churn
- Marketing effectiveness (which channel drives bookings) is unmeasurable

---

## 3. Proposed Solution: Mais Saúde 360 Platform

We propose developing **Mais Saúde 360**, a cloud-based, Portuguese-language Healthcare ERP/CRM platform tailored to the clinic's service mix and the Cabo Verde digital infrastructure context. The platform will be web-based with a companion mobile app, and will integrate with WhatsApp Business API to preserve the familiar communication channel while adding structure and automation.

> **Platform Philosophy:** Keep WhatsApp as a patient-facing touchpoint — but route everything through a centralised system. Patients interact the way they already do; the clinic gains data, automation, and control.

### 3.1 Platform Modules Overview

| # | Module | Description | Priority |
|---|---|---|---|
| M1 | Smart Appointment Engine | Online booking, calendar management, automated reminders via WhatsApp/SMS/email | 🔴 Critical |
| M2 | Patient CRM | Unified patient profiles, medical history, documents, and communication history | 🔴 Critical |
| M3 | WhatsApp Integration Hub | Structured bot + live agent handoff, all conversations logged in CRM | 🔴 Critical |
| M4 | Health Plan Management | Family/corporate plan administration, renewal tracking, member portal | 🟠 High |
| M5 | Exam & Results Portal | Exam requests, result uploads, patient-facing result delivery | 🟠 High |
| M6 | Billing & Invoicing | Service billing, health plan claims, payment tracking, receipts | 🟠 High |
| M7 | Clinical Records (EMR-lite) | Consultation notes, prescriptions, referrals, exam linkage | 🟡 Medium |
| M8 | Staff & Resource Scheduler | Doctor/nurse shift management, room and equipment allocation | 🟡 Medium |
| M9 | Home Visit Manager | Home-visit requests, assignment, geo-routing, status tracking | 🟡 Medium |
| M10 | Analytics & Reporting | KPI dashboards, patient flow, revenue reports, plan analytics | 🟡 Medium |

---

## 4. Functional Requirements

### 4.1 M1 – Smart Appointment Engine

#### 4.1.1 Online Booking Widget
- Embeddable booking widget for maissaudecv.com replacing all WhatsApp CTAs
- Service selection: Consultation (by specialty), Exam, Dental, Ultrasound, Home Visit
- Doctor/provider selection with availability calendar display
- Date and time slot picker with real-time availability from system calendar
- Patient identification: new patient registration or returning patient login
- Booking confirmation via WhatsApp message, SMS, and/or email
- Optional: deposit or payment at booking for high-demand specialties

#### 4.1.2 Appointment Calendar
- Multi-view calendar: day, week, month per doctor, room, or clinic-wide
- Drag-and-drop rescheduling with automatic patient notification
- Colour-coded by service type (Cardiology, Dental, Exam, etc.)
- Buffer time rules between appointments per service type
- Recurring appointment support for health plan members

#### 4.1.3 Automated Reminders
- Configurable reminder sequence: 48h, 24h, and 2h before appointment
- Reminder channels: WhatsApp (preferred), SMS, email
- One-click confirmation/cancellation link inside reminder message
- No-show flag triggers automatic follow-up and slot release
- Waitlist management: auto-notify waitlisted patients when slot opens

---

### 4.2 M2 – Patient CRM

#### 4.2.1 Unified Patient Profile
- Patient record: full name, NIF (tax ID), date of birth, gender, nationality
- Contact info: phone (WhatsApp), secondary phone, email, residential address
- Emergency contact and primary physician fields
- Health plan membership linkage with plan details and validity
- Photo/ID document upload

#### 4.2.2 Patient History Timeline
- Chronological timeline of all interactions: appointments, exams, visits, messages
- Clinical notes attached to each appointment (EMR-lite, M7)
- Uploaded exam results and imaging reports per visit
- Billing history and outstanding balance display
- Consent forms and privacy agreements stored per patient

#### 4.2.3 Communication Log
- All WhatsApp, SMS, and email exchanges automatically logged to patient record
- Staff can add manual notes and follow-up tasks
- Tagging system: VIP, Chronic, Paediatric, Home Visit Only, etc.

---

### 4.3 M3 – WhatsApp Integration Hub

#### 4.3.1 WhatsApp Business API Bot
- Welcome menu with numbered options: Book Appointment / Exam Results / Health Plan / Talk to Staff
- Guided appointment booking flow entirely within WhatsApp (mirrors online widget)
- Exam result notification with secure download link sent via WhatsApp
- Health plan balance and next appointment query responses
- Bot language: Portuguese (pt-CV dialect support)

#### 4.3.2 Live Agent Handoff
- Any patient message can be escalated to a staff inbox with full conversation history
- Shared team inbox with assignment, notes, and resolution status
- Response time SLA tracking (target: < 30 minutes during clinic hours)
- After-hours auto-response with clinic hours and emergency contact

---

### 4.4 M4 – Health Plan Management
- Plan types: Plano Familiar (Family) and Plano Empresarial (Corporate)
- Plan creation wizard: coverage definitions, included consultations/exams, monthly fee
- Member portal: view plan details, book included services, download invoices
- Corporate plan: HR admin portal for adding/removing employees, usage reports
- Auto-renewal reminders at 30, 15, and 7 days before expiry
- Utilisation tracking: consultations and exams consumed vs. plan allowance
- Plan upsell alerts when patient frequently books services outside their plan

---

### 4.5 M5 – Exam & Results Portal
- Exam request creation linked to patient and referring doctor
- Sample/patient preparation instructions sent automatically at booking
- Lab/technician work queue view: pending, in-progress, resulted
- Result upload by authorised staff: PDF, image, DICOM viewer link
- Automatic notification to patient and referring doctor when results ready
- Patient downloads result via secure, time-limited link (WhatsApp + email)
- Result archive in patient CRM record

---

### 4.6 M6 – Billing & Invoicing
- Service price catalogue with per-service and per-plan pricing
- Auto-generate invoice at appointment check-in or discharge
- Payment methods: cash, bank transfer, health plan claim, card (future)
- Receipt generation (PDF, WhatsApp delivery)
- Health plan claim submission and tracking
- Outstanding balance dashboard and overdue patient alerts
- Monthly revenue reports by service, doctor, and plan type

---

### 4.7 M7 – Clinical Records (EMR-lite)
- Consultation note editor with SOAP format template (Subjective, Objective, Assessment, Plan)
- Diagnosis coding (ICD-10) with Portuguese descriptions
- Prescription generation with drug, dosage, and duration fields
- Referral creation: to another Mais Saúde specialty or external provider
- Access control: only assigned doctor sees clinical notes; admin sees billing only
- Read-only patient summary view for reception staff

---

### 4.8 M8 – Staff & Resource Scheduler
- Staff profiles: doctors, nurses, dental hygienists, receptionists, lab techs
- Weekly shift scheduling with availability windows per staff member
- Room and equipment calendar (ECG machine, ultrasound, dental chair, exam rooms)
- Conflict detection: alert if doctor booked while on leave or room double-booked
- Leave and absence management with approval workflow

---

### 4.9 M9 – Home Visit Manager
- Home visit request capture: patient address, reason, urgency level, preferred time
- Assignment to available doctor/nurse with geo-location display
- Visit status tracking: Assigned → Departed → At Patient → Completed
- Post-visit consultation note and billing auto-linked to patient record
- Integration with Google Maps for address validation and route display

---

### 4.10 M10 – Analytics & Reporting
- Executive dashboard: daily/weekly/monthly appointments, revenue, no-show rate
- Service mix report: which specialties/exams are most requested
- Patient demographics: age bands, residence zone, new vs. returning
- Health plan performance: active members, revenue, utilisation, churn rate
- Staff productivity: consultations per doctor, average appointment duration
- Marketing attribution: bookings originating from website, WhatsApp bot, referral
- Export to PDF and Excel

---

## 5. Non-Functional Requirements

| Category | Requirement | Target |
|---|---|---|
| Performance | Page load time | < 2 seconds on 4G connection |
| Performance | Booking flow completion | < 90 seconds end-to-end |
| Availability | System uptime | 99.5% (max 3.6 hrs downtime/month) |
| Security | Patient data encryption | AES-256 at rest, TLS 1.3 in transit |
| Security | Access control | Role-based (RBAC): Admin, Doctor, Nurse, Reception, Lab Tech, Patient |
| Compliance | Data privacy | LGPD-compatible (Brazil) as reference; Cabo Verde data protection law |
| Compliance | Health data sovereignty | Data hosted in EU or CV-compliant region |
| Usability | Language | Portuguese (primary); English (admin panel option) |
| Usability | Mobile responsiveness | Full functionality on Android & iOS browsers |
| Scalability | Concurrent users | Support 50 simultaneous users at launch; scale to 500 |
| Integrations | WhatsApp Business API | Meta-certified BSP integration |
| Integrations | Payment gateway | Vinti4 (Cabo Verde) + bank transfer support |
| Integrations | Email | SendGrid / SMTP for transactional emails |
| Backup | Data backup frequency | Daily automated backups, 30-day retention |

---

## 6. User Roles & Personas

| Role | Primary Tasks | Key Screens | Access Level |
|---|---|---|---|
| Patient | Book appointments, view results, manage health plan | Booking widget, Results portal, Plan dashboard | Self-service only |
| Receptionist | Check-in, schedule, confirm, handle walk-ins, billing | Calendar, Patient search, Billing, WhatsApp inbox | Full CRM, no clinical |
| Doctor | View schedule, write notes, prescriptions, referrals | My schedule, Patient record, EMR editor | Clinical + own schedule |
| Nurse / Tech | Home visits, exams, sample collection, results upload | Visit tracker, Exam queue, Results upload | Assigned tasks only |
| Lab Technician | Process exam requests, upload results | Exam worklist, Result upload | Exam module only |
| Clinic Admin | All modules, staff management, billing reports, settings | All dashboards, Settings, Reports | Super admin |
| Corporate HR | Manage employee health plan, view utilisation | Plan portal, Member list, Usage reports | Own plan data only |

---

## 7. Feature Requirements & Prioritisation

> Features are prioritised using the **MoSCoW method**: Must Have (🔴 High), Should Have (🟠 Medium), Could Have (🟡 Low).

| ID | Feature | Description | Priority | Effort |
|---|---|---|---|---|
| F-01 | Online Booking Widget | Embeddable multi-service booking form on website | 🔴 High | L |
| F-02 | Real-time Calendar | Shared appointment calendar with conflict detection | 🔴 High | L |
| F-03 | WhatsApp Reminders | Automated appointment reminders + confirmation CTA | 🔴 High | M |
| F-04 | Patient Profile | Unified patient record with contact and history | 🔴 High | M |
| F-05 | WhatsApp Bot | Guided booking and inquiry bot via WhatsApp API | 🔴 High | L |
| F-06 | Agent Inbox | Shared WhatsApp inbox with assignment and SLA | 🔴 High | M |
| F-07 | Check-in & Billing | Reception check-in workflow + auto invoice generation | 🔴 High | M |
| F-08 | Health Plan Admin | Plan creation, member management, renewal tracking | 🟠 Medium | L |
| F-09 | Exam Worklist | Lab/tech queue for pending and resulted exams | 🟠 Medium | M |
| F-10 | Results Portal | Patient-facing secure result delivery via WhatsApp/email | 🟠 Medium | M |
| F-11 | Clinical Notes (EMR-lite) | SOAP note editor with ICD-10 and prescriptions | 🟠 Medium | XL |
| F-12 | Home Visit Tracker | Request, assignment, geo-display, and status tracking | 🟠 Medium | M |
| F-13 | Staff Scheduler | Shift planning and resource conflict detection | 🟠 Medium | M |
| F-14 | Analytics Dashboard | KPI and revenue reporting with export | 🟠 Medium | M |
| F-15 | Member Self-Service Portal | Patient/member login to view history, results, plan | 🟡 Low | L |
| F-16 | Corporate HR Portal | HR admin view for corporate health plan management | 🟡 Low | M |
| F-17 | Vinti4 Payment Integration | Local payment gateway for online deposits and billing | 🟡 Low | XL |
| F-18 | ~~DICOM Viewer~~ | ~~In-browser imaging viewer for ultrasound/ECG files~~ | ❌ Cut | — |

**Effort Scale:** S = 1–2 weeks · M = 2–4 weeks · L = 1–2 months · XL = 2–3 months

---

## 8. Implementation Roadmap

```
Month:  1    2    3    4    5    6    7    8    9   10   11   12
        ├────────────────┤
Phase 1 │  Foundation    │
        │                ├────────────┤
Phase 2 │                │ Communication│
        │                              ├──────────────┤
Phase 3 │                              │  Clinical Ops │
        │                                             ├──────────────┤
Phase 4 │                                             │    Growth    │
```

### Phase 1 — Foundation (Months 1–3)
**Goal:** Replace WhatsApp CTAs with structured booking; establish patient data backbone.

- Online booking widget live on maissaudecv.com
- Patient CRM with unified profiles
- Shared appointment calendar with conflict detection
- WhatsApp automated reminders (48h / 24h / 2h)
- Basic billing and invoice generation
- Reception check-in workflow

### Phase 2 — Communication (Months 3–5)
**Goal:** Structure all patient communications; automate exam workflows.

- WhatsApp Business API bot (booking, FAQ, results)
- Shared agent inbox with SLA tracking
- Exam request and results portal
- Health plan management module (Family + Corporate)

### Phase 3 — Clinical Operations (Months 5–8)
**Goal:** Empower clinical staff with digital tools; manage internal resources.

- EMR-lite clinical notes (SOAP, ICD-10, prescriptions, referrals)
- Staff and resource scheduler (shifts, rooms, equipment)
- Home visit manager with geo-tracking
- Analytics dashboard v1 (appointments, revenue, no-shows)

### Phase 4 — Growth (Months 9–12)
**Goal:** Self-service for patients and corporate clients; advanced integrations.

- Patient self-service portal (history, results, plan)
- Corporate HR portal for health plan administration
- Vinti4 payment gateway integration
- Advanced analytics & BI exports
- ~~DICOM/imaging viewer for ultrasound and ECG files~~ — **cut** (F-18): the client is now CAP, a psychology clinic (rebrand, see `Docs/ARCHITECTURE.md`); there is no ultrasound/ECG imaging use case to support

---

## 9. Technical Architecture

### 9.1 Recommended Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend (Web) | React.js + Next.js 15 (App Router + Turbopack) | SSR for SEO; fast booking widget load; PWA capability for mobile |
| Mobile App | React Native | Single codebase for iOS + Android; offline-first for home visit tracking |
| Backend API | Node.js + NestJS 10 | Structured, modular; decorator-based DI; performance interceptor with per-request SQL metrics |
| Database | PostgreSQL (primary) + Redis (cache) | Relational integrity for medical records; Redis for session/queue |
| File Storage | AWS S3 or Cloudflare R2 | GDPR-compliant bucket for exam PDFs, patient documents, images |
| WhatsApp API | Meta Cloud API (BSP: Twilio or 360dialog) | Official Business API; supports bots, templates, agent handoff |
| Email / SMS | SendGrid + Africa's Talking | SendGrid for transactional email; Africa's Talking for CV/Africa SMS |
| Auth | Auth0 or Keycloak (self-hosted) | RBAC, MFA, GDPR audit logs; Keycloak for full data sovereignty |
| Hosting | AWS (eu-west-1) or Hetzner (EU) | EU region for data compliance; Hetzner lower cost for MVP |
| CI/CD | GitHub Actions + Docker + Kubernetes | Containerised deployment; zero-downtime rolling updates |

### 9.2 Integration Architecture

```
                        ┌──────────────────────────────────┐
                        │       Mais Saúde 360 Platform      │
                        │  ┌──────────┐  ┌───────────────┐  │
Patient                 │  │ Booking  │  │  Patient CRM  │  │
  │ Website CTA ───────►│  │ Engine   │  │  (PostgreSQL) │  │
  │                     │  └──────────┘  └───────────────┘  │
  │ WhatsApp ──────────►│  ┌──────────────────────────────┐  │
  │                     │  │   WhatsApp Integration Hub   │  │
  │ Mobile App ────────►│  │   (Bot + Agent Inbox)        │  │
  │                     │  └──────────────────────────────┘  │
  │                     │  ┌──────────┐  ┌───────────────┐  │
  │                     │  │ Billing  │  │  EMR / Exams  │  │
  │                     │  └──────────┘  └───────────────┘  │
  │                     └──────────────────────────────────┘
  │                               │
  │◄──── Reminders / Results ─────┤
  │◄──── Invoices / Reports ──────┤
```

All inbound WhatsApp messages are routed through the backend first, logged to CRM, then either bot-handled or escalated to the agent inbox.

---

## 10. Success Metrics & KPIs

| KPI | Current Baseline | 6-Month Target | 12-Month Target |
|---|---|---|---|
| Appointment no-show rate | Unknown (est. > 20%) | < 15% | < 10% |
| Online bookings (% of total) | 0% | 40% | 70% |
| WhatsApp avg. response time | Unknown / manual | < 45 min | < 20 min (bot + agent) |
| Patient record completeness | 0% (no system) | 80% | 95% |
| Health plan renewal rate | Unknown | > 70% | > 85% |
| Invoice-to-payment cycle time | Manual / unclear | < 48 hours | < 24 hours |
| Staff time on admin (hrs/week) | Est. 20+ hrs | < 12 hrs | < 6 hrs |
| Exam result delivery time | Manual / unclear | < 4 hours | < 2 hours (auto-notify) |
| Monthly active patients (tracked) | 0 | 100% | 100% + segmented |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|
| Staff resistance to new system | High | High | Phased rollout; hands-on training; keep WhatsApp as supplemental channel during transition |
| Unreliable internet connectivity in CV | Medium | High | Offline-capable mobile app; critical booking functions cached locally; SMS fallback |
| Patient adoption of online booking | Medium | High | WhatsApp bot as primary onramp (familiar channel); QR codes in clinic to booking widget |
| WhatsApp API approval delays (Meta) | Medium | Medium | Engage BSP early in Phase 1; use unofficial API for testing; maintain manual fallback |
| Data migration from existing records | Low | Medium | Structured import template; data audit sprint before go-live; parallel run period |
| Budget overrun on custom development | Medium | High | Consider extending open-source EMR (OpenMRS, Bahmni) to reduce build cost |
| Regulatory / data privacy gaps | Low | High | Engage local legal counsel on CV health data law; document all consent flows |

---

## 12. Build vs. Buy: Open Source Alternatives

Before committing to full custom development, the following open-source healthcare platforms should be evaluated as accelerators:

| Platform | Best For | Gaps for Mais Saúde | Verdict |
|---|---|---|---|
| Bahmni (OpenMRS) | Full EMR + hospital management; strong in Africa/Asia | No WhatsApp bot; booking widget needs custom build | ✅ Strong base for M7 |
| Odoo (Community) | ERP: billing, CRM, scheduling modules | No clinical/medical records; heavy configuration needed | ✅ Good for M4/M6/M8 |
| HospitalRun | Lightweight clinic management, offline support | Limited speciality modules; inactive maintainership | ⚠️ Evaluate cautiously |
| Cal.com (self-hosted) | Scheduling and booking engine | Not healthcare-specific; no CRM or billing | ✅ Good for M1 only |
| **Custom (Recommended)** | All 10 modules designed around Mais Saúde workflows | Higher upfront cost; longer build time | ⭐ Best long-term fit |

> **Recommendation:** Use **Odoo Community** as the ERP backbone (billing, HR, health plans) and build custom modules for Appointment Engine, WhatsApp Integration, and EMR-lite on top. This hybrid approach reduces development time by an estimated 30–40%.

---

## 13. Next Steps & Sign-Off

### 13.1 Immediate Actions (0–30 Days)

- [ ] Stakeholder review and approval of this PRD
- [ ] Appoint internal Product Owner and IT lead from Mais Saúde management
- [ ] Obtain WhatsApp Business API access via a certified BSP (Twilio or 360dialog)
- [ ] Select development partner (agency or in-house team) and agree contract
- [ ] Set up development, staging, and production environments
- [ ] Conduct patient journey mapping workshops with reception and medical staff

### 13.2 Short-Term Actions (30–90 Days)

- [ ] Complete UI/UX wireframes for booking widget, patient CRM, and agent inbox
- [ ] Begin Phase 1 development sprint (Appointment Engine + CRM + Billing)
- [ ] Configure WhatsApp Business verified account and message templates
- [ ] Plan staff training curriculum for Phase 1 modules
- [ ] Draft patient data privacy policy and consent flows

### 13.3 Document Approval

This PRD is pending review and sign-off by:

| Role | Name | Signature | Date |
|---|---|---|---|
| Clinic Director / Medical Lead | | | |
| Administrative Manager | | | |
| IT / Development Lead | | | |
| Legal / Compliance Advisor | | | |

> Approved version to be issued as **v1.1** after feedback incorporation.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| CRM | Customer Relationship Management – system for managing patient interactions and data |
| ERP | Enterprise Resource Planning – integrated management of core business processes |
| EMR | Electronic Medical Records – digital version of a patient's clinical paper chart |
| WhatsApp BSP | Business Solution Provider – Meta-authorised partner for WhatsApp Business API access |
| RBAC | Role-Based Access Control – permissions assigned by user role, not individually |
| SOAP Notes | Medical note format: Subjective, Objective, Assessment, Plan |
| ICD-10 | International Classification of Diseases, 10th Revision – standard diagnostic codes |
| MAPA | Monitorização Ambulatória da Pressão Arterial – 24-hour blood pressure monitoring |
| HOLTER | Continuous 24–48hr cardiac rhythm monitoring device/exam |
| Vinti4 | Cabo Verde's national interbank electronic payment network |
| SLA | Service Level Agreement – defined response/resolution time commitments |
| MoSCoW | Prioritisation framework: Must Have, Should Have, Could Have, Won't Have |
| DICOM | Digital Imaging and Communications in Medicine – standard for medical imaging files |
| BSP | Business Solution Provider – certified Meta partner for WhatsApp Business API |
| PWA | Progressive Web App – web app installable on mobile with offline capability |
| SOAP | Software-as-a-Service-based healthcare record format (Subjective/Objective/Assessment/Plan) |
| NIF | Número de Identificação Fiscal – Cabo Verde tax identification number |

---

*© 2026 Mais Saúde CV · All rights reserved · Prepared by Digital Transformation Team*
*Document version 1.0 · maissaudecv.com · adm.maissaude16@gmail.com · +238 522 42 00*
