# CAP 360 — Deployment Guide

> **Version:** 1.1 · **Date:** updated 2026-08-30 against the current implementation
> Covers: local development, staging, and production environments.

> **Implementation status:** local development (docker-compose + `pnpm dev`) is real, with several
> concrete detail differences noted inline below. **Kubernetes/Helm, Vault, and the automated
> backup/rollback procedures in §6, §7, §9, §10 are entirely aspirational** — there is no `infra/k8s/`
> directory in this repo, no Helm chart, and no Vault integration. The real CI/CD pipeline and single-VPS deploy are
> described in §0 and §5 (rewritten 2026-10-03). There is no
> `apps/whatsapp-hub` and no `apps/mobile`; the monorepo has exactly two apps, `api` and `web`.
> **2026-08-31: Keycloak has been removed** — no more `keycloak` service, no `infra/keycloak/`,
> auth is now self-hosted (argon2id + Redis sessions, see `SECURITY.md` §2). All references to it
> below have been updated.

---

## 0. Deploy runbook — one VPS, two stacks (Docker Compose + GHCR)

> **Status 2026-10-03:** pipeline, scripts and configs are written; `scripts/vps/deploy.sh` was
> rehearsed locally against Docker Desktop (migrate → up → health check → forced-failure rollback,
> see §0.8). **The VPS now exists** (Hostinger KVM 2, Ubuntu 24.04, `179.198.220.184`; hardened, Docker +
> certbot installed, `deploy` user and `/opt/cap360-*` created — see [VPS_CONFIG.md](VPS_CONFIG.md)) and the
> domain `cap360.tech` points at it with a Let's Encrypt cert already issued (§0.7). Still never run: the GitHub Actions
> workflows and the first deploy to the box. The Kubernetes material further down is superseded by this
> for the first launch.

Staging and production share **one VPS** and are fully separate stacks: own directory, own compose
project name (hence own volumes and containers), own `.env.prod`, own image-tag prefix.

| | Staging | Production |
|---|---|---|
| Directory on the VPS | `/opt/cap360-staging` | `/opt/cap360-prod` |
| Compose project (`-p`) | `cap360-staging` | `cap360-prod` |
| nginx host ports | **8080** / 8443 (`HTTP_PORT` / `HTTPS_PORT` in its `.env.prod`) | 80 / 443 (defaults) |
| Image tags | `ghcr.io/<owner>/cms-{api,web}:staging-<commit sha>` | `…:prod-<commit sha>` |
| Trigger | push to `staging`, or manual | **manual only**, from `master` |
| GitHub environment | `STAGING` | `PRODUCTION` (required reviewers) |

The compose file is the same `docker-compose.prod.yml` for both. Every command passes `-p
cap360-<env>` explicitly — the default project name is the directory name, and a mismatch with what
the stack was created with means **new, empty volumes** (an empty database) plus duplicate
containers. Containers are never published except nginx; service health is read from Docker.

### 0.1 Branch flow and workflows

| Event | Workflow | What runs |
|---|---|---|
| Pull request to `master` / `staging` / `develop` | `ci.yml` | Lint & Typecheck · Unit Tests (incl. migration drift check) · Dependency audit · Docker build check |
| Push to `master` / `develop` | `ci.yml` | same, minus the Docker check |
| Push to `staging` **or** "Run workflow" | `deploy-staging.yml` | `ci` (calls `ci.yml`) → build + push images → SSH deploy |
| "Run workflow" on `master` | `deploy-production.yml` | `guard` (master only) → `ci` → build + push → **approval** → SSH deploy with DB backup |

Deploys are gated on CI: `ci.yml` is also a reusable workflow (`workflow_call`) that both deploy
workflows run first, so a red CI blocks the deploy and a deploy only ever ships a commit that
passed. A push to `staging` is not in `ci.yml`'s own `push` list because `deploy-staging.yml`
already runs it. Production is `workflow_dispatch`-only because it isn't live; to make it fire on
merge, add `push: branches: [master]` to `deploy-production.yml` (the `PRODUCTION` reviewers still
approve every run) and drop `master` from `ci.yml`'s `push` list so CI doesn't run twice.

