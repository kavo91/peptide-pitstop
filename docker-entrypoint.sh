#!/bin/sh
# Entry point for the standalone image.
#
# The container starts as root for one reason only: a freshly bind-mounted /data
# volume is owned by root, and the app runs as the unprivileged "nextjs" user
# (uid 1001) — without this it can't create the SQLite database and every request
# 500s with "Error code 14: Unable to open the database file". We fix ownership,
# then drop privileges with su-exec for everything else.
set -e

mkdir -p /data
chown -R nextjs:nodejs /data 2>/dev/null || true

# Apply pending migrations as the app user (creates the schema on a fresh volume;
# no-op on an already-migrated DB). Non-fatal: never crash-loop a working DB on a
# transient/drift error — log and start with the existing schema.
su-exec nextjs:nodejs node node_modules/prisma/build/index.js migrate deploy \
  || echo "[entrypoint] prisma migrate deploy skipped (see error above) — starting with existing schema"

# Drop to the unprivileged user for the server process.
exec su-exec nextjs:nodejs "$@"
