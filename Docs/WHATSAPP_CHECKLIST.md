# M3 — WhatsApp Hub: Implementation Checklist

> **Status 2026-09-19: Phase 1 code is done and green (490 unit tests + integration spec); what's left is external setup, templates, e2e, and the deferred items below.**
> Working checklist to finish M3. Scope = **Phase 1 slice** (receive, store, reply, assign) plus
> reminder replies. The full bot FSM is deferred (see "Out of scope").
> Specs: `modules/M3-whatsapp-integration.md`, `WHATSAPP-BOT-FLOWS.md`. Update `TODO.md` and
> `PROGRESS.md` when items close.

Legend: `[x]` done · `[ ]` to do

---

## 0. Decisions (defaults applied 2026-09-19)

- [x] **Provider** — decided: Meta Cloud API directly (matches existing `sendWhatsApp()`); no BSP
- [x] **Bot scope** — decided: inbox + "1/2" and "SIM/NÃO" replies to reminders; no booking FSM
- [x] **Encrypt message bodies at rest** (AES-256-GCM, `EncryptionService`) — decided: yes (psychology clinic)

## 1. External prerequisites (not code)

- [ ] Meta Business Account verified; WABA created
- [ ] Clinic number registered as WhatsApp Business number
- [ ] Fill the `integration_whatsapp` setting (Settings → Integrações): Phone Number ID, Access Token,
      Webhook Verify Token, App Secret (the `WHATSAPP_*` env vars in `.env.example` are not read by the code)
- [x] Add `WHATSAPP_APP_SECRET` to `.env.example` (needed for webhook signature check) — n/a: the app secret is stored in the `integration_whatsapp` setting (Settings → Integrações), not env
- [ ] Message templates submitted to Meta (7–10 business days) — reminders + confirmation first
- [ ] Public HTTPS URL for the webhook (tunnel such as ngrok for local; no staging exists yet)

## 2. Schema (`packages/database/prisma/schema.prisma`, `db push`)

- [x] `WhatsappConversation`: `phone` (unique), nullable `patientId`, `status` (`open`/`resolved` only — no
      `bot` state until the FSM exists), `assignedToId` (FK `Staff`), `lastMessageAt`, `windowExpiresAt`, indexes on `phone`, `status`
- [x] `WhatsappMessage`: `conversationId`, `direction`, `body` (encrypted if decided), `type`,
      `status` (`sent`/`delivered`/`read`/`failed`), `externalId` **unique** (dedupe), `createdAt`
- [x] Relations added to `Patient` and `Staff`
- [x] Mirror the models in `DATABASE-SCHEMA.md`

## 3. Backend — `apps/api/src/modules/whatsapp/`

**Webhook**
- [x] `GET /whatsapp/webhook` — Meta verify handshake (`hub.verify_token` → echo `hub.challenge`)
- [x] `POST /whatsapp/webhook` — `@Public()`, own `@Throttle`, raw-body access
- [x] Verify `X-Hub-Signature-256` HMAC against app secret (constant-time compare); reject on mismatch
- [x] Dedupe inbound on `externalId` (Meta retries)
- [x] Upsert conversation; set `windowExpiresAt = now + 24h` on each inbound
- [x] Link patient by phone via `normalizeCaboVerdePhone`; `patientId = null` if no match
- [x] Persist message; also write `CommunicationLog` row when a patient is linked
- [x] Handle delivery-status callbacks (`sent`/`delivered`/`read`/`failed`) → update message status
- [x] Emit Socket.io event (`whatsapp:updated`, conversation id only) for live inbox

**Outbound reply**
- [x] `POST /whatsapp/conversations/:id/messages` — free text only inside the 24h window; outside → 4xx
- [x] Reuse the config lookup from `NotificationsProcessor` (`integration_whatsapp` setting); move the
      Graph API call into a shared `WhatsappService.send()` and point the processor at it
