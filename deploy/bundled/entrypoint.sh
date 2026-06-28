#!/bin/sh
# Bundled supervisor — runs the services that are CONFIGURED, in one container:
#   app (Next.js)  ·  cloudflared (tunnel)  ·  litestream (backup)  ·  garmin-sync (python)
# POSIX sh (alpine ash). The APP is the CRITICAL process: if it dies the container
# exits (restart policy recovers everything). cloudflared & garmin-sync only start
# when their config is present (so a DEV instance with blank TUNNEL_TOKEN / Garmin
# creds doesn't crash-loop them). litestream + app always run. Optional services
# run in restart-loops so a transient failure (e.g. a Garmin auth hiccup) never
# takes prod down.

# 1) Migrations (non-fatal — matches the sidecar image's migrate-on-start).
node node_modules/prisma/build/index.js migrate deploy \
  || echo "[start] prisma migrate deploy skipped — starting with existing schema"

# 2) App (critical). Listens on 0.0.0.0:3000.
node server.js &
APP=$!
echo "[start] app pid=$APP"

# 3) litestream (auto-restart). Continuous SQLite backup to the /backup replica.
( while true; do
    litestream replicate -config /etc/litestream.yml
    echo "[start] litestream exited — restarting in 10s"; sleep 10
  done ) &
echo "[start] litestream started"

# 4) cloudflared (auto-restart) — ONLY if a tunnel token is configured.
if [ -n "$TUNNEL_TOKEN" ]; then
  ( while true; do
      cloudflared tunnel --no-autoupdate run
      echo "[start] cloudflared exited — restarting in 10s"; sleep 10
    done ) &
  echo "[start] cloudflared started"
else
  echo "[start] cloudflared disabled (no TUNNEL_TOKEN — e.g. dev on a LAN port)"
fi

# 5) garmin-sync (auto-restart) — ONLY if creds or a saved token are present.
if [ -n "$GARMIN_EMAIL" ] || [ -f "${TOKENS_DIR:-/tokens}/garmin_tokens.json" ]; then
  ( while true; do
      python3 /garmin-sync/sync.py
      echo "[start] garmin-sync exited — restarting in 30s"; sleep 30
    done ) &
  echo "[start] garmin-sync started"
else
  echo "[start] garmin-sync disabled (no GARMIN_EMAIL / saved token)"
fi

# 6) Supervise. Forward SIGTERM/SIGINT; tear everything down if the APP dies.
term() { kill 0 2>/dev/null; exit 0; }
trap term TERM INT
while kill -0 "$APP" 2>/dev/null; do sleep 5; done
echo "[start] app exited — shutting down container for restart"
kill 0 2>/dev/null
exit 1
