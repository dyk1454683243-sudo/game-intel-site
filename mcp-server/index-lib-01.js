export * from "./index-lib-00.js";
export {
  isNoise,
  radarScore,
  passesGamekeeRadarTitle,
  j,
  textResult,
  truncate,
  stripHtml,
  absGkUrl,
  articleUrl,
  clampLimit,
  dedupeByUrl,
  titleFingerprint,
  sourcePriority,
  itemDateMs,
  dedupeByUrlOrTitle,
  normalizeUrlFp,
  itemFingerprint,
} from "./index-lib-01a.js";
import {
  isNoise,
  radarScore,
  passesGamekeeRadarTitle,
  j,
  textResult,
  truncate,
  stripHtml,
  absGkUrl,
  articleUrl,
  clampLimit,
  dedupeByUrl,
  titleFingerprint,
  sourcePriority,
  itemDateMs,
  dedupeByUrlOrTitle,
  normalizeUrlFp,
  itemFingerprint,
} from "./index-lib-01a.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  shanghaiYmd,
  EN_MONTH_MAP,
  EN_MONTH_ALT,
  toYmd,
  parseDatesFromText,
  applyRelativeDayPhrases,
  classifyEventType,
  stripDatesForNote,
  buildEventNote,
  TYPED_EVENT_RANK,
  eventNeedsDateEnrichment,
  bumpEventConfidence,
  shanghaiTodayYmd,
  shanghaiTomorrowYmd,
} from "./calendar-parse.js";
import {
  resolveAlias as resolveHwAlias,
  guideHw as guideHwCard,
  loadDopamine,
  listCharacterIds,
} from "./hw-guides.js";
import { guide as guideAny, listGuides } from "./guides.js";
import {
  cachedGuide,
  warmGuideCache,
  guideCacheStats,
} from "./guide-cache.js";
import { askIntel } from "./ask.js";
import {
  ensureData,
  readJson,
  writeJson,
  withCache,
  readBlocklist,
  normTitle,
  includesCI,
  itemAgeDays,
  isPrydwenHubItem,
  DATA_DIR,
  WATCHLIST_PATH,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  DIFF_WRITE_DISABLED,
  GK_ORIGIN,
  UA,
  DEFAULT_WATCHLIST,
  DEFAULT_BLOCKLIST,
  MERCH_TITLE_SUBS,
  MERCH_TITLE_RE,
  VERSION_EVENT_RE,
  DIGEST_SOURCE_PRIORITY,
  RADAR_PREFER_RE,
  RADAR_NEWS_RE,
  GK_TITLE_SIGNAL_RE,
  GK_NEWS_KEEP_RE,
  GK_QA_START_RE,
  GK_QA_DEBT_RE,
  GK_QA_BODY_RE,
  GK_MOD_SHORT_RE,
} from "./index-lib-00.js";
function readDigestSeen() {
  ensureData();
  const raw = readJson(DIGEST_SEEN_PATH, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { updated_at: null, games: {} };
  }
  const games =
    raw.games && typeof raw.games === "object" && !Array.isArray(raw.games)
      ? raw.games
      : {};
  return { updated_at: raw.updated_at || null, games };
}

function getGameSeenFingerprints(store, gameId) {
  const g = store?.games?.[gameId];
  if (!g || typeof g !== "object") return [];
  const fps = Array.isArray(g.fingerprints) ? g.fingerprints : [];
  return fps.map((x) => String(x)).filter(Boolean);
}

/** Union current fps into game snapshot; FIFO cap DIGEST_SEEN_CAP. */
function updateGameSeen(store, gameId, fingerprints) {
  if (!store.games || typeof store.games !== "object") store.games = {};
  const prev = getGameSeenFingerprints(store, gameId);
  const seen = new Set(prev);
  const next = [...prev];
  for (const fp of fingerprints) {
    const s = String(fp || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    next.push(s);
  }
  while (next.length > DIGEST_SEEN_CAP) next.shift();
  const now = new Date().toISOString();
  store.games[gameId] = { fingerprints: next, updated_at: now };
  store.updated_at = now;
  return store;
}

function writeDigestSeen(store) {
  if (DIFF_WRITE_DISABLED) return false;
  writeJson(DIGEST_SEEN_PATH, {
    updated_at: store.updated_at || new Date().toISOString(),
    games: store.games || {},
  });
  return true;
}

/**
 * Mark is_new / optionally filter; update snapshot with ALL current fps (union).
 * @returns {{ items, new_count, seen_count, skipped_seen?, empty_diff? }}
 */
function applyDigestDiff(gameId, items, opts = {}) {
  const onlyNew = !!(opts && opts.only_new);
  const store = readDigestSeen();
  const prevSet = new Set(getGameSeenFingerprints(store, gameId));
  const annotated = (items || []).map((it) => {
    const fp = itemFingerprint(it);
    const is_new = !fp || !prevSet.has(fp);
    return { ...it, is_new };
  });
  const new_count = annotated.filter((i) => i.is_new).length;
  const seen_count = annotated.length - new_count;

  // Snapshot gets ALL current item fingerprints (union), not only new
  const fps = (items || []).map(itemFingerprint).filter(Boolean);
  updateGameSeen(store, gameId, fps);
  writeDigestSeen(store);

  if (onlyNew) {
    const filtered = annotated.filter((i) => i.is_new);
    const empty_diff = filtered.length === 0 && annotated.length > 0;
    return {
      items: filtered,
      new_count,
      seen_count,
      skipped_seen: seen_count,
      ...(empty_diff ? { empty_diff: true } : {}),
    };
  }
  return { items: annotated, new_count, seen_count };
}

function readWatchlist() {
  ensureData();
  const wl = readJson(WATCHLIST_PATH, null);
  return wl && typeof wl === "object" ? wl : { ...DEFAULT_WATCHLIST };
}

function writeWatchlist(wl) {
  writeJson(WATCHLIST_PATH, wl);
}

function resolveGameEntry(gameOrId) {
  const wl = readWatchlist();
  const key = String(gameOrId || "")
    .toLowerCase()
    .trim();
  if (!key) return null;
  if (wl[key]) return { id: key, ...wl[key] };
  for (const [id, entry] of Object.entries(wl)) {
    const names = [
      id,
      entry.name,
      entry.name_zh,
      entry.gamekee_alias,
      ...(entry.keywords || []),
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());
    if (names.includes(key)) return { id, ...entry };
  }
  return null;
}

function pickAlias(entry) {
  if (entry?.gamekee_alias) return String(entry.gamekee_alias);
  return "www";
}

function pickQuery(entry, fallback = "") {
  if (fallback) return String(fallback).trim();
  if (!entry) return "";
  const kws = Array.isArray(entry.keywords) ? entry.keywords : [];
  return String(kws[0] || entry.name_zh || entry.name || entry.id || "").trim();
}

async function fetchRaw(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
    const bodyText = await res.text();
    const ct = res.headers.get("content-type") || "";
    return {
      ok: res.ok,
      status: res.status,
      bodyText,
      ct,
      isHtml: /^\s*</.test(bodyText) || ct.includes("html"),
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts = {}) {
  const raw = await fetchRaw(url, {
    ...opts,
    headers: {
      Accept: "application/json",
      ...(opts.headers || {}),
    },
  });
  let body = null;
  const trimmed = raw.bodyText.trim();
  if (
    raw.ct.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      body = JSON.parse(raw.bodyText);
    } catch {
      body = null;
    }
  }
  return {
    ok: raw.ok,
    status: raw.status,
    body,
    bodyText: raw.bodyText.slice(0, 200),
    isHtml: raw.isHtml,
  };
}

async function fetchText(url, opts = {}) {
  const raw = await fetchRaw(url, {
    ...opts,
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
      ...(opts.headers || {}),
    },
  });
  return {
    ok: raw.ok,
    status: raw.status,
    text: raw.bodyText,
  };
}

