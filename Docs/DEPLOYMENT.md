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
│   ├── keycloak/         # cap-realm.json
│   └── nginx/            # nginx.conf
│                            (no k8s/ directory — ❌ no manifests exist)
├── .github/
│   └── workflows/        # ci.yml only — no separate security.yml
└── docker-compose.yml    # postgres + redis + keycloak, dev only
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

# Start infrastructure (PostgreSQL, Redis, Keycloak)
docker compose up -d postgres redis keycloak

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
    # no --requirepass — dev Redis has no password at all

  keycloak:
    image: quay.io/keycloak/keycloak:24.0
    command: start-dev --import-realm
    environment:
      KC_DB: dev-mem   # in-memory H2 — realm/users reset on every container restart
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    volumes:
      - ./infra/keycloak/cap-realm.json:/opt/keycloak/data/import/cap-realm.json:ro
    ports:
      - "8080:8080"

volumes:
  pgdata:
```

### 3.3 Dev URLs

| Service | URL |
|---|---|
| Web App | http://localhost:3000 |
| API | http://localhost:3001 |
| Keycloak | http://localhost:8080 |
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

The real pipeline (`.github/workflows/ci.yml`) is 4 jobs on push/PR to `main`/`develop` — no
`staging` branch:

```
quality          → pnpm install, turbo run typecheck, turbo run lint
test             → real postgres:16 + redis:7 service containers, then:
                    pnpm --filter @cms/database run db:generate     ⚠️ SEE BUG BELOW
                    pnpm --filter @cms/database run db:migrate:prod ⚠️ SEE BUG BELOW
                    pnpm turbo run test
build            → docker build + push api.Dockerfile / web.Dockerfile to GHCR
                    (only on push to main; needs quality+test to pass first)
deploy-staging   → 🎭 STUB — just `echo`s a kubectl command, doesn't run one; then a real
                    curl smoke-test against a staging URL that likely doesn't exist
deploy-production→ 🎭 STUB — same: echoes kubectl, doesn't execute it
```

> ⚠️ **Real bug found while writing this doc:** the `test` job's `db:generate` and
> `db:migrate:prod` steps target package `@cms/database` — but the package was renamed to
> `@cap/database` during the rebrand (`packages/database/package.json`). `pnpm --filter
> @cms/database ...` won't resolve to anything, so **CI likely fails or silently no-ops these two
> steps** on every run. Combined with §4's finding (the two checked-in migrations don't match the
> current schema even if `db:migrate:prod` did run), the `test` job's database is probably not in
> the state the tests assume. The workflow also still says `maissaude`/`cms` throughout
> (`POSTGRES_DB: maissaude_test`, `IMAGE_PREFIX: .../cms`) — cosmetic vs. the rebrand, but
> consistent with this file not having been touched since before it.

There is no branch called `staging`, no automatic staging deploy, no manual-approval gate, and no
automatic rollback — `deploy-staging`/`deploy-production` are placeholders that print a command
rather than run one.

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

*CAP 360 · Deployment Guide v1.1 · updated 2026-08-30 against the current implementation*
