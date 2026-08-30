-- Makes audit_log append-only at the database level.
--
-- Why a trigger and not REVOKE UPDATE/DELETE: the app's own DB role (see POSTGRES_USER in
-- docker-compose.yml) is a Postgres superuser in this project, and superusers bypass GRANT/REVOKE
-- checks entirely — a REVOKE here would silently do nothing. Triggers, unlike privilege checks,
-- fire unconditionally for every role including superusers, so this is the safeguard that actually
-- holds if the app (or anyone with a DB console) ever issues an UPDATE/DELETE against audit_log —
-- accidentally or otherwise.
--
-- Not represented in schema.prisma (Prisma has no way to declare a trigger) and NOT reapplied by
-- `prisma db push` or `prisma migrate`. Must be re-run by hand after any fresh database
-- (new dev environment, restored backup, CI database, etc.):
--
--   Get-Content packages/database/prisma/manual-sql/audit-log-immutable.sql | docker compose exec -T -e PGPASSWORD=maissaude postgres psql -U maissaude -d maissaude_dev -v ON_ERROR_STOP=1
--
-- Safe to re-run — CREATE OR REPLACE / DROP IF EXISTS make it idempotent.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
