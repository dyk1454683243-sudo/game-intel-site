/**
 * Morning briefing triage: filter digest/radar candidates through jev gate game-intel.
 * Keep brief/answer/deep (radar: brief only). Drop skip; ask_dai → skip unless keepAskDai.
 */
import { parseRecommendation, runJev, ensureJevPath } from "./ask.js";

const DEFAULT_GAP_MS = 75;
const DEFAULT_MAX = 40;
const KEEP_ACTIONS = new Set(["brief", "answer", "deep"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s, n) {
  const t = String(s ?? "");
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/**
 * Build jev state string for a candidate.
 * @param {{ title?: string, game?: string, source?: string, url?: string, type?: string }} item
 */
export function buildMorningState(item) {
  const game = String(item.game || item.name || "未知").trim() || "未知";
  const title = String(item.title || "").trim() || "(无标题)";
  const source = String(item.source || item.url || "未知").trim() || "未知";
  const type = item.type === "radar" ? "radar" : "digest";
  return `游戏=${game}; 标题=${truncate(title, 160)}; 来源=${truncate(source, 80)}; 类型=${type}`;
}

/**
 * Effective action for morning keep/drop.
 * escalate → fall back to answers.action.choice (mid-band).
 */
export function effectiveAction(parsed, jevOut) {
  let action = parsed?.action || null;
  if (action === "escalate") {
    action = parsed?.choice || jevOut?.answers?.action?.choice || null;
  }
  if (!action && parsed?.choice) action = parsed.choice;
  return action;
}

/**
 * Decide keep vs drop.
 * @returns {{ keep: boolean, reason: string }}
 */
export function decideKeep(item, action, { keepAskDai = false } = {}) {
  const type = item.type === "radar" ? "radar" : "digest";
  if (!action) return { keep: false, reason: "no_action" };
  if (action === "skip") return { keep: false, reason: "skip" };
  if (action === "ask_dai") {
    if (keepAskDai) return { keep: true, reason: "ask_dai_kept" };
    return { keep: false, reason: "ask_dai_as_skip" };
  }
  if (action === "escalate") return { keep: false, reason: "escalate" };
  if (type === "radar") {
    if (action === "brief") return { keep: true, reason: "radar_brief" };
    return { keep: false, reason: `radar_need_brief_got_${action}` };
  }
  if (KEEP_ACTIONS.has(action)) return { keep: true, reason: action };
  return { keep: false, reason: `other_${action}` };
}

/**
 * Normalize raw digest/radar/stdin payloads into candidate list.
 */
export function extractCandidates(payload, { max = DEFAULT_MAX } = {}) {
  const out = [];
  const seen = new Set();

  const push = (raw, typeHint) => {
    if (!raw || typeof raw !== "object") return;
    const title = String(raw.title || raw.name || "").trim();
    if (!title) return;
    const game =
      raw.game ||
      raw.game_id ||
      raw.name_zh ||
      (typeHint === "radar" ? "类似新游" : "") ||
      "";
    const url = raw.url || raw.link || "";
    const source = raw.source || "";
    const type = raw.type === "radar" || typeHint === "radar" ? "radar" : "digest";
    const key = `${type}|${title}|${url || source}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: truncate(title, 200),
      game: String(game || (type === "radar" ? "类似新游" : "watchlist")).trim(),
      url: url || undefined,
      source: source || undefined,
      type,
      summary: raw.summary ? truncate(String(raw.summary), 240) : undefined,
      why: raw.why ? truncate(String(raw.why), 80) : undefined,
    });
  };

  if (!payload) return out;

  if (Array.isArray(payload)) {
    for (const it of payload) push(it, it?.type);
  } else if (Array.isArray(payload.candidates)) {
    for (const it of payload.candidates) push(it, it?.type);
  } else if (Array.isArray(payload.items) && !payload.digests && !payload.radar) {
    for (const it of payload.items) push(it, it?.type || payload.type);
  } else {
    // CLI digest shape: { digests: [{ game, name, items: [...] }] }
    if (Array.isArray(payload.digests)) {
      for (const dig of payload.digests) {
        const g = dig?.game || dig?.name || "";
        for (const it of dig?.items || []) {
          push({ ...it, game: it.game || g }, "digest");
        }
      }
    }
    // Single digest object
    if (payload.game && Array.isArray(payload.items) && !payload.digests) {
      const g = payload.game || payload.name;
      for (const it of payload.items) push({ ...it, game: it.game || g }, "digest");
    }
    // radar: { items: [...] } or nested under .radar
    const radar = payload.radar && typeof payload.radar === "object" ? payload.radar : null;
    if (radar && Array.isArray(radar.items)) {
      for (const it of radar.items) push(it, "radar");
    } else if (payload.type === "radar" && Array.isArray(payload.items)) {
      for (const it of payload.items) push(it, "radar");
    } else if (Array.isArray(payload.radar_items)) {
      for (const it of payload.radar_items) push(it, "radar");
    }
  }

  return out.slice(0, Math.max(0, Number(max) || DEFAULT_MAX));
}

/**
 * Filter candidates via jev.
 * @param {object[]} candidates
 * @param {{ gapMs?: number, keepAskDai?: boolean, dryRun?: boolean }} opts
 */
export async function filterCandidates(candidates, opts = {}) {
  const gapMs = opts.gapMs != null ? Number(opts.gapMs) : DEFAULT_GAP_MS;
  const keepAskDai = !!opts.keepAskDai;
  const kept = [];
  const dropped = [];
  const stats = {
    total: candidates.length,
    kept: 0,
    dropped: 0,
    by_action: {},
    by_reason: {},
    jev_errors: 0,
    gap_ms: gapMs,
  };

  ensureJevPath();

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const state = buildMorningState(item);
    let jevOut = null;
    let parsed = null;
    let action = null;
    let err = null;

    if (opts.dryRun) {
      action = item.type === "radar" ? "brief" : "brief";
      parsed = { action, recommendation: "brief:dry", choice: "brief", confidence: 1 };
    } else {
      try {
        jevOut = await runJev(state, { timeoutMs: 45000 });
        parsed = parseRecommendation(jevOut);
        action = effectiveAction(parsed, jevOut);
      } catch (e) {
        err = String(e.message || e).slice(0, 160);
        stats.jev_errors += 1;
      }
    }

    if (err) {
      // On jev failure for a single item: drop that item (caller may fall back wholesale)
      const row = {
        ...item,
        state,
        action: null,
        recommendation: null,
        reason: "jev_error",
        error: err,
      };
      dropped.push(row);
      stats.dropped += 1;
      stats.by_reason.jev_error = (stats.by_reason.jev_error || 0) + 1;
    } else {
      const decision = decideKeep(item, action, { keepAskDai });
      const row = {
        ...item,
        state,
        action,
        recommendation: parsed?.recommendation || null,
        choice: parsed?.choice || null,
        confidence: parsed?.confidence ?? null,
        reason: decision.reason,
      };
      stats.by_action[action || "null"] = (stats.by_action[action || "null"] || 0) + 1;
      stats.by_reason[decision.reason] = (stats.by_reason[decision.reason] || 0) + 1;
      if (decision.keep) {
        kept.push(row);
        stats.kept += 1;
      } else {
        dropped.push(row);
        stats.dropped += 1;
      }
    }

    if (i < candidates.length - 1 && gapMs > 0 && !opts.dryRun) {
      await sleep(gapMs);
    }
  }

  return { ok: true, kept, dropped, stats };
}

/**
 * Read stdin if available (non-TTY with data).
 */
export async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Run digest --summarize --diff --only_new + radar via existing CLI helpers.
 */
export async function fetchMorningSources({ game } = {}) {
  const { digestGame, radar } = await import("./index.js");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const DATA_DIR =
    process.env.GAME_INTEL_DATA || path.resolve(__dirname, "../data");
  const wlPath = path.join(DATA_DIR, "watchlist.json");
  const wl = JSON.parse(fs.readFileSync(wlPath, "utf8"));

  let pairs;
  if (game) {
    const key = String(game).toLowerCase();
    if (!wl[key]) throw new Error(`unknown_game:${game}`);
    pairs = [[key, wl[key]]];
  } else {
    pairs = Object.entries(wl);
  }

  const digests = [];
  for (const [id, entry] of pairs) {
    digests.push(
      await digestGame(id, entry, {
        summarize: true,
        diff: true,
        only_new: true,
      })
    );
  }
  let radarOut;
  try {
    radarOut = await radar({});
  } catch (e) {
    radarOut = { ok: false, error: String(e.message || e).slice(0, 120), items: [] };
  }
  return {
    ok: digests.some((d) => d && d.ok) || !!(radarOut && radarOut.ok),
    digests,
    radar: radarOut,
    via: "cli_fetch",
  };
}

/**
 * Full morning triage pipeline.
 */
export async function triageMorning(opts = {}) {
  const max = opts.max != null ? Number(opts.max) : DEFAULT_MAX;
  const gapMs = opts.gapMs != null ? Number(opts.gapMs) : DEFAULT_GAP_MS;
  let payload = opts.payload || null;
  let fetchMeta = null;

  if (!payload) {
    try {
      payload = await fetchMorningSources({ game: opts.game });
      fetchMeta = { fetched: true, digests: payload.digests?.length, radar_count: payload.radar?.count };
    } catch (e) {
      return {
        ok: false,
        error: "fetch_failed",
        detail: String(e.message || e).slice(0, 200),
        kept: [],
        dropped: [],
        stats: { total: 0, kept: 0, dropped: 0 },
      };
    }
  }

  const candidates = extractCandidates(payload, { max });
  if (!candidates.length) {
    return {
      ok: true,
      kept: [],
      dropped: [],
      stats: { total: 0, kept: 0, dropped: 0, by_action: {}, by_reason: {}, jev_errors: 0, gap_ms: gapMs },
      fetch: fetchMeta,
      note: "no_candidates",
    };
  }

  const result = await filterCandidates(candidates, {
    gapMs,
    keepAskDai: !!opts.keepAskDai,
    dryRun: !!opts.dryRun,
  });

  return {
    ...result,
    fetch: fetchMeta,
    capped_at: max,
    via: "filter_morning",
  };
}

