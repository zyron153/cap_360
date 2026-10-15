-- Submissions created by the pre-direct-integration flow never reached DNRE (that flow could not work
-- against the real platform). They are marked not_required instead of being left "pending" forever,
-- so the new sweeper can never mass-submit historic invoices. Separate migration: the enum value
-- 'not_required' (added in 20261004000000_efatura_direct) cannot be used in the same transaction.
UPDATE "efatura_submissions"
SET "status" = 'not_required',
    "errorMessage" = 'Emitida antes da integração direta com a DNRE'
WHERE "status" = 'pending'
  AND "documentTypeCode" IS NULL
  AND "submittedAt" IS NULL
  AND "iud" IS NULL;
