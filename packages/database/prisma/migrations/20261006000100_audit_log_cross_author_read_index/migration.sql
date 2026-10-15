-- The admin's cross-author read report (GET /clinical-notes/access-log) lists the audit_log rows that carry the
-- "patient in treatment today" mark (metadata.diff.after.basis), newest first. Those rows are rare (a handful among
-- every audited request), so without an index the query has to read the whole table: measured on the dev database,
-- 3,162 rows -> a sequential scan of 213 buffers, 3.3 ms, growing linearly with the table. audit_log is append-only with
-- no retention policy, so that is a trap that only gets worse.
--
-- A PARTIAL index holds just the marked rows: with it the same query (the exact SQL Prisma generates for the Json path
-- filter, verified with EXPLAIN ANALYZE) is a bitmap scan of that tiny index, 8 buffers, 0.1 ms, and its cost follows the
-- number of marks, not the size of the table. Newest-first order comes from the index, so no sort over the whole table.
--
-- Prisma cannot express a partial/expression index, and `prisma migrate diff` ignores it (checked: no drift is reported
-- with it present), so it lives here only — like the audit_log immutability trigger it is invisible to schema.prisma.
CREATE INDEX IF NOT EXISTS "audit_log_cross_author_read_idx"
  ON "audit_log" ("createdAt" DESC, "id" DESC)
  WHERE (("metadata" #> '{diff,after,basis}'::text[]) = '"patient in treatment today"'::jsonb);
