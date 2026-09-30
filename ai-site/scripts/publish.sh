#!/usr/bin/env bash
# Headless publish: export guides + games/feed (+ best-effort live intel JSON) then wrangler deploy.
# No browser / Cloudflare UI. Requires existing wrangler OAuth login.
set -euo pipefail

# Wrangler 4 and the export scripts need Node >= 22. Fail before npm or deploy.
require_node_22() {
  local node_ver node_major
  if ! command -v node >/dev/null 2>&1; then
    echo "[publish] ERROR: node is not on PATH. Use Node >=22 (Wrangler 4 and export scripts)." >&2
    return 1
  fi
  node_ver="$(node -v 2>/dev/null || true)"
  node_major="${node_ver#v}"
  node_major="${node_major%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || [[ "$node_major" -lt 22 ]]; then
    echo "[publish] ERROR: Node ${node_ver:-unknown} is too old. Use Node >=22 (Wrangler 4 and export scripts)." >&2
    return 1
  fi
  echo "[publish] node $node_ver"
}

require_node_22

# Version gate only. Does not export or deploy.
if [[ "${1:-}" == "--check-node" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIVE_URL="${GAME_INTEL_AI_URL:-https://game-intel-ai.dyk1454683243.workers.dev}"

cd "$SITE_DIR"

echo "[publish] cwd=$SITE_DIR"
echo "[publish] 1/4 export-guides"
npm run export-guides

echo "[publish] 2/4 export-intel (best-effort; fetch failures do not abort)"
# node_modules/ is gitignored. digest/calendar/radar import mcp-server/index.js,
# which loads @modelcontextprotocol/sdk. Install from the lockfile first.
MCP_DIR="$(cd "$SITE_DIR/.." && pwd)/mcp-server"
echo "[publish] npm ci in mcp-server"
(
  cd "$MCP_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
)
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
