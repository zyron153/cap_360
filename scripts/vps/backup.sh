#!/usr/bin/env bash
# Runs ON THE VPS from cron, in the repo checkout of the environment it backs up:
#   bash scripts/vps/backup.sh <staging|prod>
#
# pg_dump | gzip into ./backups (mode 700), written to a .tmp first and gzip-tested, so a failed or
# truncated dump never looks like a valid backup (and exits non-zero). Keeps the newest KEEP
# (default 14). Named nightly-<project>-*, not <project>-*, so deploy.sh's own prune of its
# pre-deploy dumps never touches these.
# ponytail: local only — copy backups/ off the server (rclone etc.) before real patient data goes in.
set -euo pipefail

ENV_NAME=${1:?usage: backup.sh <staging|prod>}
case "$ENV_NAME" in staging | prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac
KEEP=${KEEP:-14}

cd "$(dirname "$0")/../.."
[ -f .env.prod ] || { echo ".env.prod not found in $PWD" >&2; exit 2; }

PROJECT="cap360-$ENV_NAME"
file="backups/nightly-$PROJECT-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
(umask 077 && mkdir -p backups)
trap 'rm -f "$file.tmp"' EXIT

(umask 077 && docker compose -p "$PROJECT" --env-file .env.prod -f docker-compose.prod.yml \
  exec -T postgres pg_dump -U cap -d cap </dev/null | gzip > "$file.tmp")
gzip -t "$file.tmp"
[ "$(stat -c %s "$file.tmp")" -gt 1024 ] || { echo "dump suspiciously small, refusing to keep it" >&2; exit 1; }
mv "$file.tmp" "$file"
echo "[$PROJECT] $(date -u +%FT%TZ) backup ok: $file ($(stat -c %s "$file") bytes)"

# shellcheck disable=SC2012  # names are our own timestamps, no odd characters
ls -1t backups/nightly-"$PROJECT"-*.sql.gz | tail -n +"$((KEEP + 1))" | xargs -r rm -f
