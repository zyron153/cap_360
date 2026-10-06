-- Who checked a patient in / completed the appointment. A doctor reading another clinician's clinical notes
-- while the patient is "in treatment today" now needs someone *other than that doctor* to have put the patient
-- there, so a doctor can't unlock a patient's notes by checking them in themself. Plain columns, no foreign key
-- (same as audit_log.actorId); NULL = unknown, which covers every existing row.
ALTER TABLE "appointments" ADD COLUMN "checkedInByStaffId" VARCHAR(36),
ADD COLUMN "completedByStaffId" VARCHAR(36);
