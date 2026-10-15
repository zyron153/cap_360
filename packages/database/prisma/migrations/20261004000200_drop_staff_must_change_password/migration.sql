-- The forced "change your temporary password on first login" flow was removed: an admin now chooses a
-- user's password when creating them (and can change it later in Gestão de Acesso), with no forced
-- change. The flag has no readers or writers any more.
ALTER TABLE "staff" DROP COLUMN "mustChangePassword";
