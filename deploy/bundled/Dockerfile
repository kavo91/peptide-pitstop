# BUNDLED image: Next.js app + Cloudflare tunnel + Litestream backup + Garmin
# wellness sidecar — every service in ONE container (a supervisor entrypoint
# runs them; the app is the critical process, the others auto-restart).
# An all-in-one alternative to running the services as separate compose entries.
#
# Build:
#   docker build -f deploy/bundled/Dockerfile -t peptide-pitstop:bundled .
#
# Mirrors the production Dockerfile, then layers in: the cloudflared + litestream
# static binaries, python3 + garminconnect (curl_cffi imports cleanly on
# musl/alpine — verified), the garmin sidecar source, and the supervisor.
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
# TZ keystone: set this to YOUR timezone (e.g. America/New_York) so local-midnight
# PlannedDose rows read correctly. Defaults to UTC; override via the compose `TZ` env.
# NOTE: TZ alone is NOT enough for the Python garmin-sync sidecar (or shell `date`) —
# alpine ships no zoneinfo, so without tzdata Python falls back to UTC and the sidecar's
# date.today() can lag your local day, missing the current day's activities/recovery
# before your offset clears. tzdata (installed below) fixes it; Node already honours
# TZ via bundled ICU.
ENV TZ=UTC
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + engines for migrate-on-start.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# OpenSSL so Prisma uses the baked musl-openssl-3.0.x engine (no runtime fetch).
# tzdata so the configured TZ resolves for Python (garmin-sync) + shell, not just Node.
RUN apk add --no-cache openssl tzdata
RUN chown -R nextjs:nodejs node_modules/.prisma node_modules/@prisma node_modules/prisma

# --- bundled binaries: cloudflared (tunnel) + litestream (backup), both static ---
COPY --from=cloudflare/cloudflared:latest /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=litestream/litestream:latest /usr/local/bin/litestream /usr/local/bin/litestream

# --- bundled python: garmin wellness sidecar (garminconnect/curl_cffi on musl) ---
RUN apk add --no-cache python3 py3-pip
COPY garmin-sync/requirements.txt /garmin-sync/requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r /garmin-sync/requirements.txt
COPY garmin-sync/sync.py /garmin-sync/sync.py
# Litestream config baked in (single-container; replica path provided by volume).
COPY litestream.yml /etc/litestream.yml

# --- supervisor entrypoint (runs all four; app critical, others auto-restart) ---
COPY deploy/bundled/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Supervisor: migrate → app (critical) + cloudflared + litestream + garmin-sync.
# cloudflared reads TUNNEL_TOKEN; the named tunnel's "http://app:3000" origin
# resolves to this container via compose `extra_hosts: app:127.0.0.1`.
CMD ["/entrypoint.sh"]