- [x] Store outbound message with returned Meta message id; mark `failed` on error
- [x] Idempotency key on send (double-click safe), same pattern as payments/bookings

**Inbox endpoints** (roles: admin, receptionist)
- [x] `GET /whatsapp/conversations` — paginated, filter by status/assignee, last-message preview
- [x] `GET /whatsapp/conversations/:id` — thread with messages
- [x] `PATCH /whatsapp/conversations/:id/assign` — assign / transfer
- [x] `PATCH /whatsapp/conversations/:id/resolve` (+ reopen on next inbound)
- [x] `PATCH /whatsapp/conversations/:id/link-patient` — manual link for unmatched numbers
- [x] Zod schemas in `@cap/types`; `@AuditView()` on thread read (message content is sensitive)

**Reminder replies**
- [x] Inbound "1"/"SIM" → confirm the patient's next `pending` appointment
- [x] Inbound "2"/"NÃO" → route to agent inbox (do **not** auto-cancel; staff reschedules)
- [x] Ambiguous or multiple upcoming appointments → escalate to agent, no guess

**Fixes uncovered while planning**
- [ ] Outbound reminders send plain text; outside the 24h window Meta requires approved templates —
      switch reminder sends to template messages once templates are approved
- [x] Send `appointment_cancelled` on cancel (M3 §5 gap) — already existed (`send-cancel` job, plain text)

## 4. Frontend — `apps/web/app/(app)/whatsapp/`

- [x] Replace hardcoded `CONVERSATIONS` with React Query against the new endpoints
- [x] Conversation list: name/phone, preview, time, status/assignee, unread indicator
- [x] Thread view with delivery ticks (sent/delivered/read/failed)
- [x] Reply box; disabled with explanation when the 24h window is closed
- [x] Assign / transfer / resolve actions (resolve is reversible — a new inbound reopens it — so no confirm step)
- [x] Link-patient action for unmatched numbers (reuse the debounced patient search)
- [x] Live updates via Socket.io
- [x] Loading / error / empty states consistent with other pages
- [x] Remove the "Beta" badge from the sidebar entry (`isMock: true` in `sidebar.tsx`)

## 5. Tests

- [x] Unit: signature verification (valid, invalid, missing header)
- [x] Unit: inbound dedupe on `externalId`
- [x] Unit: phone linking (match, no match, erased patient with null phone) — match and no-match covered
- [x] Unit: 24h-window rule on outbound
- [x] Unit: reminder-reply routing (confirm, decline → agent, ambiguous → agent)
- [x] Integration (`apps/api/test/integration/`): signed webhook POST → conversation + message rows
- [ ] E2E (Playwright): open inbox, reply, resolve (send mocked; no real Meta call)
- [x] `pnpm --filter api exec tsc --noEmit`, lint, full jest green

## 6. Security & compliance

- [x] Webhook rejects unsigned requests (covered by tests above)
- [x] Message bodies encrypted at rest if decided; not logged in plain text
- [ ] No patient names or reasons for visit in outbound template bodies beyond what the spec lists
- [x] Right to erasure: patient soft-delete also clears or anonymizes linked conversation content
- [x] Rate limits: webhook throttle sized for Meta bursts, not the default 60/min public limit

## 7. Docs to update on completion

- [x] `modules/M3-whatsapp-integration.md` — status banner, corrected §5 table (expiry job now exists)
- [ ] `WHATSAPP-BOT-FLOWS.md` — status banner
- [x] `API-SPEC.md` — WhatsApp section
- [x] `TODO.md` — M3 section
- [x] `REVIEW.md` — M3 line
- [x] `PROGRESS.md` — overwrite for the session

## Out of scope (add when the inbox is in real use)

- Bot FSM: guided booking, exam-result delivery, health-plan query (depends on M5 for results)
- SLA timers and breach reporting (M10)
- Quick-reply templates, after-hours pausing
- SMS/email fallback channel (needs SMS infra; see M1 reminder-channel item)