function isoFromUnix(sec) {
  if (!sec || !Number(sec)) return null;
  try {
    return new Date(Number(sec) * 1000).toISOString();
  } catch {
    return null;
  }
}

function mapSearchItem(it, alias) {
  const id = it.id;
  const a = alias || it.game?.alias || "www";
  return {
    id,
    title: truncate(it.title || "", 120),
    url: articleUrl(a, id),
    updated: isoFromUnix(it.updated_at || it.last_at || it.created_at),
    source: "gamekee",
  };
}


/** Common CN/EN misspellings → GameKee canonical HW names (searchArticle is literal). */
const HW_SEARCH_NAME_MAP = {
  加鲁德: "迦露德",
  加魯德: "迦露德",
  加鲁: "迦露德",
  Garud: "迦露德",
  Garuda: "迦露德",
  garud: "迦露德",
  garuda: "迦露德",
  가루드: "迦露德",
};

function expandGamekeeQueries(alias, query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const out = [];
  const push = (x) => {
    const s = String(x || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(q);
  if (HW_SEARCH_NAME_MAP[q]) push(HW_SEARCH_NAME_MAP[q]);
  for (const [k, v] of Object.entries(HW_SEARCH_NAME_MAP)) {
    if (k.toLowerCase() === q.toLowerCase()) push(v);
  }
  if (String(alias || "").toLowerCase() === "hw") {
    try {
      const hit = resolveHwAlias(DATA_DIR, q);
      if (hit?.ok && hit.name) push(hit.name);
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function searchGamekeeEntries({ alias, query, limit = 5 }) {
  const a = alias || "www";
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const lim = clampLimit(limit, 5, 10);
  return withCache(
    "searchGamekeeEntries",
    { alias: a, query: q, limit: lim },
    async () => {
      const url = `${GK_ORIGIN}/v1/entry/list?page_no=1&limit=2000`;
      const res = await fetchJson(url, { headers: { "game-alias": a } });
      if (!res.body || res.body.code !== 0 || !Array.isArray(res.body.data)) {
        return [];
      }
      const CHAR_FOLDER_BY_ALIAS = { hw: 163022 };
      const folderPid = CHAR_FOLDER_BY_ALIAS[a] ?? null;
      const hits = [];
      for (const x of res.body.data) {
        if (x?.is_del) continue;
        if (folderPid != null && x.pid !== folderPid) continue;
        const name = String(x.name || "").replace(/\ufeff/g, "").trim();
        const nameAlias = String(x.name_alias || "").trim();
        const blob = `${name} ${nameAlias}`.toLowerCase();
        if (!blob.includes(q) && name.toLowerCase() !== q && nameAlias.toLowerCase() !== q) {
          // also match if query is substring of canonical after map
          continue;
        }
        const id = x.content_id;
        if (!id) continue;
        hits.push({
          id,
          title: name || String(id),
          url: articleUrl(a, id),
          updated: isoFromUnix(x.updated_at || x.last_at || x.created_at),
          source: "gamekee",
          kind: "entry",
        });
        if (hits.length >= lim) break;
      }
      return hits;
    }
  );
}


export {
  readDigestSeen,
  getGameSeenFingerprints,
  updateGameSeen,
  writeDigestSeen,
  applyDigestDiff,
  readWatchlist,
  writeWatchlist,
  resolveGameEntry,
  pickAlias,
  pickQuery,
  fetchRaw,
  fetchJson,
  fetchText,
  isoFromUnix,
  mapSearchItem,
  expandGamekeeQueries,
  searchGamekeeEntries,
  HW_SEARCH_NAME_MAP,
};
