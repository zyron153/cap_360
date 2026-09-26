FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ponytail: the runner ships the whole built workspace (not a pruned prod install) — @cap/types
# resolves from its dist/, and the Prisma CLI (db push / db execute) must exist for the migrate
# step. Slim with `pnpm deploy` if image size matters.
FROM base AS builder

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# @cap/database's "main" is raw TS (fine for dev/jest, not for plain `node`). Build the API against
# the TS source first, then compile the package to dist/ and repoint ONLY "main" (not "types") in
# the image, leaving the workspace package.json untouched for dev.
RUN pnpm --filter @cap/database run db:generate  && pnpm --filter @cap/types run build  && pnpm --filter @cap/api run build  && cd packages/database  && npx tsc src/index.ts --outDir dist --module commonjs --target es2021 --esModuleInterop --skipLibCheck --typeRoots ../../apps/api/node_modules/@types --types node  && sed -i 's#"main": "./src/index.ts"#"main": "./dist/index.js"#' package.json

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
