# M3 — WhatsApp Integration Hub

> **Priority:** 🔴 Critical · **Phase:** 1–2 (Months 1–5)
> **Dependencies:** M1 (Appointments), M2 (Patient CRM), M5 (Exam Results)
> **API Provider:** Meta Cloud API via 360dialog or Twilio

---

## 1. Overview

The WhatsApp Integration Hub preserves the clinic's existing WhatsApp-first patient relationship while adding structure, automation, and data capture. All patient WhatsApp interactions are routed through the platform — whether handled by the bot or a staff member, every message is logged to the patient CRM.

For detailed bot conversation flows, see `WHATSAPP-BOT-FLOWS.md`.

> **Implementation status (2026-09-19): Phase 1 inbox built; bot FSM (§3) not built.**
> `apps/api/src/modules/whatsapp/` — signed webhook (`GET`/`POST /whatsapp/webhook`), 
> `whatsapp_conversations`/`whatsapp_messages` (bodies AES-256-GCM encrypted), the inbox API
> (list / thread / reply / assign / resolve / link patient) and a real `/whatsapp` page. Replies
> "1"/"SIM" to a reminder auto-confirm the patient's single pending appointment; anything else lands
> in the inbox for a human (a "NÃO" never auto-cancels). Free-text replies are refused once Meta's 24h
> window closes. Not built: the bot FSM (§3), SLA timers (§4.3), quick-reply templates, template
> messages for outbound reminders (they still send plain text — they only deliver inside the 24h
> window until templates are approved and wired), and the closure message on Resolve.
> Setup lives in the `integration_whatsapp` setting: `phoneNumberId`, `accessToken`, `webhookToken`
> (Meta verify token) and `appSecret` (signs webhooks). Outbound reminders/confirmations/cancellations
> are still sent by the Notifications processor, now through the shared `whatsapp-api.ts` helper.
> See `WHATSAPP_CHECKLIST.md` for what remains.

---

## 2. Architecture

```
Patient WhatsApp Message
        │
        ▼
Meta Cloud API Webhook → POST /whatsapp/webhook
        │
        ▼
Webhook Handler (NestJS)
        │
        ├─ Log message to whatsapp_messages table
        ├─ Upsert whatsapp_conversations record
        ├─ Log to communication_log (M2)
        │
        ▼
Route Decision:
  ├─ conversation.status = 'agent' → Agent Inbox (notify assigned staff)
  └─ conversation.status = 'bot' → Bot FSM Handler
        │
        ▼
Bot FSM (Redis state) → Generate response → Send via Meta API
```

---

## 3. WhatsApp Bot (Phase 2)

The bot is a Finite State Machine with Redis-backed state per phone number. See `WHATSAPP-BOT-FLOWS.md` for full flow diagrams.

**Bot Capabilities:**
- Guided appointment booking (full flow within WhatsApp)
- Exam result delivery (secure download link)
- Health plan balance and expiry query
- Appointment confirmation / cancellation from reminder messages
- Keyword-triggered escalation to human agent

**Bot Language:** Portuguese (pt-CV). Informal but professional tone. Uses emojis sparingly.

**Session timeout:** 30 minutes of inactivity resets FSM state to IDLE.

---

## 4. Shared Agent Inbox (Phase 1 — priority)

The agent inbox is available in Phase 1 for the core WhatsApp routing use case, before the full bot is built.

### 4.1 Inbox Features

- All inbound WhatsApp messages from unrecognised or unhandled conversations appear in the inbox
- Conversations listed with: patient name (if known), phone, last message preview, time, SLA countdown
- Assign conversation to a specific staff member
- Full message thread view with message timestamps and delivery status (sent / delivered / read)
- Staff reply field with optional quick-reply templates
- "Resolve" button marks conversation done; patient receives closure message
- Transfer to another agent

### 4.2 Notification

When a new conversation enters the inbox (or is assigned), the assigned staff member receives:
- In-app notification (Socket.io push)
- Optional email notification (configurable)

### 4.3 SLA Tracking

- Target response time: < 30 minutes during clinic hours
- SLA timer visible on each conversation card (green → yellow → red)
- After-hours conversations paused until next business day
- SLA breach rate reported in M10 Analytics

---

## 5. Automated Outbound Messages

| Trigger | Template | Status |
|---|---|---|
| Appointment created | `appointment_confirmation` | ✅ Real (Appointments module, not this one) |
| 48h before appointment | `appointment_reminder_48h` | ✅ Real (BullMQ job) |
| 24h before appointment | `appointment_reminder_24h` | ✅ Real (BullMQ job) |
| 2h before appointment | `appointment_reminder_2h` | ✅ Real (BullMQ job) |
| Appointment cancelled | `appointment_cancelled` | ✅ Real (`send-cancel` job, plain text) — and pending reminder jobs are cancelled |
| Exam result uploaded | `exam_result_ready` | ❌ Not sent — M5 has no result field to upload in the first place |
| Invoice issued | `invoice_receipt` | ❌ Not sent — receipts are pulled on demand, never pushed (`M6-billing-invoicing.md` §2.4) |
| Health plan expiring | `health_plan_expiring` | ✅ Real — daily 08:00 job in `NotificationsProcessor` (`M4-health-plan-management.md` §3.4) |

---

## 6. Phone Number Linking

When a patient first messages, the system attempts to link by phone number:
1. Query `patients.phone_whatsapp = inbound_phone`
2. If match → link conversation to patient, show patient name in inbox
3. If no match → create conversation with `patient_id = null`; receptionist links manually or patient registers during bot flow

---

## 7. Data Model

See `DATABASE-SCHEMA.md` → Section 4:
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_templates`

---

## 8. API Endpoints

See `API-SPEC.md` → Section 4 (WhatsApp Integration)

---

## 9. Setup Requirements

1. Meta Business Account verified
2. WhatsApp Business Account (WABA) created under clinic's Facebook Business Manager
3. BSP (360dialog or Twilio) account linked to WABA
4. Phone number (+238 522 42 00) registered and verified as WhatsApp Business number
5. Message templates submitted for Meta approval (7–10 business days)
6. Webhook URL (`https://api.maissaudecv.com/v1/whatsapp/webhook`) registered with BSP

---

## 10. Phase Delivery

| Phase | Deliverable |
|---|---|
| Phase 1 (Month 1) | Webhook receiver, message logging to CRM, basic agent inbox |
| Phase 1 (Month 2) | Outbound reminders and confirmation templates via BullMQ |
| Phase 2 (Month 3–4) | Bot FSM: booking and exam result flows |
| Phase 2 (Month 5) | Health plan query flow, SLA reporting |

---

*Module M3 · v1.2 · updated 2026-09-19 — Phase 1 inbox built*
