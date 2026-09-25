#!/usr/bin/env bash
# Headless publish: export guides + games/feed (+ best-effort live intel JSON) then wrangler deploy.
# No browser / Cloudflare UI. Requires existing wrangler OAuth login.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIVE_URL="${GAME_INTEL_AI_URL:-https://game-intel-ai.dyk1454683243.workers.dev}"

cd "$SITE_DIR"

echo "[publish] cwd=$SITE_DIR"
echo "[publish] 1/4 export-guides"
npm run export-guides

echo "[publish] 2/4 export-intel (best-effort; failures do not abort)"
set +e
node scripts/export-intel.mjs
INTEL_RC=$?
set -e
if [[ "$INTEL_RC" -ne 0 ]]; then
  echo "[publish] WARN export-intel exited $INTEL_RC (continuing)"
fi

echo "[publish] 3/4 export-games (+ feed from digest/radar)"
npm run export-games

echo "[publish] 4/4 wrangler deploy (headless)"
set +e
npx wrangler deploy
DEPLOY_RC=$?
set -e

if [[ "$DEPLOY_RC" -ne 0 ]]; then
  echo "[publish] ERROR wrangler deploy failed exit=$DEPLOY_RC" >&2
  echo "[publish] URL (unchanged if prior deploy): $LIVE_URL"
  exit "$DEPLOY_RC"
fi

echo "[publish] OK deployed"
echo "[publish] URL: $LIVE_URL"
exit 0
