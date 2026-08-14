#!/bin/sh
# Bundled supervisor — runs the services that are CONFIGURED, in one container:
#   app (Next.js)  ·  cloudflared (tunnel)  ·  litestream (backup)  ·  garmin-sync (python)
# POSIX sh (alpine ash). The APP is the CRITICAL process: if it dies the container
# exits (restart policy recovers everything). cloudflared & garmin-sync only start
# when their config is present (so a DEV instance with blank TUNNEL_TOKEN / Garmin
# creds doesn't crash-loop them). litestream + app always run. Optional services
# run in restart-loops so a transient failure (e.g. a Garmin auth hiccup) never
# takes the whole container down.

DB_FILE="$(printf '%s' "${DATABASE_URL:-file:/data/peptides.db}" | sed 's|^file:||')"
APP_VER="$(node -p "require('/app/package.json').version" 2>/dev/null || echo unknown)"
SNAP_KEEP="${PRE_MIGRATE_KEEP:-10}"

# 0) PRE-MIGRATION SNAPSHOT.
#
# Litestream is not a rollback path for a bad migration: it replicates the bad
# write as faithfully as a good one, within its monitor interval. So take a
# labelled copy first — it is the only thing that can undo a migration which
# runs cleanly but mangles data.
#
# Only fires when there is something to migrate, so ordinary restarts stay fast.
# `migrate status` exits non-zero on pending migrations AND on drift; both
# deserve a snapshot, so the non-zero branch is the fail-safe one.
#
# NON-FATAL throughout, to match the migrate step below: a self-hosted instance
# must never be bricked by a missing backup directory. It warns loudly instead.
# Set PRE_MIGRATE_DIR to control where snapshots land.
if node node_modules/prisma/build/index.js migrate status >/dev/null 2>&1; then
  echo "[start] schema up to date — no pre-migration snapshot needed"
elif [ ! -f "$DB_FILE" ]; then
  echo "[start] no database at $DB_FILE yet (first run) — nothing to snapshot"
elif ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[start] WARNING: sqlite3 not found — migrating WITHOUT a pre-migration snapshot" >&2
else
  # /backup when the bundled compose mounts it; otherwise beside the database,
  # which is always on a writable volume.
  SNAP_DIR="${PRE_MIGRATE_DIR:-/backup/pre-migrate}"
  mkdir -p "$SNAP_DIR" 2>/dev/null || SNAP_DIR="$(dirname "$DB_FILE")/pre-migrate"
  if ! mkdir -p "$SNAP_DIR" 2>/dev/null; then
    echo "[start] WARNING: no writable snapshot directory — migrating WITHOUT a snapshot" >&2
  else
    SNAP="$SNAP_DIR/$(date +%Y%m%d-%H%M%S)-v${APP_VER}.db"
    # .backup, NOT cp: the database is in WAL mode, so copying the file alone
    # yields a torn snapshot missing everything still in the -wal.
    if sqlite3 "$DB_FILE" ".backup '$SNAP'"; then
      # .backup finalises with a checkpoint, leaving an EMPTY -wal/-shm beside
      # the destination. Drop them so the snapshot is unambiguously one
      # self-contained file. Guarded on emptiness so a non-empty WAL — which
      # WOULD be needed to restore — is never silently discarded.
      if [ ! -s "$SNAP-wal" ]; then
        rm -f "$SNAP-wal" "$SNAP-shm"
      else
        echo "[start] WARNING: $SNAP-wal is non-empty — keep it WITH the .db" >&2
      fi
      echo "[start] pre-migration snapshot -> $SNAP ($(wc -c < "$SNAP") bytes)"
      # Prune oldest, keeping the most recent $SNAP_KEEP. Runs only after a
      # successful snapshot, so a failure never deletes the last restore point.
      ls -1t "$SNAP_DIR"/*.db 2>/dev/null | tail -n +$((SNAP_KEEP + 1)) | while read -r old; do
        rm -f "$old" && echo "[start] pruned old snapshot $old"
      done
    else
      echo "[start] WARNING: pre-migration snapshot FAILED — migrating without one" >&2
      rm -f "$SNAP"
    fi
  fi
fi

# 1) Migrations (non-fatal — migrate-on-start).
node node_modules/prisma/build/index.js migrate deploy \
  || echo "[start] prisma migrate deploy skipped — starting with existing schema"

# 2) App (critical). Listens on 0.0.0.0:3000.
node server.js &
APP=$!
echo "[start] app pid=$APP"

# 2a) HEALTH GATE. "Container Up" is not "app healthy" — the server can start and
# then fail to serve. Block until /api/version answers, so a broken deploy shows
# up as a visible restart loop instead of a silently 500-ing site. Generous
# timeout for low-powered ARM NAS hardware; override with HEALTH_TIMEOUT.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_URL="http://127.0.0.1:${PORT:-3000}/api/version"
i=0
until wget -qO- "$HEALTH_URL" >/dev/null 2>&1; do
  # If the app already died there is nothing to wait for.
  if ! kill -0 "$APP" 2>/dev/null; then
    echo "[start] app exited during startup — see the log above" >&2
    exit 1
  fi
  i=$((i + 1))
  if [ "$i" -ge "$HEALTH_TIMEOUT" ]; then
    echo "[start] app did not serve $HEALTH_URL within ${HEALTH_TIMEOUT}s — exiting for restart" >&2
    kill 0 2>/dev/null
    exit 1
  fi
  sleep 1
done
echo "[start] health OK after ${i}s — $HEALTH_URL served $(wget -qO- "$HEALTH_URL" 2>/dev/null)"

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
