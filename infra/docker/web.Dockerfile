FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS builder

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Both baked in at build time (--build-arg):
#  - API_INTERNAL_URL: server-side /api rewrite target, e.g. http://api:3001
#  - NEXT_PUBLIC_API_URL: browser-facing origin for Socket.io, e.g. https://app.example.cv (nginx
#    routes /socket.io to the API)
ARG API_INTERNAL_URL=http://api:3001
ARG NEXT_PUBLIC_API_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @cap/types run build && pnpm --filter @cap/web run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
