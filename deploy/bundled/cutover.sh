#!/usr/bin/env bash
# Cut peptide-tracker over from the 2-container (app + cloudflared sidecar) setup
# to the bundled single-container image. RUN ON UNRAID.
#
#   bash /mnt/user/appdata/peptide-tracker/app-src/deploy/bundled/cutover.sh
#
# Prereq: the deploy/bundled/ files are present in the build context (app-src).
# Safe: keeps a backup of the current compose; rollback line printed at the end.
# The .env in the compose project already provides PT_FIELD_KEY / AUTH_SECRET /
# HA_WEBHOOK_URL / CLOUDFLARE_TUNNEL_TOKEN.
set -euo pipefail

PROJ=/boot/config/plugins/compose.manager/projects/peptide-tracker
SRC=/mnt/user/appdata/peptide-tracker/app-src

[ -f "$SRC/deploy/bundled/docker-compose.yml" ] || { echo "ERROR: bundled compose not found in app-src — sync deploy/bundled/ first."; exit 1; }

ts=$(date +%s)
cp "$PROJ/docker-compose.yml" "$PROJ/docker-compose.sidecar.yml.bak-$ts"
echo "[cutover] backed up current compose → docker-compose.sidecar.yml.bak-$ts"

cp "$SRC/deploy/bundled/docker-compose.yml" "$PROJ/docker-compose.yml"
echo "[cutover] installed bundled compose"

cd "$PROJ"
# --remove-orphans drops the now-absent cloudflared service (the peptide-tunnel container).
docker compose up -d --build --remove-orphans

echo
echo "[cutover] done. Containers:"
docker ps --filter name=peptide --format '  {{.Names}}\t{{.Status}}'
echo
echo "[verify] curl https://peptides.example.com/icons/icon-512.png  (expect 200 once the tunnel reconnects)"
echo "[rollback] cp \"$PROJ/docker-compose.sidecar.yml.bak-$ts\" \"$PROJ/docker-compose.yml\" && (cd \"$PROJ\" && docker compose up -d --build --remove-orphans)"
