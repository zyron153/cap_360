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
> Backend: `apps/api/src/modules/clinical-records/` (unit tests for the service and the encrypting
> repository). Frontend: the doctor's workspace at `records/page.tsx` (day queue + history), the note
> editor at `records/note/page.tsx` (autosaved drafts), and a `ClinicalRecordsSection` on the patient
> profile page (`patients/[id]/page.tsx`).

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

No rich-text editor and no "locked notes require an unlock reason from admin" workflow — the
original spec's polish items, none of which were part of what was actually asked for. What *was*
kept: a finalized note is editable by its author for 24h (checked against `finalizedAt` in
`ClinicalRecordsService`, not a stored lock flag), and by admin at any time afterward.

**Drafts (autosave).** A note with `finalizedAt = NULL` is a draft: the editor saves it
automatically ~1.5s after typing pauses, the text sections may be empty, and it has no 24h lock.
Finalizing (`draft: false`) requires all four sections (and `riskNotes` above `none`) — one rule,
`finalNoteIssues()` in `packages/types`, shared by the create schema, the service's update merge and
the editor's Guardar button — then stamps `finalizedAt`, which starts the 24h lock. A finalized note
can't go back to draft. Drafts live server-side (encrypted like every note), not in the browser:
`localStorage` would put plaintext clinical text on a shared clinic PC and break the encryption
posture of §4. A draft is only ever visible to its author (and admin), like any note.

**Discarding a draft** (`DELETE /clinical-notes/:id` → 204). An accidental autosave used to be impossible to
remove. Rules: only the author (or admin); only a **draft** — a finalized note is a clinical record and is
never deletable (`409 NOTE_FINALIZED`, even for admin); a note the caller can't see is the usual 404 (checked
*before* the finalized 409, so the 409 can't reveal a colleague's note); a draft that a prescription or
referral refers to is kept (`409 NOTE_HAS_LINKED_RECORDS`) — never a 500. The delete is one conditional
statement (`WHERE id AND finalizedAt IS NULL AND no prescription/referral`), so a note finalized or linked a
moment earlier is never removed; and the prescription/referral foreign keys to `clinical_notes` are
`ON DELETE RESTRICT` (they were `SET NULL`, which would have silently detached a linked prescription), so
even a link created in the instant between check and delete is refused by the database (reported as the same
409). Deleting frees the `(appointmentId, authorStaffId)` slot: a new note can be started for that
appointment. Audited like any mutating request — the `DELETE` row carries `metadata.diff.before =
{ patientId, authorStaffId, appointmentId, createdAt }`, never the (encrypted) text. A save (`PATCH`) that
arrives for a draft that was discarded meanwhile — the autosave already in flight, or a stale second tab — is
a **404** (not the 500 / empty-note 409 it would otherwise be): the editor must stop saving it.

**Linked to the appointment.** The editor's `appointmentId` is set when the note is created (from
the day queue, or auto-linked when a note is started from the patient profile while that patient is
checked in with the same doctor) and validated server-side: it must exist and belong to the same
patient. It is fixed at creation (ignored on update).

