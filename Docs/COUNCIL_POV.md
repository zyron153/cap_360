# COUNCIL_POV — go-live strategy, pressure-tested by the LLM Council

> Saved 2026-10-23. **Not started** — this is the plan to implement later.
> Question put to the council: is "(1) verify the doctor-workflow work and deploy to staging → (2) docs
> housekeeping → (3) pre-go-live hardening → (4) fix the sidebar-vs-API permission mismatch" the right order
> for CAP 360? Five advisors (Contrarian, First Principles, Expansionist, Outsider, Executor) answered
> independently, reviewed each other anonymously, and the chairman synthesized the result below.
> The advisors' tooling suggestions and time estimates are opinions — not yet checked against the real VPS.

## Verdict in one line

Treat the work as a **go-live gate, not a backlog**: no real patient data until the gate below is passed. The
original order put product polish (steps 1, 2, 4) ahead of the irreversible risks (disk loss, key loss, a leak).

## Where the council agreed

- The order is backwards. Steps 1, 2 and 4 can't lose data; disk loss, key loss and a leak can.
- Backups on the same disk as the data are not backups. Off-server encrypted backups come first.
- Back up `FIELD_ENCRYPTION_KEY` off-server **and prove it works**: decrypt a note from a restored backup using
  only the escrowed key.
- "Decide on MFA" is not a decision — `SECURITY.md` already makes MFA mandatory for doctors. It is a go-live gate.
- Docs housekeeping goes last (~20 minutes).

## Where the council clashed

- **Repo exposure vs. the rest.** First Principles and the Outsider put "scrub/privatize the public repo" first;
  the Contrarian and Executor put backups first. Both are cheap, so the clash is small.
- **Make the repo private?** Several advisors suggested it, but `PROGRESS.md` (2026-10-03) records that going
  private turns off the required reviewer on the `PRODUCTION` environment on the GitHub Free plan. It is not free.
- **MFA effort:** ~1 day (Expansionist) vs ~2–3 days (Executor). Either way it blocks go-live.
- **Scope:** the Expansionist's regional-SaaS / compliance-pack / second-VPS / WhatsApp-reminder ideas were named
  the biggest blind spot by the peer reviewers — new scope for a solo developer with no off-server backup.

## Blind spots only the peer review caught

- **Operations:** no monitoring/alerting (a failed backup or dead VPS goes unnoticed); no continuity plan for a
  solo developer; no recovery targets (acceptable data loss and downtime for the clinic).
- **Legal basis:** Cabo Verde's data-protection authority (CNPD) notification/registration, patient consent and
  notice, a retention policy, who is the legal data controller vs processor. Nobody owns this today.
- **The enum migration:** `ADD VALUE` (`20261014000000_appointment_in_progress`) can't be cleanly rolled back in
  Postgres. Rehearse it against a copy of prod-shaped data first.
- **The 29 baselined high `pnpm audit` findings:** baselined, not fixed — triage which are reachable in prod.
- **A written breach-response plan:** who is told, and when (incl. CNPD).
- **Making the repo private does not undo the exposure:** the VPS IP and git history are already public; a secret
  scan of the history is needed either way.

Corrections from what the repo already has (several advisors listed these as missing):

- SSH key-only, ufw, fail2ban and unattended upgrades are **already done** on the VPS (`PROGRESS.md`, 2026-10-03).
- Clinical-note reads are **already audit-logged** (`@AuditView()`), with an admin access-log report
  (`modules/M7-clinical-records-emr.md` §3.1). What is missing is a routine review of it.

## Recommendation — the go-live gate (in order)

1. **Repo hygiene (~1–2 h).** Scan git history for secrets and rotate anything found; remove the VPS IP/layout
   from `VPS_CONFIG.md`; turn on branch protection and secret scanning with push protection (free on a public
   repo). Don't go private yet (see the reviewer-gate trade-off above).
2. **Off-server encrypted backup.** Cron `pg_dump | age -r <pubkey> | rclone` to S3-compatible storage
   (e.g. Backblaze B2); escrow the age private key **and** `FIELD_ENCRYPTION_KEY` (password manager + one printed
   copy); restore to a scratch DB and decrypt a note from it; add a failure alert for the backup job.
3. **MFA (TOTP + recovery codes)** for doctors and admin — a hard gate on going live (otplib or similar).
4. **Verify the doctor workflow.** Apply the `in_progress` migration to dev; run the clinical-note and check-in
   Playwright specs; check the agenda/editor in a browser; deploy to staging; rehearse the migration on a
   prod-shaped copy; fix the sidebar 403 → masked "404" (hide menu items the role's API refuses, and stop the
   error boundary hiding real failures).
5. **Legal/ops basics, then go live.** CNPD notification, patient consent/notice, retention policy, a short
   breach-response plan, a restore runbook someone else could follow; then seed the prod admin and do the first
   approved prod deploy. Real patient data only after this step.

**Defer:** CodeQL, the SaaS/compliance-pack ideas, WhatsApp reminders, a second VPS (revisit after go-live).
Docs housekeeping (tick the merged-branch item in `TODO.md`, refresh `PROGRESS.md`) goes last.

## The one thing to do first

Build and **test** the off-server encrypted backup — including decrypting a note from the restored copy with only
the escrowed key. It is the only item whose failure can't be undone.

## Still open (not owned by any step above)

Monitoring/uptime alerts · RTO/RPO targets · bus-factor/credential handover · routine audit-log review ·
staff offboarding · staff training and a paper fallback for go-live day · data-migration/pilot plan for the
clinic's existing records · `FIELD_ENCRYPTION_KEY` rotation (is it even possible?).
