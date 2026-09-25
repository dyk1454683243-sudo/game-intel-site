#!/usr/bin/env bash
# Morning triage helper: digest + radar → jev filter_morning.
# Usage:
#   bash mcp-server/scripts/morning-triage.sh [--max 40] [--gap-ms 75] [--keep-ask-dai] [--game ID]
# Env: GAME_INTEL_DATA, PATH must include jev (optional: JEV_PATH_PREFIX).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/mcp-server/cli.js"
export PATH="${JEV_PATH_PREFIX:+$JEV_PATH_PREFIX:}${HOME}/bin:${PATH:-}"

MAX=40
GAP=75
KEEP=""
GAME=""
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max) MAX="$2"; shift 2 ;;
    --gap-ms|--gap_ms) GAP="$2"; shift 2 ;;
    --keep-ask-dai|--keep_ask_dai) KEEP="--keep-ask-dai"; shift ;;
    --game) GAME="$2"; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

DIGEST_ARGS=(digest --summarize --diff --only_new)
if [[ -n "$GAME" ]]; then
  DIGEST_ARGS+=(--game "$GAME")
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node "$CLI" "${DIGEST_ARGS[@]}" >"$TMP/digest.json" 2>"$TMP/digest.err" || true
node "$CLI" radar >"$TMP/radar.json" 2>"$TMP/radar.err" || true

# Merge into one payload for filter_morning
node -e '
const fs = require("fs");
const dig = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
let radar = {};
try { radar = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { radar = { ok:false, items:[] }; }
const out = {
  ok: !!(dig && dig.ok) || !!(radar && radar.ok),
  digests: dig.digests || (dig.game ? [dig] : []),
  radar: radar,
  via: "morning-triage.sh"
};
process.stdout.write(JSON.stringify(out));
' "$TMP/digest.json" "$TMP/radar.json" \
  | node "$CLI" filter_morning --max "$MAX" --gap-ms "$GAP" ${KEEP} ${EXTRA[@]+"${EXTRA[@]}"}
