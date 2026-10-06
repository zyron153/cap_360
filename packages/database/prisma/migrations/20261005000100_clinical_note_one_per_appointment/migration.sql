-- One clinical note per appointment per clinician. The editor creates a note on first autosave, and a
-- second tab (or a reload before the first save returned) used to create a second one.
--
-- Defensive: before this release the UI never linked a note to an appointment, so duplicates can only
-- exist if someone called the API directly. Detach (never delete) any later duplicate from its
-- appointment so the unique index below can always be created and no note is lost.
UPDATE "clinical_notes" AS n
SET "appointmentId" = NULL
WHERE n."appointmentId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "clinical_notes" AS o
    WHERE o."appointmentId" = n."appointmentId"
      AND o."authorStaffId" = n."authorStaffId"
      AND (o."createdAt", o."id") < (n."createdAt", n."id")
  );

-- Rows with a NULL appointmentId never conflict: NULLs are distinct in a Postgres unique index.
CREATE UNIQUE INDEX "clinical_notes_appointmentId_authorStaffId_key" ON "clinical_notes"("appointmentId", "authorStaffId");
