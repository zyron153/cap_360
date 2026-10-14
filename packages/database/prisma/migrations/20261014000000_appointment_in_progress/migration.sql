-- "Em curso": the doctor starts a consultation once reception has checked the patient in
-- (checked_in -> in_progress -> completed). startedAt records when.
ALTER TYPE "AppointmentStatus" ADD VALUE 'in_progress';

ALTER TABLE "appointments" ADD COLUMN "startedAt" TIMESTAMP(3);
