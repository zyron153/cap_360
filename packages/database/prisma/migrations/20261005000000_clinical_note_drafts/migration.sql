-- Clinical-note drafts: a note with a NULL "finalizedAt" is an autosaved work-in-progress. Every
-- note that exists today was written as a finished note, so back-fill them as finalized at creation
-- (keeps their 24h edit lock exactly where it was).
ALTER TABLE "clinical_notes" ADD COLUMN "finalizedAt" TIMESTAMP(3);
UPDATE "clinical_notes" SET "finalizedAt" = "createdAt";
