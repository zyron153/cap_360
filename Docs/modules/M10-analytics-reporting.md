# M10 — Analytics & Reporting

> **Priority:** 🟡 Medium · **Phase:** 3–4 (Months 6–12)
> **Dependencies:** All modules (read-only aggregation)

---

## 1. Overview

Provides the clinic's first business intelligence layer. Replaces zero visibility on patient volumes, revenue, and operational performance with real-time dashboards and exportable reports.

> **Implementation status: 🎭 UI mockup only — no backend at all.** No `/analytics/*` routes, no
> materialised views, no dashboards, no exports. The one place in the running app with real
> aggregate data is Financeiro's `GET /financeiro/summary` (expenses + income, date-ranged) — see
> `M6-billing-invoicing.md` §2.6 — which covers none of the KPIs described below. Nothing in this
> document is implemented.

---

## 2. Dashboard Views

### 2.1 Executive Dashboard (Admin)

KPI cards updated in real-time:
- Today's appointments: total, completed, no-shows, cancellations
- Today's revenue (CVE)
- This month vs. last month comparison
- Online booking rate (% booked via web/bot vs. phone/walk-in)
- Average WhatsApp response time (SLA)

### 2.2 Appointment Analytics

- Line chart: daily appointment volume (last 30/90 days)
- Bar chart: appointments by service category
- No-show rate trend
- Cancellation reasons breakdown (pie chart)
- Busiest days and hours heat map

### 2.3 Revenue Analytics

- Monthly revenue trend
- Revenue by service type (stacked bar)
- Revenue by doctor
- Revenue by payment method
- Outstanding receivables (aged: 0–30, 30–60, 60+ days)
- Health plan vs. private pay split

### 2.4 Patient Analytics

- New patients per month (trend line)
- Patient age band distribution
- Patient zone/neighbourhood distribution
- New vs. returning patient ratio
- Booking source attribution (web widget, WhatsApp bot, phone, walk-in)

### 2.5 Health Plan Analytics

- Active plans by type (Family / Corporate)
- Plan utilisation rate (avg consultations/exams used vs. included)
- Renewal rate (last 12 months)
- Churn rate and reasons
- Plans expiring in next 30 days

### 2.6 Staff Productivity

- Consultations per doctor per week/month
- Average appointment duration by service type
- Exam results turnaround time (request → result upload)
- Agent inbox SLA compliance rate

---

## 3. Data Architecture

Analytics read from **materialised views** refreshed nightly (or on-demand):
- `mv_daily_appointments` — see `DATABASE-SCHEMA.md`
- `mv_monthly_revenue`
- Additional views added per report as needed

Real-time KPIs (today's data) query live tables with date filters and appropriate indexes.

No separate data warehouse at MVP scale; revisit if data exceeds 5M rows.

---

## 4. Export Capabilities

| Format | Usage |
|---|---|
| PDF | Management reports, printable summaries |
| Excel (.xlsx) | Data export for further analysis |
| CSV | Raw data for accounting software import |

All exports triggered via `GET /analytics/export?report=...&format=...&date_from=...&date_to=...`

---

## 5. API Endpoints

See `API-SPEC.md` → Section 11 (Analytics)

---

## 6. UI Screens

| Screen | Description |
|---|---|
| Executive Dashboard | KPI overview with real-time cards and trend charts |
| Appointment Report | Filterable appointment analytics with drill-down |
| Revenue Report | Revenue breakdown with date range picker |
| Patient Demographics | Charts on patient profile and acquisition |
| Plan Performance | Health plan utilisation and renewal metrics |
| Staff Performance | Per-doctor and per-tech productivity metrics |
| Export Centre | Select report, format, date range → download |

---

## 7. Access Control

- Full dashboard access: `admin` only
- Own stats (e.g., consultations, revenue): `doctor` for their own data
- Plan usage summary: `corporate_hr` for their company plan
- No analytics access: `patient`, `nurse`, `lab_tech`

---

## 8. Phase Delivery

| Phase | Deliverable |
|---|---|
| Phase 3 (Month 6–7) | Executive dashboard, appointment and revenue analytics |
| Phase 3 (Month 8) | Patient demographics, staff productivity reports |
| Phase 4 (Month 9–12) | Health plan analytics, advanced BI exports, scheduled reports |

---

*Module M10 · v1.1 · updated 2026-08-30 against the current implementation*
