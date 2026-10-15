-- Clinical records hardening (M7).
--
-- 1. A note that a prescription or referral came from can't be deleted out from under it. Drafts are now deletable
--    (DELETE /clinical-notes/:id), and the old ON DELETE SET NULL would have silently detached a linked prescription
--    or referral from its note. RESTRICT makes the database refuse (the API answers 409 before it ever gets here).
-- 2. Indexes for what the lists actually do now that they are bounded pages ordered newest-first:
--    a patient's notes / prescriptions / referrals by date, a clinician's notes by date, and the two clinicalNoteId
--    foreign keys (the RESTRICT check and the "has linked records" check look rows up by them; they had no index).
--    The single-column indexes they replace are redundant (leftmost prefix of the new ones).

ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_clinicalNoteId_fkey";
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_clinicalNoteId_fkey"
  FOREIGN KEY ("clinicalNoteId") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "referrals" DROP CONSTRAINT "referrals_clinicalNoteId_fkey";
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_clinicalNoteId_fkey"
  FOREIGN KEY ("clinicalNoteId") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "clinical_notes_patientId_idx";
DROP INDEX "clinical_notes_authorStaffId_idx";
CREATE INDEX "clinical_notes_patientId_createdAt_idx" ON "clinical_notes"("patientId", "createdAt");
CREATE INDEX "clinical_notes_authorStaffId_createdAt_idx" ON "clinical_notes"("authorStaffId", "createdAt");

DROP INDEX "prescriptions_patientId_idx";
CREATE INDEX "prescriptions_patientId_issuedAt_idx" ON "prescriptions"("patientId", "issuedAt");
CREATE INDEX "prescriptions_clinicalNoteId_idx" ON "prescriptions"("clinicalNoteId");

DROP INDEX "referrals_patientId_idx";
CREATE INDEX "referrals_patientId_createdAt_idx" ON "referrals"("patientId", "createdAt");
CREATE INDEX "referrals_clinicalNoteId_idx" ON "referrals"("clinicalNoteId");
