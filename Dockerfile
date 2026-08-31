FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/railway-migrate.mjs ./scripts/railway-migrate.mjs
# The standalone Next.js output only carries packages reached by application
# routes. The migration script imports postgres directly, so include it here.
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres
EXPOSE 3000
# Apply idempotent SQL migrations in Railway's private network before serving
# requests.  This is deliberately part of container start-up because Railway's
# current Dockerfile deployment does not honour the TOML pre-deploy hook.
CMD ["sh", "-c", "node scripts/railway-migrate.mjs && node server.js"]
