# Multi-stage build → small standalone image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Timezone: PlannedDose.scheduledAt rows are stored as local-midnight (AEST)
# epochs. node:22-alpine defaults to UTC, which reads a Monday 00:00 AEST row as
# the previous Sunday → today.ts misclassifies routine planned rows as off-grid
# rebase overrides and shows doses a day early. Node honours TZ via bundled ICU
# even though Alpine ships no tzdata package. (compose also sets TZ — this is the
# standalone-run safety net.) Override with your timezone via the compose `TZ` env.
ENV TZ=UTC
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + engines so the container can apply migrations on start.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# OpenSSL so Prisma detects the platform correctly and uses the baked
# linux-musl-openssl-3.0.x engine instead of defaulting to openssl-1.1.x and
# trying to FETCH an engine (which fails writing to root-owned dirs → the
# "Can't write to @prisma/engines" error that skipped migrate-on-start).
RUN apk add --no-cache openssl
# Give the runtime user ownership of the engine dirs so migrate deploy can write
# if it ever needs to (belt-and-suspenders alongside the openssl fix above).
RUN chown -R nextjs:nodejs node_modules/.prisma node_modules/@prisma node_modules/prisma
# Runs as root (no USER line). A freshly bind-mounted /data is root-owned, so
# running as root lets the app create the SQLite database without a permission
# error ("Error code 14: Unable to open the database file") — and root ownership
# matches typical NAS appdata. Single-user self-hosted app; root in-container is
# the conventional tradeoff here.
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Apply pending migrations (creates the schema on a fresh volume; no-op once
# migrated). Non-fatal: never crash-loop a working DB on transient/drift errors —
# log and start the server with the existing schema.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy || echo '[start] prisma migrate deploy skipped (see error above) — starting with existing schema'; exec node server.js"]
