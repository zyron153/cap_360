# Contributing

## Setup

```bash
pnpm install
docker compose up -d          # Postgres (5434) + Redis (6379)
pnpm --filter @cap/database run db:migrate:prod   # applies the committed migrations (migrate deploy)
pnpm --filter @cap/database run db:seed
pnpm dev                      # api on :4001, web on :3000 (turbo-orchestrated)
```

Copy `.env.example` → `.env` in the repo root and in `apps/api`/`apps/web` first — see each for
the variables that app needs.

## Before committing

A pre-commit hook (`husky` + `lint-staged`, see `lint-staged.config.js`) runs `lint` and
`typecheck` on whichever of `apps/api`, `apps/web`, or `packages/*` you touched. It only runs
against packages with staged changes, so it's normally fast — if it's slow, you likely touched a
shared `packages/*` file, which reruns the root `typecheck` (turbo-cached).

## Tests

Four tiers — see `Docs/TESTING.md` for what each one actually covers today:

```bash
pnpm test                                        # unit tests, every package
pnpm --filter @cap/api test:integration          # real dev Postgres/Redis — must be running
pnpm --filter @cap/web test:e2e                  # real dev servers — both apps must be running
```

TDD is the norm in this codebase: a failing test capturing the bug/behavior first, then the fix,
then green. New business logic in `apps/api/src/modules/**/*.service.ts` should have a matching
`*.service.spec.ts`.

## Conventions

- `packages/types` is the source of truth for request/response shapes shared by both apps — after
  changing a schema there, run `pnpm --filter @cap/types build` before `apps/api`/`apps/web` will
  see the new types (a stale build here is the most common "why won't this compile" surprise).
- Prisma schema changes need a migration file: edit `schema.prisma`, then
  `pnpm --filter @cap/database run db:migrate --name <what_changed>` (creates + applies it and
  regenerates the client) and commit the new `prisma/migrations/*` folder. CI applies the migrations
  to a fresh DB and fails if `schema.prisma` has drifted from them; staging/prod run
  `migrate deploy`, so migrations must stay backward compatible with the previous release (rollbacks
  don't undo the schema). `db:push` (which passes `--accept-data-loss`) is for throwaway local
  experiments only — a DB touched by it needs `db:reset` before `db:migrate` works again. A new
  `@relation` field needs the inverse array field added on the referenced model too, or Prisma's
  schema validation fails.
- Branches and deploys: open PRs against `master` (CI runs). A push to `staging` deploys staging. Production ships from the
  `prod` branch: `git push origin master:prod` (fast-forward from a green `master`) or a manual run on `prod`; the
  `PRODUCTION` environment's reviewer approves every run. See `Docs/DEPLOYMENT.md` §0.1.
- Existing local DB created with the old `db push` flow? One-time: `pnpm --filter @cap/database run
  db:reset` (destroys local data), then `db:seed`.
- Commit messages: no fixed format enforced, but explain *why*, not just *what*, for anything
  non-obvious — see recent commit history for the house style.
