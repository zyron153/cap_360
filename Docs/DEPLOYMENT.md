# CAP 360 — Deployment Guide

> **Version:** 1.1 · **Date:** updated 2026-08-30 against the current implementation
> Covers: local development, staging, and production environments.

> **Implementation status:** local development (docker-compose + `pnpm dev`) is real, with several
> concrete detail differences noted inline below. **Kubernetes/Helm, Vault, and the automated
> backup/rollback procedures in §6, §7, §9, §10 are entirely aspirational** — there is no `infra/k8s/`
> directory in this repo, no Helm chart, and no Vault integration. The real CI/CD pipeline (§5) is
> much smaller than described, and — a genuine bug found while writing this — **its test job
> currently references the wrong package name**, likely breaking it. There is no
> `apps/whatsapp-hub` and no `apps/mobile`; the monorepo has exactly two apps, `api` and `web`.
> **2026-08-31: Keycloak has been removed** — no more `keycloak` service, no `infra/keycloak/`,
> auth is now self-hosted (argon2id + Redis sessions, see `SECURITY.md` §2). All references to it
> below have been updated.

---

## 0. Production runbook — single VPS (Docker Compose)

> **Status 2026-09-28:** structure and configs are prepared; **no VPS and no domain exist yet**,
> for either environment. Nothing below has been run against a real server. The Kubernetes
> material further down is superseded by this for the first launch.

**Pieces (all in the repo):** `infra/docker/{api,web}.Dockerfile`, `docker-compose.prod.yml`,
`infra/nginx/{nginx.conf,conf.d/app.conf,tls.conf.example}`, `.env.prod.example`, and the
`deploy-production` job in `.github/workflows/ci.yml` (push to `master` → build/push images to GHCR
→ SSH deploy → `/v1/health` smoke test; the `production` GitHub environment is the manual gate).

### 0.1 Staging — same runbook, second VPS

Push to `staging` runs the mirror job, `deploy-staging` — same build, same `docker-compose.prod.yml`,
same `.env.prod` shape, just a second VPS and no manual-approval gate (the `staging` GitHub
environment has no required reviewers, so it deploys automatically on every push). The web image is
rebuilt with a staging-specific `NEXT_PUBLIC_API_URL`, and images are tagged `:staging` instead of
`:latest`, so the two environments never share a tag.

