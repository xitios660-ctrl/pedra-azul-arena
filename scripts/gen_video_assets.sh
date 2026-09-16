#!/usr/bin/env bash
# Optional: regenerate hero poster + lite mp4 (requires ffmpeg). Safe no-op if missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VID="$ROOT/frontend/public/assets/video"
SRC="$VID/baleys.mp4"
command -v ffmpeg >/dev/null || { echo "ffmpeg not found — skip"; exit 0; }
test -f "$SRC" || { echo "missing $SRC"; exit 0; }
ffmpeg -y -i "$SRC" -ss 0 -frames:v 1 -update 1 -q:v 3 "$VID/baleys-poster.jpg"
ffmpeg -y -i "$SRC" -vf "scale='min(1280,iw)':-2" -c:v libx264 -preset fast -crf 28 -an -movflags +faststart "$VID/baleys-lite.mp4"
echo "Wrote baleys-poster.jpg + baleys-lite.mp4"
