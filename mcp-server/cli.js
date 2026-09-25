#!/usr/bin/env node
/**
 * Shell-callable CLI for game-intel (no MCP / CallDynamicTool required).
 *
 * Usage:
 *   node mcp-server/cli.js digest --summarize --diff --only_new [--game hw]
 *   node mcp-server/cli.js radar [--q 公测]
 *   node mcp-server/cli.js calendar [--game hw] [--limit 20]
 *   node mcp-server/cli.js guide --game hw --q 修女 [--topic skills]
 *   node mcp-server/cli.js list_guides [--game hw]
 *   node mcp-server/cli.js ask --state '...' [--game hw] [--with-digest]
 *   node mcp-server/cli.js ask "Horizon Walker 修女圣痕用什么"
 *   node mcp-server/cli.js filter_morning | triage [--max 40] [--gap-ms 75] [--keep-ask-dai]
 *     Reads stdin JSON (digest/radar/candidates) OR fetches digest+radar internally.
 *
 * Env: GAME_INTEL_DATA (defaults to ../data next to this file)
 * PATH should include jev (or set JEV_BIN). Prints one JSON object to stdout; errors → stderr + exit 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.GAME_INTEL_DATA || path.resolve(__dirname, "../data");

function usage(code = 0) {
  const msg = `game-intel cli — Shell fallback when user-game-intel MCP is missing

Commands:
  digest [--game ID] [--summarize] [--diff] [--only_new]
  radar [--q TEXT]
  calendar [--game ID] [--limit N]
  guide [--game hw] (--q TEXT | --id ID) [--topic overview|skills|stigmata|dopamine|all]
  list_guides [--game ID]
  ask --state TEXT | ask "STATE" [--game ID] [--with-digest]
  filter_morning | triage [--max N] [--gap-ms MS] [--keep-ask-dai] [--game ID]
    stdin JSON or internal digest+radar; jev-gate each candidate; stdout {kept,dropped,stats}

Examples:
  node mcp-server/cli.js digest --summarize --diff --only_new
  node mcp-server/cli.js radar
  node mcp-server/cli.js calendar --game hw --limit 15
  node mcp-server/cli.js guide --q 吉吉 --topic skills
  node mcp-server/cli.js list_guides --game hw
  PATH="$HOME/bin:$PATH" node mcp-server/cli.js ask --state 'Horizon Walker 修女圣痕用什么 来源GameKee'
  PATH="$HOME/bin:$PATH" node mcp-server/cli.js filter_morning --max 40
  PATH="$HOME/bin:$PATH" node mcp-server/cli.js digest --summarize --diff --only_new | node mcp-server/cli.js triage --max 20
`;
  if (code) process.stderr.write(msg);
  else process.stdout.write(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--summarize") out.summarize = true;
    else if (a === "--diff") out.diff = true;
    else if (a === "--only_new" || a === "--only-new") out.only_new = true;
    else if (a === "--with-digest" || a === "--with_digest") out.with_digest = true;
    else if (a === "--keep-ask-dai" || a === "--keep_ask_dai") out.keep_ask_dai = true;
    else if (a === "--dry-run" || a === "--dry_run") out.dry_run = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "_");
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function readWatchlist() {
  const p = path.join(DATA_DIR, "watchlist.json");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function resolveEntry(wl, game) {
  if (!game) return null;
  const key = String(game).toLowerCase().trim();
  if (wl[key]) return { id: key, entry: wl[key] };
  for (const [id, entry] of Object.entries(wl)) {
    if (id.toLowerCase() === key) return { id, entry };
    const names = [entry.name, entry.name_zh, entry.gamekee_alias]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    if (names.includes(key)) return { id, entry };
  }
  return null;
}

async function cmdDigest(flags) {
  const { digestGame } = await import("./index.js");
  const wl = readWatchlist();
  let pairs;
  if (flags.game) {
    const hit = resolveEntry(wl, flags.game);
    if (!hit) {
      return { ok: false, error: "unknown_game", game: flags.game };
    }
    pairs = [[hit.id, hit.entry]];
  } else {
    pairs = Object.entries(wl);
  }
  const digests = [];
  for (const [id, entry] of pairs) {
    digests.push(
      await digestGame(id, entry, {
        summarize: !!flags.summarize,
        diff: !!flags.diff,
        only_new: !!flags.only_new,
      })
    );
  }
  return {
    ok: digests.some((d) => d && d.ok),
    count: digests.length,
    digests,
    via: "cli",
  };
}

async function cmdRadar(flags) {
  const { radar } = await import("./index.js");
  const q = flags.q != null ? String(flags.q) : undefined;
  const out = await radar({ q });
  return { ...out, via: "cli" };
}

async function cmdCalendar(flags) {
  const { buildCalendar } = await import("./index.js");
  const limit = flags.limit != null ? Number(flags.limit) : 20;
  const out = await buildCalendar({
    game: flags.game || undefined,
    limit: Number.isFinite(limit) ? limit : 20,
  });
  return { ...out, via: "cli" };
}

async function cmdGuide(flags) {
  const { guide } = await import("./guides.js");
  if (!flags.q && !flags.id) {
    return { ok: false, error: "need_q_or_id" };
  }
  const out = guide(DATA_DIR, {
    game: flags.game || "hw",
    q: flags.q || undefined,
    id: flags.id || undefined,
    topic: flags.topic || undefined,
  });
  return { ...out, via: "cli" };
}

async function cmdListGuides(flags) {
  const { listGuides } = await import("./guides.js");
  const out = listGuides(DATA_DIR, {
    game: flags.game || undefined,
  });
  return { ...out, via: "cli" };
}


async function cmdAsk(flags) {
  const { askIntel } = await import("./ask.js");
  let state = flags.state != null ? String(flags.state) : "";
  // ask "literal state…" — first positional after command, or remaining _.slice(1)
  if (!state && flags._.length > 1) {
    state = flags._.slice(1).join(" ");
  }
  if (!state) {
    return { ok: false, error: "need_state", hint: "ask --state '...' or ask \"...\"" };
  }
  const out = await askIntel(DATA_DIR, {
    state,
    game: flags.game || undefined,
    with_digest: !!flags.with_digest,
  });
  return { ...out, via: "cli" };
}


async function cmdFilterMorning(flags) {
  const { triageMorning, readStdinJson } = await import("./morning-filter.js");
  // Ensure jev on PATH
  const bin = process.env.JEV_PATH_PREFIX || "";
  if (bin && !(process.env.PATH || "").split(path.delimiter).includes(bin)) {
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ""}`;
  }
  const max = flags.max != null ? Number(flags.max) : 40;
  const gapMs =
    flags.gap_ms != null
      ? Number(flags.gap_ms)
      : flags.gapMs != null
        ? Number(flags.gapMs)
        : 75;
  let payload = null;
  try {
    payload = await readStdinJson();
  } catch (e) {
    return {
      ok: false,
      error: "stdin_json_invalid",
      detail: String(e.message || e).slice(0, 160),
      kept: [],
      dropped: [],
      stats: { total: 0, kept: 0, dropped: 0 },
    };
  }
  // Empty stdin object with no candidates → still try fetch if truly empty
  if (payload && typeof payload === "object") {
    const has =
      Array.isArray(payload) ||
      Array.isArray(payload.candidates) ||
      Array.isArray(payload.digests) ||
      Array.isArray(payload.items) ||
      (payload.radar && typeof payload.radar === "object");
    if (!has) payload = null;
  }
  return triageMorning({
    payload,
    game: flags.game || undefined,
    max: Number.isFinite(max) ? max : 40,
    gapMs: Number.isFinite(gapMs) ? gapMs : 75,
    keepAskDai: !!flags.keep_ask_dai,
    dryRun: !!flags.dry_run,
  });
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags._.length === 0) usage(flags.help ? 0 : 1);
  const cmd = flags._[0];

  let result;
  switch (cmd) {
    case "digest":
      result = await cmdDigest(flags);
      break;
    case "radar":
      result = await cmdRadar(flags);
      break;
    case "calendar":
      result = await cmdCalendar(flags);
      break;
    case "guide":
      result = await cmdGuide(flags);
      break;
    case "list_guides":
    case "list-guides":
      result = await cmdListGuides(flags);
      break;
    case "ask":
      result = await cmdAsk(flags);
      break;
    case "filter_morning":
    case "filter-morning":
    case "triage":
      result = await cmdFilterMorning(flags);
      break;
    default:
      process.stderr.write(`unknown command: ${cmd}\n`);
      usage(1);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result && result.ok === false) process.exitCode = 2;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