**Branch protection → required status checks:** `Lint & Typecheck`, `Unit Tests`, `Dependency
audit`, `Docker build check`.

Concurrency: both deploy workflows queue (`cancel-in-progress: false`) — a deploy is never
cancelled mid-rebuild or mid-SSH.

### 0.2 GitHub setup

| Where | Name | Notes |
|---|---|---|
| Environment `STAGING` (secrets) | `STAGING_VM_IP`, `STAGING_VM_USER`, `STAGING_SSH_PRIVATE_KEY` | Jobs must declare `environment:` or these resolve to empty strings |
| Environment `PRODUCTION` (secrets) | `PRODUCTION_VM_IP`, `PRODUCTION_VM_USER`, `PRODUCTION_SSH_PRIVATE_KEY` | + **Required reviewers** = the manual approval gate |
| Repo variable | `STAGING_PUBLIC_APP_URL` | e.g. `http://<vps-ip>:8080` — baked into the staging **web image** at build time and used for the non-blocking external check |
| Repo variable | `PUBLIC_APP_URL` | e.g. `http://<vps-ip>` (later `https://<domain>`) — same, for production |

No registry secrets: the build pushes to GHCR with the run's `GITHUB_TOKEN`. Changing a URL
variable needs a **rebuild** (re-run the deploy), not just a restart.

### 0.3 What a deploy does (`scripts/vps/deploy.sh <staging|prod> <image-tag>`)

The workflow SSHes in, checks out the exact commit the images were built from (detached, so any
branch can be deployed by hand) and runs the script from that checkout:

1. `docker compose pull api web` (skip with `SKIP_PULL=1`).
2. `up -d --wait postgres redis`.
3. **Prod only (`BACKUP=1`)**: `pg_dump | gzip` into `backups/cap360-prod-<utc>.sql.gz` (mode 700
   dir, last 7 kept). A failed or corrupt dump aborts the deploy before anything changes.
4. `run --rm migrate` — `prisma migrate deploy` + the idempotent audit-log trigger SQL. **Before** the
   services are recreated, so new code never queries columns that don't exist yet, and a failing
   migration leaves the running stack untouched. Never `db push`, never `--accept-data-loss`.
5. `up -d --remove-orphans`, then **`restart nginx`** — nginx resolves `upstream` hostnames once at
   startup, so without this the recreated api/web have new IPs and every `/v1/*` and `/socket.io/`
   request is a 502.
6. Poll up to 180 s (`HEALTH_TIMEOUT`) until every container with a healthcheck is `healthy` **and**
   `curl http://127.0.0.1:<HTTP_PORT>/health` (nginx → API `/v1/health`) returns 200. This runs on the
   VPS, so it doesn't depend on the runner's route to the box.
