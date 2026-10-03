#!/usr/bin/env bash
# Runs ON THE VPS, from the repo checkout, after `git pull` (see .github/workflows/deploy-*.yml).
#
#   bash scripts/vps/deploy.sh <staging|prod> <image-tag>
#
# Steps: pull images -> postgres/redis up -> [backup] -> migrate -> up -d -> restart nginx ->
# wait until healthy -> record tag. On a failed health check it rolls back to the previous tag
# (images only; the DB schema is NOT rolled back) and still exits non-zero so the run goes red.
#
# Env knobs: BACKUP=1 (pg_dump before migrating, keeps the last 7), SKIP_PULL=1 (images already
# local; used for rehearsals), HEALTH_TIMEOUT=<seconds> (default 180).
set -euo pipefail

ENV_NAME=${1:?usage: deploy.sh <staging|prod> <image-tag>}
NEW_TAG=${2:?usage: deploy.sh <staging|prod> <image-tag>}
case "$ENV_NAME" in staging | prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac

# Explicit project name: the default is the directory name, and a mismatch with what the stack was
# created with means NEW (empty) volumes and duplicate containers.
PROJECT="cap360-$ENV_NAME"
STATE_FILE=.deployed-tag
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}

[ -f .env.prod ] || { echo ".env.prod not found in $PWD (it lives on the VPS, never in git)" >&2; exit 2; }
HTTP_PORT=$(sed -n 's/^HTTP_PORT=//p' .env.prod | tail -n1 | tr -d "\"'\r")
HTTP_PORT=${HTTP_PORT:-80}

dc() { docker compose -p "$PROJECT" --env-file .env.prod -f docker-compose.prod.yml "$@"; }

PREV_TAG=$(cat "$STATE_FILE" 2>/dev/null || true)
echo "[$PROJECT] deploying $NEW_TAG (previous: ${PREV_TAG:-none}), nginx on :$HTTP_PORT"

# A shell-level IMAGE_TAG beats the one in .env.prod, so the deploy never has to write that file.
export IMAGE_TAG=$NEW_TAG

# True once every running container that defines a healthcheck reports healthy AND nginx answers
# 200 on /health (proxied to the API's /v1/health). Service ports aren't published on the host, so
# the HTTP probe goes through nginx's published port.
ready() {
  local id health
  for id in $(dc ps -q); do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
    case "$health" in healthy | none) ;; *) return 1 ;; esac
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$HTTP_PORT/health" || true)" = 200 ]
}

wait_ready() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ready; then return 0; fi
    sleep 5
  done
  return 1
}

report() {
  dc ps -a || true
  local id health
  for id in $(dc ps -q); do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
    if [ "$health" != healthy ] && [ "$health" != none ]; then
      echo "----- logs of $(docker inspect --format '{{.Name}} ({{.State.Health.Status}})' "$id") -----"
      docker logs --tail 80 "$id" 2>&1 || true
    fi
  done
  echo "----- nginx logs -----"
  dc logs --tail 40 nginx 2>&1 || true
}

backup() {
  local file
  file="backups/$PROJECT-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  (umask 077 && mkdir -p backups)
  echo "[$PROJECT] backing up database to $file"
  if ! (umask 077 && dc exec -T postgres pg_dump -U cap -d cap | gzip > "$file.tmp") || ! gzip -t "$file.tmp"; then
    rm -f "$file.tmp"
    echo "::error::database backup failed, aborting deploy (nothing has been changed)" >&2
    exit 1
  fi
  mv "$file.tmp" "$file"
  # shellcheck disable=SC2012  # names are our own timestamps, no odd characters
  ls -1t backups/"$PROJECT"-*.sql.gz | tail -n +8 | xargs -r rm -f
}

# Keep the 3 newest images per service for this environment (rollback targets); the other
# environment on this VPS uses a different tag prefix and is never touched.
prune() {
  local svc
  for svc in cms-api cms-web; do
    docker image ls --filter "reference=ghcr.io/*/$svc:$ENV_NAME-*" --format '{{.Repository}}:{{.Tag}}' \
      | tail -n +4 | xargs -r docker image rm >/dev/null 2>&1 || true
  done
}

if [ "${SKIP_PULL:-0}" != 1 ]; then dc pull api web; fi

# Schema first: if the migration fails the running api/web are still untouched, no rollback needed.
dc up -d --wait postgres redis
if [ "${BACKUP:-0}" = 1 ]; then backup; fi
dc run --rm --no-deps -T migrate

# From here on a failure means "roll back", not "abort": `web` depends on `api` being healthy, so
# for a bad release `up -d` itself exits non-zero, and set -e would skip the rollback below.
set +e
# nginx resolves `upstream` hostnames once, at its own startup. The recreated api/web have new
# container IPs, so without the restart every /v1/* and /socket.io/ request is a 502.
if dc up -d --remove-orphans && dc restart nginx && wait_ready; then
  echo "$NEW_TAG" > "$STATE_FILE"
  prune
  echo "[$PROJECT] deployed $NEW_TAG at $(date -u)"
  exit 0
fi

echo "::error::[$PROJECT] $NEW_TAG failed to start or did not become healthy (waited ${HEALTH_TIMEOUT}s)"
report

if [ -z "$PREV_TAG" ]; then
  echo "::error::no previous tag recorded in $STATE_FILE (first deploy), nothing to roll back to"
  exit 1
fi

echo "[$PROJECT] rolling back to $PREV_TAG (images only, DB schema is not rolled back)"
export IMAGE_TAG=$PREV_TAG
# --no-deps: skip the `migrate` dependency, the old image may not know the newer migrations.
dc up -d --no-deps api web
dc restart nginx
if wait_ready; then
  echo "[$PROJECT] rollback to $PREV_TAG is healthy"
else
  echo "::error::[$PROJECT] rollback to $PREV_TAG is ALSO unhealthy, manual intervention needed"
  report
fi
exit 1
