#!/usr/bin/env bash
# Rebuild the Buy Me a Coffee cover from bmc-cover.html.
# Fetches the Teko font (SIL OFL 1.1, not committed) and renders via headless Chrome.
# Usage: ./build-cover.sh
set -euo pipefail
cd "$(dirname "$0")"

FONT="Teko.ttf"
OUT="peptide-pitstop-bmc-cover.png"
SCALE="${SCALE:-3}"   # 3x -> 3000x750

# Locate a Chromium-family binary
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)" \
  "$(command -v chromium-browser || true)"; do
  [ -x "$c" ] && CHROME="$c" && break
done
[ -n "$CHROME" ] || { echo "error: no Chrome/Chromium found" >&2; exit 1; }

# Fetch Teko variable font if missing (SIL OFL 1.1)
if [ ! -f "$FONT" ]; then
  echo "fetching Teko font..."
  curl -fsSL -o "$FONT" \
    "https://github.com/google/fonts/raw/main/ofl/teko/Teko%5Bwght%5D.ttf"
fi

echo "rendering ${OUT} at ${SCALE}x..."
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --force-device-scale-factor="$SCALE" --virtual-time-budget=2500 \
  --window-size=1000,250 --screenshot="$OUT" \
  "file://$(pwd)/bmc-cover.html"

echo "done -> $(pwd)/${OUT}"