7. Success → write the tag to `.deployed-tag`, keep the 3 newest images per service for this
   environment (the other environment's tag prefix is never touched).
   **Failure** (health timeout, or `up -d` itself failing because `web` depends on a healthy `api`) →
   print `compose ps` plus the log tail of every unhealthy container and of nginx, roll back to the
   tag in `.deployed-tag` (`up -d --no-deps api web` + nginx restart + re-check), and **exit 1
   either way** so the run is red. A first deploy has nothing to roll back to.

After the script, the workflow does one non-blocking `curl` of `<URL>/health` from the runner.

### 0.4 VPS prerequisites checklist

You can't verify these from CI; run them on the VPS (as root/sudo unless noted).

```bash
# 1. Docker + Compose plugin
docker --version && docker compose version          # Compose v2.20+; `curl` must exist too

# 2. Deploy user, in the docker group, with the CI public key
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "<public key matching STAGING_SSH_PRIVATE_KEY>" >> /home/deploy/.ssh/authorized_keys
# (add the PRODUCTION key too when it exists; chown deploy: + chmod 600 authorized_keys)

# 3. Deploy directories
install -d -o deploy -g deploy /opt/cap360-staging /opt/cap360-prod

# 4. Read-only deploy key so `git fetch` works non-interactively (as deploy)
ssh-keygen -t ed25519 -N "" -f ~/.ssh/cap360_deploy
cat ~/.ssh/cap360_deploy.pub     # GitHub → repo → Settings → Deploy keys → add, "Allow write access" OFF
printf 'Host github.com\n  IdentityFile ~/.ssh/cap360_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
ssh -T git@github.com            # accept the host key once
git clone git@github.com:zyron153/cap_360.git /opt/cap360-staging
git clone git@github.com:zyron153/cap_360.git /opt/cap360-prod       # when prod is created

# 5. GHCR read access (as deploy; classic PAT with only read:packages)
echo "<PAT>" | docker login ghcr.io -u <github-user> --password-stdin

# 6. Firewall: 22 plus the published nginx ports
ufw allow 22/tcp && ufw allow 80,443/tcp && ufw allow 8080,8443/tcp

# 7. Before the FIRST run: confirm nothing from this repo already exists under another name
docker compose ls && docker volume ls    # expect nothing named cap360-*; if a stack exists, STOP —
                                         # its project name must be cap360-<env> or you get empty volumes
```

Per environment, once:

```bash
cd /opt/cap360-staging                    # or /opt/cap360-prod
cp .env.prod.example .env.prod && chmod 600 .env.prod && $EDITOR .env.prod
#  - GHCR_OWNER, POSTGRES_PASSWORD, FIELD_ENCRYPTION_KEY (fresh per env; back the key up OFF the server —
#    losing it makes patient NIF/DOB and clinical notes unrecoverable), ADMIN_EMAIL/ADMIN_PASSWORD
#  - staging only: HTTP_PORT=8080, HTTPS_PORT=8443, and WEB_URL / ALLOWED_ORIGINS = http://<vps-ip>:8080
#  - NODE_ENV is fixed to `production` by the compose file (staging passes the same env validation)
```

Then trigger the first deploy (push to `staging` / "Run workflow") and create the first admin:

```bash
cd /opt/cap360-staging
export IMAGE_TAG=$(cat .deployed-tag)
docker compose -p cap360-staging --env-file .env.prod -f docker-compose.prod.yml --profile tools run --rm seed
# afterwards remove ADMIN_PASSWORD from .env.prod
```

`.env.prod` is never written by the deploy and never in git. **Changing it needs a recreate, not a
restart** (`restart` keeps the env from container creation time and silently ignores the edit):
`docker compose … up -d --force-recreate api` (or `web`).

### 0.5 Manual deploy, rollback, day-to-day

A shell helper makes the commands short (staging shown; use `prod` / `/opt/cap360-prod` for prod):

```bash
cd /opt/cap360-staging
dc() { docker compose -p cap360-staging --env-file .env.prod -f docker-compose.prod.yml "$@"; }
export IMAGE_TAG=$(cat .deployed-tag)   # the tag that is currently deployed

dc ps                                   # status + health
dc logs -f --tail 100 api               # also: web, nginx, postgres, migrate
curl -i http://127.0.0.1:8080/health    # through nginx, same probe the deploy uses
```

**Manual deploy** (no GitHub run; the images for that commit must already exist in GHCR, i.e. a CI
run built them):

```bash
git fetch --prune origin && git checkout --detach <commit-sha>
bash scripts/vps/deploy.sh staging staging-<commit-sha>        # prod: BACKUP=1 bash … prod prod-<sha>
```

**Manual rollback** — images only, no rebuild. List what is still on the box (3 per service are kept):

```bash
docker image ls 'ghcr.io/*/cms-api' --format '{{.Tag}}\t{{.CreatedAt}}'
export IMAGE_TAG=staging-<previous-sha>
dc up -d --no-deps api web && dc restart nginx && echo "$IMAGE_TAG" > .deployed-tag
curl -fsS http://127.0.0.1:8080/health
```

`--no-deps` is deliberate: it skips the `migrate` service, whose older image may not know the newer
migrations. To redeploy an older commit through the pipeline instead, "Run workflow" on that branch
(staging) — production only deploys the tip of `master`.

**Prod database restore** (from a pre-deploy dump): stop the api first (`dc stop api web`), then
`gunzip -c backups/<file>.sql.gz | dc exec -T postgres psql -U cap -d cap` into an **empty** database
(recreate it, or restore into a scratch project first — practice this before it's needed).

### 0.6 Known limits

- **DB schema changes are NOT rolled back.** A rollback restores the previous images against the
  newer schema, so every production migration must be backward compatible with the previous release
  (add columns/tables first, remove them a release later). Prod's pre-deploy dump is the escape hatch.
- A rollback also leaves the *new* `docker-compose.prod.yml` / nginx config in place (only images
  change). Config-breaking changes need a manual fix.
- Backups are local to the VPS (last 7 pre-deploy dumps, prod only). There is no nightly or off-server
  backup yet — needed before real patient data goes in (see Known gaps).
- SSH host keys aren't pinned in the workflows (`appleboy/ssh-action` accepts any host key). Pin with
  its `fingerprint:` input once the VPS exists if that matters.
- No `COMPOSE_PARALLEL_LIMIT` / build retry: nothing is built on the VPS (the Prisma engine download
  happens in the GitHub runner's `docker build`; re-run the workflow if it flakes).
- CI runs Node 22 (pnpm 11 in `package.json` needs ≥ 22.13) while the Docker images run Node 20.

### 0.7 Domain and HTTPS — `cap360.tech` (prod)
Domain `cap360.tech` was claimed on 2026-10-03; **prod = `https://cap360.tech`**, staging stays on
`http://<vps-ip>:8080` (it can get `staging.cap360.tech` + a `:8443` cert later). The A record is set and the cert was issued on
2026-10-03 (expires 2027-01-01, certbot renews it). The exact order of work, with the certbot
renewal hooks, is in [VPS_CONFIG.md](VPS_CONFIG.md) Phase 9. In short:
1. DNS `A @ → <vps-ip>`; issue the cert with `certbot certonly --standalone -d cap360.tech` (certbot is
   already installed on the VPS) while nothing listens on :80, and copy `fullchain.pem` + `privkey.pem`
   into `/opt/cap360-prod/infra/nginx/certs/` (a certbot deploy hook does this on every renewal).
2. `sed 's/YOUR_DOMAIN/cap360.tech/g' infra/nginx/tls.conf.example > infra/nginx/conf.d/tls.conf`. **Do not
   edit `conf.d/app.conf`**: `tls.conf` carries the :80 → :443 redirect for the domain, while `app.conf`'s
   default server must keep answering `127.0.0.1/health` with 200 for `deploy.sh` (a blanket 301 there fails
   every deploy's health check) — and the tracked file stays unmodified so `git checkout` on deploy is clean.
3. `.env.prod`: `WEB_URL` / `ALLOWED_ORIGINS` = `https://cap360.tech`; repo variable `PUBLIC_APP_URL` =
   `https://cap360.tech`, set **before** the first prod build (the web image bakes the URL in, so changing
   it later means a rebuild).

### 0.8 Verification status and known gaps
- **Rehearsed locally (Docker Desktop, 2026-10-03):** `deploy.sh` end to end against a throwaway
  `cap360-staging` project with the **real API image** (locally built) and a stub web container (the
  real web image also builds; it just wasn't part of the run) — (1) success path: baseline `migrate
  deploy` + audit trigger, `up -d`, nginx restart, health poll, `/health` 200 through nginx, tag
  recorded; (2) a release whose API never becomes healthy: `up -d` itself fails on the dependency, the
  script rolls back to the previous tag, the stack is healthy again, `.deployed-tag` is unchanged and
  the exit code is 1. **Never executed:** the GitHub Actions workflows themselves, the GHCR
  push/pull (`SKIP_PULL=1` locally), the SSH step, the `PRODUCTION` approval gate, the `BACKUP=1`
  path, `prune`, and anything on a real VPS. `actionlint`, `shellcheck`, `bash -n` and `docker
  compose config` are clean; typecheck, lint and unit tests pass.
- **Backups:** only the prod pre-deploy dump above. Needs a nightly `pg_dump` (off-server) and a
  restore drill before real patient data goes in.
- **WhatsApp:** Meta needs a public HTTPS webhook URL — blocked on the domain.
- **MFA:** not implemented for any role (launching without it was an explicit decision).
- **Lesson (image hygiene):** dev `.env` files exist in `apps/api`, `apps/web` and `packages/database`,
  not just the root — `.dockerignore` must use `**/.env`. A first build leaked them into both images
  (never pushed). The `Docker build check` job now fails a PR whose image contains `.env*` files; to
  check by hand: `docker run --rm --entrypoint sh <img> -c 'find /app -name ".env*" -not -path "*/node_modules/*"'`.

---

## 1. Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Backend + frontend runtime |
| Docker | 24+ | Containerised services |
| Docker Compose | 2.20+ | Local multi-service setup |
| kubectl | 1.28+ | K8s cluster management |
| Helm | 3.12+ | K8s chart deployments |
| GitHub Actions | — | CI/CD pipeline |
| Prisma CLI | 5+ | DB migrations |

---

## 2. Repository Structure

The real structure today:

```
Code/
├── apps/
│   ├── web/              # Next.js 15 web app                    ✅
│   └── api/              # NestJS 10 API server                  ✅
│                            (no whatsapp-hub, no mobile app — ❌ never built)
├── packages/
│   ├── database/         # @cap/database — Prisma schema + migrations
│   ├── types/            # @cap/types — Zod schemas shared across apps
│   │                        (not "shared-types")
│   └── config/           # shared tsconfig/eslint — not a UI component library;
│                            no shared React component package exists
├── infra/                # not "infrastructure/"
│   ├── docker/           # api.Dockerfile, web.Dockerfile only
│   └── nginx/            # nginx.conf
│                            (no k8s/ directory — ❌ no manifests exist;
│                             no keycloak/ either — removed 2026-08-31)
├── .github/
│   └── workflows/        # ci.yml, deploy-staging.yml, deploy-production.yml (§5)
├── scripts/vps/          # deploy.sh — runs on the VPS: migrate, up, health check, rollback (§0.3)
├── docker-compose.prod.yml  # staging + prod stack (§0)
└── docker-compose.yml    # postgres + redis, dev only
```

---

## 3. Local Development

### 3.1 Initial Setup

```bash
# Clone repo (update to the actual remote, not the placeholder below)
git clone <this repo's actual URL>
cd "Clinica Mais Saude/Code"

# Install dependencies (pnpm workspaces)
pnpm install

# Copy environment files — there is no apps/whatsapp-hub, so no third .env to copy
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Start infrastructure (PostgreSQL, Redis)
docker compose up -d postgres redis

# Push the Prisma schema — this project uses `db push`, not migrations, for day-to-day
# schema changes (see §4). One-time real migrations exist only for the initial two commits.
cd packages/database
pnpm db:generate
pnpm exec prisma db push --skip-generate

# Seed development data
pnpm db:seed

# Start all apps (hot-reload)
pnpm dev
```

### 3.2 docker-compose.yml (development services) — actual current file

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: maissaude
      POSTGRES_PASSWORD: maissaude
      POSTGRES_DB: maissaude_dev
    ports:
      - "5434:5432"   # host port 5434, not 5432 — avoids clashing with a local Postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    # no --requirepass — dev Redis has no password at all; now also holds sessions and
    # login-lockout state, not just BullMQ queues and slot locks (see SECURITY.md §10)

volumes:
  pgdata:
```

🔄 **Changed 2026-08-31:** this file used to also run a `keycloak` service (image
`quay.io/keycloak/keycloak:24.0`, importing `./infra/keycloak/cap-realm.json`) — removed along
with the rest of Keycloak. It had been reported "unhealthy" in this dev environment for 3+ days
straight before removal, for what it's worth.

### 3.3 Dev URLs

| Service | URL |
|---|---|
| Web App | http://localhost:3000 |
| API | http://localhost:3001 |
| PostgreSQL | localhost:5434 (not 5432 — see compose file above) |
| Redis | localhost:6379 |

❌ No WhatsApp Hub — that service doesn't exist.

---

## 4. Database Migrations

✅ **Since 2026-10-03 committed migrations are the source of truth.** The old history (2 files from
June, which predated most of `schema.prisma`) was replaced by a single baseline,
`packages/database/prisma/migrations/20261003000000_baseline`, generated from the schema
(`prisma migrate diff --from-empty --to-schema-datamodel`) and verified against a scratch Postgres:
`migrate deploy` applies cleanly and `migrate diff` against `schema.prisma` reports no drift. No
database existed anywhere that depended on the old files. (`.gitignore` used to ignore
`prisma/migrations/`; that rule was removed.)

```bash
# Day to day: edit schema.prisma, then
cd packages/database
pnpm db:migrate --name add_something      # prisma migrate dev: creates + applies + regenerates the client
git add prisma/migrations                  # commit the new folder with the schema change

pnpm db:migrate:prod                       # prisma migrate deploy — what CI, staging and prod run
pnpm db:reset                              # prisma migrate reset --force — DESTROYS the local DB, needs explicit permission
pnpm db:push                               # throwaway local experiments only (passes --accept-data-loss!)
```

- **CI** (`Unit Tests` job) runs `migrate deploy` on an empty Postgres, then `prisma migrate diff
  --from-url … --to-schema-datamodel schema.prisma --exit-code`: a `schema.prisma` change with no
  migration fails the build (this is what left the old migrations stale).
- **Staging/prod** run `prisma migrate deploy` in the compose `migrate` service, followed by
  `manual-sql/audit-log-immutable.sql` (the append-only trigger, which Prisma can't represent; it is
  idempotent and re-applied on every deploy). `db execute` needs an explicit `--schema`. **Never
  `db push` on staging/prod, never `--accept-data-loss`.**
- **Backward compatibility:** a rollback restores the previous images but not the schema (§0.6), so
  each migration must work with the previous release's code.
- **Existing local DB created with the old `db push` flow:** one-time `pnpm db:reset` (then
  `pnpm db:seed`; re-apply the audit trigger SQL if you rely on it locally). Mixing `db:push` with
  `db:migrate` afterwards will ask for a reset again.

---

## 5. CI/CD Pipeline (GitHub Actions)

Three workflows (details, secrets and commands in §0):

```
ci.yml                 PR to master/staging/develop, push to master/develop, and workflow_call
  quality              Lint & Typecheck  — pnpm install, turbo typecheck + lint
  audit                Dependency audit  — pnpm audit --prod; critical must stay 0, high must not
                       exceed AUDIT_BASELINE_HIGH (32 on 2026-10-03; lower it as advisories are fixed)
  test                 Unit Tests        — postgres:16 + redis:7 services, migrate deploy, migration
                       drift check against schema.prisma, then turbo test
  docker-check         Docker build check — PRs only: builds api + web (no push), fails if the image
                       contains .env files

deploy-staging.yml     push to staging + workflow_dispatch
  ci -> build (push cms-api/cms-web:staging-<sha> to GHCR) -> deploy (environment STAGING, SSH,
  scripts/vps/deploy.sh staging)

deploy-production.yml  workflow_dispatch only (production isn't live), master only
  guard -> ci -> build (…:prod-<sha>) -> deploy (environment PRODUCTION = manual approval, SSH,
  BACKUP=1 scripts/vps/deploy.sh prod)
```

Both deploy workflows gate on `ci`, queue instead of cancelling, record nothing on the runner, and
end with a non-blocking external `/health` check. Images are tagged `<env>-<commit sha>` (never a
floating tag): the web bundle bakes in an env-specific `NEXT_PUBLIC_API_URL`, so a commit built for
staging and later for prod must not share a tag. Automatic rollback is implemented in
`scripts/vps/deploy.sh` (§0.3); manual rollback in §0.5.

---

## 6. Kubernetes Deployment

❌ **Entirely aspirational.** No `infra/k8s/` directory, no Helm chart, and (per §5) the CI jobs
that would apply these manifests only `echo` a command. Treat everything below as a future plan,
not a running cluster.

### 6.1 Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: maissaude-prod
```

### 6.2 API Deployment (example)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: maissaude-prod
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: ghcr.io/maissaude/api:latest
          ports:
            - containerPort: 3001
          envFrom:
            - secretRef:
                name: api-secrets
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 5
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### 6.3 Ingress (NGINX)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: maissaude-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  tls:
    - hosts:
        - api.maissaudecv.com
        - app.maissaudecv.com
      secretName: maissaude-tls
  rules:
    - host: api.maissaudecv.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 3001
    - host: app.maissaudecv.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 3000
```

---

## 7. Backup Strategy

🟡 **Only a pre-deploy dump exists.** `scripts/vps/deploy.sh` with `BACKUP=1` (production deploys) takes
a local `pg_dump` before migrating and keeps the last 7 (§0.3). There is still no nightly job, no
off-server copy (no S3 bucket) and no restoration-test job, so treat the rest of this section as a
plan, not a running process.

### 7.1 PostgreSQL

```bash
# Automated daily backup (CronJob in K8s)
pg_dump $DATABASE_URL | gzip | \
  aws s3 cp - s3://maissaude-backups/postgres/$(date +%Y-%m-%d).sql.gz \
  --sse AES256

# Retention: 30 days
# Backup window: 02:00 UTC daily
```

### 7.2 Verification

Weekly backup restoration test to a staging database:
```bash
aws s3 cp s3://maissaude-backups/postgres/latest.sql.gz - | \
  gunzip | psql $STAGING_DATABASE_URL
```

### 7.3 Redis

Redis is used for ephemeral data (sessions, bot state, queues). No long-term backup required. BullMQ jobs are durable via Redis persistence (AOF mode enabled).

---

## 8. Health Checks

✅ `GET /health` is real (`apps/api/src/health/health.controller.ts`, public, uses NestJS
Terminus). 🟡 It only pings the database — no Redis check, no uptime field — and returns
Terminus's standard shape, not the custom one below:

```json
{
  "status": "ok",
  "info": { "database": { "status": "up" } },
  "error": {},
  "details": { "database": { "status": "up" } }
}
```

❌ No Kubernetes probes poll it (§6) and nothing calls it on a schedule. It is used by the Compose
healthchecks (`/v1/health`, on `127.0.0.1`) and by `scripts/vps/deploy.sh`, which requires 200 from
nginx's `/health` (proxied to it) after every deploy (§0.3).

---

## 9. Rollback Procedure

✅ **Real now (single-VPS Compose, not Kubernetes):** a failed health check after a deploy rolls back
automatically to the previous image tag, and `docker compose` rollback by hand is two commands. See
§0.3 (automatic) and §0.5 (manual). Limits: images only — **the DB schema is not rolled back**
(§0.6), so migrations must be backward compatible; prod has a pre-deploy `pg_dump` (§0.3, §0.5).

The `kubectl` / Helm material in §6 is aspirational; there is no cluster to roll back.

---

## 10. Environment Variables (Production Secrets)

❌ **Aspirational** — no Kubernetes Secrets, no Vault integration exists. Today, secrets are
whatever's in each app's local `.env` file (never committed — `apps/api/.env`,
`apps/web/.env.local`). The pattern below is a reasonable target for when a real cluster exists:

All secrets stored in **Kubernetes Secrets** (backed by Vault in production):

```bash
# Create secrets from .env file
kubectl create secret generic api-secrets \
  --from-env-file=apps/api/.env.production \
  -n maissaude-prod
```

Never commit `.env.production` to the repository. Use `1Password` or `Vault` for team secret sharing.

---

*CAP 360 · Deployment Guide v1.2 · updated 2026-08-31 — Keycloak removed, self-hosted auth*

## e-Fatura (DNRE) — go-live checklist

1. In the Plataforma Eletrónica: adesão, certificates, *Proprietário de Software* (software code,
   transmitter, **OAuth Redirect URI**), LED, emitter (see `EFATURA_INTEGRATION.docx`).
2. The Redirect URI must be the public https URL that reaches the API's callback through the web
   proxy: `https://<web-host>/api/efatura/oauth/callback`. The same string goes into
   *Configurações → Integrações → E-Fatura CV → Redirect URI*.
3. Redis must be available (OAuth state, access-token cache, queue) and `FIELD_ENCRYPTION_KEY` set.
4. Configure in the UI as admin, upload the certificate, press *Autorizar ligação*, start in
   **Homologação** (repository 2). To smoke-test in Principal without legal effect, switch on
   *Marcar documentos como amostra* (DNRE deletes specimens after 24 h).
5. The first invoice number of a (year, LED, type) is 1. If the LED was already used this year by
   another tool, seed `efatura_counters.lastNumber` with its last number before enabling.
6. Optional overrides (tests/staging only): `EFATURA_BASE_URL`, `EFATURA_IAM_URL`.
