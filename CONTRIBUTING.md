# Contributing

## Setup

```bash
pnpm install
docker compose up -d          # Postgres (5434) + Redis (6379)
pnpm --filter @cap/database run db:push
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
- Prisma schema changes: `pnpm --filter @cap/database run db:generate` then `db:push` against the
  dev DB (`db:migrate` for a real migration file). A new `@relation` field needs the inverse array
  field added on the referenced model too, or Prisma's schema validation fails.
- Commit messages: no fixed format enforced, but explain *why*, not just *what*, for anything
  non-obvious — see recent commit history for the house style.