**One note per appointment per clinician.** `@@unique([appointmentId, authorStaffId])` in the schema
(a plain composite unique: notes with no appointment have a NULL there and never conflict, so ad-hoc
notes are unrestricted). The editor creates the note on its first autosave, so a second tab, or a
reload before that first save returned, used to create a second note. A repeat `POST` for the same
appointment is now a **409 that carries the existing note** (draft or finalized) — it does *not*
quietly continue it, because that would overwrite whatever the other tab had written. A request that
loses a simultaneous race hits the index and gets the same 409, not a 500 (same shape as
`AppointmentsService`'s idempotency handling). Verified live with six concurrent first-saves → one
note created, five 409s. The migration detaches (never deletes) any pre-existing duplicate so the
index can always be created.

**Two tabs can't silently overwrite each other.** Every `PATCH` from the editor carries
`expectedUpdatedAt` — the `updatedAt` the tab last saw. The repository writes with
`updateMany({ where: { id, updatedAt } })`, so the check and the write are one statement (two
simultaneous saves can't both pass), and a miss answers 409 + `code: "NOTE_CHANGED"` + the note as it
is now. The editor stops autosaving, keeps what the doctor typed on screen, and **merges the two versions
three ways** (`records/_note-merge.ts`, pure and shared with the e2e tests): *base* = what this tab last
synced, *mine* = the form, *theirs* = the 409's note. Per section (motivo, observações, avaliação, plano,
risco = level + detail, tipo de sessão, duração): changed only here → kept; changed only there → taken;
changed to the same value on both sides → nothing to decide; changed differently on both → the doctor picks
one side per section in a side-by-side dialog ("Juntar as duas versões da nota": *Aplicar escolhas* stays
disabled until every section has a choice; *Decidir depois* leaves the banner with *Juntar versões*;
*Escolher a minha/guardada em todas* for bulk). When nothing needs asking it resolves by itself and a polite
status line says what was joined. A note the other tab **already finalized** is never merged into: the
editor shows what the doctor typed (copyable) and offers only *Carregar a versão guardada*. A repeat create
for an appointment is the same 409. Without `expectedUpdatedAt` a `PATCH` is unconditional (scripts, older callers).

### 2.2 Risk Flagging

`riskLevel` (`none` / `low` / `moderate` / `high`) on every note, with a required `riskNotes` free
-text field once it's above `none` (enforced when a note is *finalized* — `finalNoteIssues()`, shared by
the create schema, the service's update merge and the editor). Shown as a colored badge everywhere a note
appears (the patient page's note list, the note detail view, and the `/records` worklist) — not buried in a
paragraph of free text.

**No stale risk text.** A *final* note at level `none` carries no `riskNotes`: the service stores `NULL` when a
note is finalized or saved at `none` (lowering the level used to leave the old detail stored behind a "no
risk" badge; only the editor's `""` cleared it). A *draft* keeps what was typed — the doctor may flip the
level back. Whitespace-only `riskNotes` is stored as `NULL`, never as an empty string.

### 2.3 Prescriptions

A prescription has one or more line items (`drugName`, `dosage`, `frequency`, optional
`durationDays`/`instructions`; 1–50 lines, required text is trimmed, blank optional text is stored as `NULL`),
optionally linked to the note it came from — `clinicalNoteId` must be **the caller's own note for this
patient** (admin: any note of this patient); a missing note, a colleague's note and another patient's note
all answer the same `400`, so the field can't be used to probe which note ids exist. A new prescription
for a patient that doesn't exist or was erased is a `404` (it was a foreign-key 500). No PDF generation, no
letterhead, no "Mais Saúde signature block" — those were print-output polish from the original
spec; nothing asked for them here. Kept because this practice has prescribing capability
(consistent with the wider MD/psychiatrist affiliation).

### 2.4 Referrals

`internal` (to another CAP clinician — `targetStaffId`) or `external` (free-text
`externalProviderName`/`externalSpecialty`). A `status` (`pending` / `scheduled` / `completed` /
`declined`) tracks it forward; both the referrer and (for internal referrals) the target clinician
can update it.

*Creating.* The patient must exist and not be erased (`404`). An internal referral's `targetStaffId` must be
an **active doctor (or admin)** — the roles that can open the clinical module at all, so a nurse or
receptionist as target could neither see nor act on it — and **not the referrer** (`400`). Only the half that
belongs to the type is stored: an external referral never keeps a `targetStaffId` (it would show the referral,
and its reason, to a clinician it wasn't addressed to) and an internal one never keeps `externalProviderName`.
`clinicalNoteId` is validated like a prescription's (the caller's own note for this patient).

*Status rules* (`REFERRAL_STATUS_TRANSITIONS` in `@cap/types`, enforced by `PATCH /referrals/:id/status`):

| From | May become |
|---|---|
| `pending` | `scheduled`, `completed`, `declined` |
| `scheduled` | `pending` (scheduling undone), `completed`, `declined` |
| `completed` | — (final) |
| `declined` | `pending` (re-opened) |

Anything else is a `400` naming both states. Repeating the current status is a harmless no-op (a double click),
not an error. **Admin may correct any status** (consistent with §3: admin has no restriction). The write is a
compare-and-set on the status the caller saw, so two people moving the same referral at once can't both pass
the rules: the loser gets `409 REFERRAL_CHANGED` carrying the referral as it is now. The referrer and the
target are bound by the same table.

No automatic booking-request creation or WhatsApp notification on referral — that
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
  `corporate_hr` cross-company fix elsewhere in the app) — **except the narrow exception below**.
- **nurse / receptionist / lab_tech / corporate_hr** — no access at all. The controllers are gated
  `@Roles("admin", "doctor")` at the class level, so these roles don't even reach the
  authorship check; they 403 outright.

Referrals are an exception: both the referrer *and* an internal referral's target clinician
can see and update it (the target clinician needs to know a referral was sent to them).

### 3.1 Notes: the "treating today" read exception (decided 2026-10-05)

A doctor covering for a colleague needs the patient's history to write a good note, but under the
author-only rule they saw none of it. So, **while a patient is in treatment today** — they have an
appointment today (Cabo Verde day) whose status is `checked_in` or `completed`, **put there by someone
other than the reader** — *any doctor may read the other authors' **finalized** notes for that patient*:

- **Read-only.** Writes (`PATCH`) stay author/admin; reading never becomes writing (the service has an
  explicit `read` vs `write` mode, and a unit test pins that a colleague's note still 404s on update).
- **Finalized only.** Drafts are never shared, whatever the appointment status.
- **Not self-unlockable (2026-10-05).** The status endpoint records who checked the patient in and who
  completed the appointment. The reader qualifies only if *someone else* did either — so a doctor who books
  an appointment and checks the patient in (and completes it) all by themself reads nothing, and neither does
  one who completes straight from `confirmed`. Reception checking the patient in, or a colleague, is what
  opens it. Actor unknown (both columns NULL: a system action, or a row from before they were recorded)
  qualifies, which only ever covers the day of the deploy. The editor says so ("Foi só você a pôr este
  paciente em consulta…") instead of silently showing no history.
- **Lapses by itself** at the end of the Cabo Verde day — nothing to revoke, no new table.
- **Audited, distinguishably.** The routes are `@AuditView()` already; a read that returns another
  author's notes also records `metadata.diff.after = { basis: "patient in treatment today", … }`
  (how many notes of other authors, or which author), so those reads can be told apart in `audit_log`.
- **Scope.** `GET /patients/:id/clinical-notes` and `GET /clinical-notes/:id`. The doctor's own history
  (`GET /clinical-notes`) is still strictly "my notes", and prescriptions are unchanged. On the per-patient
  list the scope is part of the database query (own notes, plus other authors' *finalized* ones only when the
  patient is in treatment today), so a page is a page of what the reader may see — not a page filtered
  afterwards — and the mark's `otherAuthorsNotes` counts the other-author notes in the page returned.

**Admin report of cross-author reads — `GET /clinical-notes/access-log?page&limit`.** The exception is only
trustworthy if it can be reviewed, so the admin gets the audit marks as a report: newest first (ties broken by
id, so pages are stable), `limit` default 50 / max 100, a plain array of `ClinicalAccessLogEntry`
(`@cap/types`): `{ id, at, reader: { id, email, fullName }, patient: { id, fullName } | null, basis,
otherAuthorsNotes | null, note: { id, authorStaffId } | null }`. A list read (`GET /patients/:id/clinical-notes`)
has `otherAuthorsNotes` and no `note`; a by-id read has `note` and no count. `reader.fullName` is `null` when
the staff row is gone; `patient.fullName` is `null` for an erased patient; `patient` is `null` only when a by-id
read's note no longer exists. **Admin only** (method-level `@Roles("admin")`, so a doctor — even the note's
author — gets 403; the route is declared before `:id` so it isn't mistaken for a note id). It reads
`audit_log` (`action = GET` and the Json path `metadata.diff.after.basis = "patient in treatment today"`);
names are resolved in one batch query each. **Query plan:** the marks are rare, so with no index the query reads the
whole table (EXPLAIN ANALYZE on the dev DB, 3,162 rows: sequential scan, 213 buffers, 3.3 ms — and linear in the
table, which is append-only with no retention). A **partial index** `audit_log_cross_author_read_idx ON
audit_log ("createdAt" DESC, "id" DESC) WHERE metadata #> '{diff,after,basis}' = '"patient in treatment today"'`
(migration `20261006000100_audit_log_cross_author_read_index`) holds only the marked rows; with it the exact SQL
Prisma generates for the Json path filter is a bitmap scan of that index (8 buffers, 0.1 ms) whose cost follows the
number of marks, not the table. Prisma can't express a partial index and `migrate diff` ignores it (verified:
no drift). Reading the report is itself audited (`@AuditView`).

**The audit mark can't be dodged with a query string (fixed 2026-10-06).** `AuditInterceptor` used to build
`resource`/`resourceId` from `request.url` *including* the query string, so `GET /clinical-notes/<id>?x=…`
produced a `resourceId` longer than its `VarChar(36)` column, the insert failed (logged, swallowed) and the
cross-author read left no row. It now uses the path only (the full URL, query included, stays in
`metadata.url`) and truncates to the column widths as a backstop.

**Other rules.** Writing a prescription or referral needs a live patient and (for `clinicalNoteId`) the
caller's own note — §2.3/§2.4. A missing-or-not-yours note is a 404 everywhere (read, update, delete);
a reference *inside a body* that doesn't resolve to the caller's own record (`appointmentId`,
`clinicalNoteId`, a referral's `targetStaffId`) is a single 400 whatever the reason. Only `updateStatus` moves an
appointment into `checked_in`/`completed` (reschedule only accepts pending/confirmed and resets to pending;
series, public booking and the WhatsApp handler create/confirm only), so no other path can bypass the actor
recording behind the "someone other than the reader" rule.

**Residual weakness.** Two people can still arrange it: a doctor needs *someone else* to check the patient in
(a receptionist, or a colleague), so it takes a second person's action rather than one doctor's alone. It is
bounded to a day and both the status changes and the reads are audited. A stricter alternative (the author
or admin explicitly shares a patient's notes with a named doctor until a set time) was offered and not
chosen; revisit if collusion matters. The other side of the trade-off: in a clinic with no reception, a
covering doctor who checks the patient in themself will not see the colleague's notes (admin still does).
The queue's "Sem nota" chip is unaffected: it still means "no note *of yours*".

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
POST   /patients/:patientId/clinical-notes      — { …, draft?: true } saves an incomplete draft; with an
                                                          appointmentId, a repeat POST is a 409 NOTE_CHANGED carrying the
                                                          clinician's existing note — one per appointment per clinician
GET    /patients/:patientId/clinical-notes      — author-scoped (admin: all); plus other authors' finalized
                                                          notes while the patient is in treatment today (§3.1);
                                                          page/limit (default 1/100, max 100) — plain array, newest first,
                                                          a short page means "no more"
GET    /clinical-notes                          — author-scoped, across every patient ("mine"); filters:
                                                          q (patient name), riskLevel, status=draft|final,
                                                          appointmentId, from/to (YYYY-MM-DD, Cabo Verde days);
                                                          page/limit (default 1/100, max 100) — still a plain array,
                                                          newest first, a short page means "no more"
GET    /clinical-notes/access-log               — ADMIN ONLY. Cross-author reads (§3.1): page/limit (default 1/50,
                                                          max 100) → ClinicalAccessLogEntry[], newest first
GET    /clinical-notes/:id                      — the author's, admin's, or (finalized only) another author's
                                                          while the patient is in treatment today (§3.1)
PATCH  /clinical-notes/:id                      — a draft: its author, any time (draft: false finalizes it);
                                                          a final note: author within 24h of finalization, or admin.
                                                          expectedUpdatedAt → compare-and-set; 409 NOTE_CHANGED + the
                                                          current note when someone saved since (§2.1); 404 when the
                                                          draft was discarded meanwhile
DELETE /clinical-notes/:id                      — 204. Discard a DRAFT: author or admin; 404 not yours / missing;
                                                          409 NOTE_FINALIZED (a finalized note is never deletable);
                                                          409 NOTE_HAS_LINKED_RECORDS (a prescription/referral refers
                                                          to it); frees the (appointment, author) slot (§2.1)
POST   /patients/:patientId/prescriptions       — 404 patient missing/erased; 400 clinicalNoteId not the caller's own
                                                          note for this patient (§2.3)
GET    /patients/:patientId/prescriptions       — author-scoped (admin: all); page/limit as for notes
POST   /patients/:patientId/referrals           — 404 patient missing/erased; 400 bad clinicalNoteId / target is the
                                                          referrer / target not an active doctor or admin (§2.4)
GET    /patients/:patientId/referrals           — referrer or target (admin: all); page/limit as for notes
PATCH  /referrals/:id/status                    — referrer, target, or admin; transition rules in §2.4 (400 on a
                                                          forbidden move, 409 REFERRAL_CHANGED when it lost a race)
```

The three per-patient lists keep returning plain arrays (newest first); `?page=&limit=` is optional. **A patient
with more than 100 rows therefore needs the client to ask for the next page** — a full page of 100 means there
may be more. `page` is capped at 100000 and `from`/`to` must be real calendar days (`2026-13-45` is a 400; both
used to reach the database and 500).

---

## 6. UI Screens

| Screen | Where | Description |
|---|---|---|
| Clinical Records section | `patients/[id]/page.tsx` | Tabbed (Notas Clínicas / Prescrições / Referenciações) section below the patient's timeline. Notes are expandable rows (preview line, Rascunho / lock badge, risk badge, full four sections inline) with "Continuar rascunho" / "Editar"; "Nova Nota" opens the editor. Only rendered for admin/doctor — other roles never see it. |
| Note editor | `records/note/page.tsx` (`?appointmentId=` \| `?noteId=` \| `?patientId=`, optional `returnTo`) | Form + patient context side by side from `xl` (stacked, context first, below that — the shell's fixed sidebar leaves ~740px of content at 1024px). Session type defaults from the patient's last note, duration from the appointment. One-tap quick phrases per section — read from four Parametrizações groups (`FRASE_MOTIVO`, `FRASE_OBSERVACOES`, `FRASE_AVALIACAO`, `FRASE_PLANO`, admin-edited, under "Registo clínico"), each falling back to a suggested set while it has no active entries (a fresh production database starts that way: the production seed creates no reference data) — and "Repetir plano anterior". For a colleague's appointment (a doctor covering) it says their finalized notes are visible (read-only) while the patient is in treatment today, labels each earlier session and the previous plan with its author, and doesn't guess "Avaliação inicial" from an empty history. If every recorded actor on the appointment is the doctor themself, a note says why other clinicians' notes are missing. A colleague's note opened by id is read-only ("Nota de X — só leitura"). When a save loses to another tab it stops and shows the conflict banner (§2.1). Context: patient + tags, a risk alert when the last finalized note was moderate/high, the previous plan, and previous sessions. Autosaves drafts; flushes on leaving the page; warns on closing the tab with anything unsaved. Primary action is "Guardar e concluir consulta" when the appointment is `checked_in` (saves the note, then completes it with the duration in the form — same endpoint and invoice-retry banner as the queue); otherwise "Guardar nota" / "Guardar alterações". A note locked after 24h opens read-only. Ctrl+Enter triggers the primary action. |
| Registos Clínicos worklist | `records/page.tsx` | Tabbed. **"Em consulta"** (default; admin/doctor with appointments access) — the doctor's day queue: today's `checked_in` appointments (a doctor sees their own by default and can switch to "Todos" to cover for a colleague — remembered per browser; a colleague's row shows their name and no "Sem nota" chip, since notes are author-scoped and "none" would only mean "none visible to you"; admin always sees all), polled every 30s so a patient the receptionist just checked in appears without a reload, each with a note-state chip (Sem nota / Rascunho / Nota guardada) and one-tap Registar / Continuar rascunho / Ver nota, plus the inline "Concluir" (confirms duration, reuses `PATCH /appointments/:id/status`, draft invoice auto-generated, warns when the note isn't finalized). A "Concluídas hoje" section lists completed consultas the same way, so a missing note stands out. **"Histórico"** — the doctor's notes (admin: everyone's) with patient-name search, risk / state (Rascunho, Finalizadas) / period filters, a one-line preview, state badges, linking to the editor; paged 50 at a time with "Carregar mais" (search and filters run in the query, so they reach past what is loaded). See `Docs/modules/M1-smart-appointment-engine.md` §6. |

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

*Module M7 · v2.4 · updated 2026-10-04 — one note per appointment per clinician, paged history, editable quick phrases (Parametrizações), covering-doctor queue scope; v2.3 (2026-10-03) — note editor with server-side autosaved drafts, day queue + filtered history, auto-linking notes to the appointment*