**When the staging VPS exists:**
1. Same steps as prod §"When the VPS exists" below, on its own box: install Docker, clone the repo,
   `cp .env.prod.example .env.prod` and fill it in with the staging box's own
   `POSTGRES_PASSWORD`/`FIELD_ENCRYPTION_KEY` (generate fresh ones — never reuse prod's).
2. GitHub → repo secrets `STAGING_DEPLOY_HOST`, `STAGING_DEPLOY_USER`, `STAGING_DEPLOY_SSH_KEY`,
   `STAGING_DEPLOY_PATH`; repo variable `STAGING_PUBLIC_APP_URL`; environment `staging` (no required
   reviewers — that's what makes it auto-deploy).
3. Push to `staging` (or merge to it) to trigger the first deploy; run the `seed` profile once, same
   as prod.

**Still missing before this can run for real:** the staging VPS itself and its credentials above —
everything else (workflow, compose file, nginx config) is already in place and shared with prod.

**Stack:** postgres, redis, `migrate` (one-shot), `api`, `web`, `nginx`, plus `seed` (profile
`tools`). `migrate` runs `prisma db push` **without** `--accept-data-loss` (a destructive schema
change aborts the deploy) and applies `prisma/manual-sql/audit-log-immutable.sql` (the append-only
trigger) on every deploy — the SQL is idempotent.

### When the VPS exists
1. Install Docker + Compose plugin; create a deploy user; clone the repo to `$DEPLOY_PATH`.
2. `cp .env.prod.example .env.prod` and fill it in (generate `POSTGRES_PASSWORD` and
   `FIELD_ENCRYPTION_KEY`; **back the encryption key up off-server** — losing it makes patient NIF/DOB
   and clinical notes unrecoverable). Until a domain exists use `http://<vps-ip>` for `WEB_URL` and
   `ALLOWED_ORIGINS`.
3. GitHub → repo secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`; repo variable
   `PUBLIC_APP_URL` (used as the web build's `NEXT_PUBLIC_API_URL` and the smoke-test URL);
   environment `production` with required reviewers.
4. Make the GHCR packages readable from the server (`docker login ghcr.io` with a read-only PAT).
5. First deploy: push to `master`, or on the server
   `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`, then create the first admin:
   `docker compose --env-file .env.prod -f docker-compose.prod.yml --profile tools run --rm seed`.
   Afterwards remove `ADMIN_PASSWORD` from `.env.prod`.

### When the domain exists (enable HTTPS)
1. Point DNS at the VPS; obtain certs (e.g. certbot) into `infra/nginx/certs/` as `fullchain.pem` +
   `privkey.pem`.
2. `cp infra/nginx/tls.conf.example infra/nginx/conf.d/tls.conf`, replace `YOUR_DOMAIN`, and turn
   `conf.d/app.conf`'s server body into `return 301 https://$host$request_uri;`.
3. Update `.env.prod` (`WEB_URL`, `ALLOWED_ORIGINS` → `https://<domain>`) and the `PUBLIC_APP_URL`
   variable, redeploy (the web image bakes the URL at build time, so it must be rebuilt).

### Known gaps
- **Backups:** none configured. Needs a nightly `pg_dump` (off-server) and a restore drill before real
  patient data goes in.
- **WhatsApp:** Meta needs a public HTTPS webhook URL — blocked on the domain.
- **MFA:** not implemented for any role (launching without it was an explicit decision).
- Verified locally: both images build; the API image loads all modules and `assertProdEnv` runs;
  compose syntax (`config -q`) and nginx syntax (`nginx -t`) pass. **Never executed:** the compose
  stack end-to-end, the `migrate`/`seed` services, and the CI deploy job.
- **Lesson (image hygiene):** dev `.env` files exist in `apps/api`, `apps/web` and `packages/database`,
  not just the root — `.dockerignore` must use `**/.env`. A first build leaked them into both images
  (never pushed). After any Dockerfile/.dockerignore change, scan the image:
  `docker run --rm --entrypoint sh <img> -c 'find /app -name ".env*" -not -path "*/node_modules/*"'`.

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
│   └── workflows/        # ci.yml only — no separate security.yml
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

🟡 **This project's actual day-to-day workflow does not use `prisma migrate`.** Schema changes
during this repo's history have been applied with `prisma db push --skip-generate
--accept-data-loss` directly against the dev database — there are only **two** real migration
files, both from the initial June commits (`20260615101124_init`,
`20260618000001_add_company_public_holidays`); every schema change since (encryption columns,
recurring appointments, Financeiro, composite indexes, and more) exists in `schema.prisma` and the
live dev database but was **never captured as a migration file**. This means the migration
directory does not reflect the current schema, and `prisma migrate deploy` would not produce a
database matching `schema.prisma` today.

```bash
# What's actually used, day to day:
cd packages/database
pnpm exec prisma db push --skip-generate --accept-data-loss
pnpm db:generate   # regenerate the Prisma client after schema.prisma changes

# The migrate:* scripts exist in package.json but are not the working pattern:
pnpm db:migrate         # prisma migrate dev — unused since June
pnpm db:migrate:prod    # prisma migrate deploy — this is what CI actually calls (see §5's bug)
pnpm db:reset           # prisma migrate reset --force — DESTROYS the local DB, needs explicit permission
pnpm db:studio          # Prisma Studio
```

---

## 5. CI/CD Pipeline (GitHub Actions)

The real pipeline (`.github/workflows/ci.yml`), as of 2026-09-28, is 5 jobs on push/PR to
`master`/`staging`/`develop`:

```
quality          → pnpm install, turbo run typecheck, turbo run lint
test             → real postgres:16 + redis:7 service containers, then:
                    pnpm --filter @cap/database run db:generate
                    pnpm --filter @cap/database run db:push (test DB, see §4)
                    pnpm turbo run test
build            → docker build + push api.Dockerfile / web.Dockerfile to GHCR, tagged
                    <sha> + "latest" (from master) or <sha> + "staging" (from staging branch);
                    web image bakes in NEXT_PUBLIC_API_URL from PUBLIC_APP_URL or
                    STAGING_PUBLIC_APP_URL respectively. Only runs on push to master or staging,
                    after quality+test pass.
deploy-staging   → real SSH deploy (git pull + compose pull/up) to the staging VPS, then a
                    curl smoke-test — same shape as prod, gated by the `staging` GitHub
                    environment (no required reviewers, so it's automatic). Only on push to
                    `staging`. See Docs/DEPLOYMENT.md §0.1.
deploy-production→ real SSH deploy to the production VPS, gated by the `production` GitHub
                    environment (manual-approval reviewers). Only on push to `master`.
```

No automatic rollback exists — a rollback today means reverting the git commit and letting the
pipeline redeploy the previous image.

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

❌ **Not implemented.** No backup CronJob, no S3 bucket, no restoration-test job was found
anywhere in this repo. Treat this section as a plan, not a running process — production data today
has no documented backup path.

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

❌ No Kubernetes probes poll it (§6) — nothing in this repo currently calls it on a schedule
besides the CI smoke-test `curl` steps (§5).

---

## 9. Rollback Procedure

❌ **Aspirational** — there's no live K8s deployment to roll back (§6). A real rollback today would
mean reverting the git commit and re-running the (currently broken, §5) CI pipeline.

```bash
# Rollback API to previous image
kubectl rollout undo deployment/api -n maissaude-prod

# Rollback DB migration (if needed — use with caution)
cd packages/database
pnpm prisma migrate resolve --rolled-back <migration_name>

# Verify rollback
kubectl rollout status deployment/api -n maissaude-prod
```

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
