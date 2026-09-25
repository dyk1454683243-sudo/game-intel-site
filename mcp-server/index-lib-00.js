export {
  __dirname,
  DATA_DIR,
  WATCHLIST_PATH,
  SOURCES_PATH,
  BLOCKLIST_PATH,
  CACHE_DIR,
  CACHE_DISABLED,
  CACHE_TTL_SEC,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  DIFF_WRITE_DISABLED,
  GK_ORIGIN,
  TAPTAP_ORIGIN,
  TAPTAP_PROBE,
  INVEN_ORIGIN,
  STEAM_STORE,
  STEAM_NEWS_API,
  BAHAMUT_GNN_RSS,
  BAHAMUT_SEARCH_JINA,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  PRYDWEN_ORIGIN,
  NIKKEGG_FEED,
  BD2_API_ORIGIN,
  BD2_SITE_ORIGIN,
  BD2_LOCALE_MAP,
  BD2_DIGEST_CAT_PREF,
  TAPTAP_XUA,
  UA,
  DEFAULT_WATCHLIST,
  DEFAULT_SOURCES,
  RADAR_KEYWORDS,
  INVEN_PREF_GAMES,
  DEFAULT_BLOCKLIST,
  MERCH_TITLE_SUBS,
  MERCH_TITLE_RE,
  VERSION_EVENT_RE,
  PRYDWEN_HUB_TITLES,
  PRYDWEN_HUB_PATHS,
  DIGEST_SOURCE_PRIORITY,
  RADAR_PREFER_RE,
  RADAR_NEWS_RE,
  GK_TITLE_SIGNAL_RE,
  GK_NEWS_KEEP_RE,
  GK_QA_START_RE,
  GK_QA_DEBT_RE,
  GK_QA_BODY_RE,
  GK_MOD_SHORT_RE,
} from "./index-lib-00a.js";
import {
  __dirname,
  DATA_DIR,
  WATCHLIST_PATH,
  SOURCES_PATH,
  BLOCKLIST_PATH,
  CACHE_DIR,
  CACHE_DISABLED,
  CACHE_TTL_SEC,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  DIFF_WRITE_DISABLED,
  GK_ORIGIN,
  TAPTAP_ORIGIN,
  TAPTAP_PROBE,
  INVEN_ORIGIN,
  STEAM_STORE,
  STEAM_NEWS_API,
  BAHAMUT_GNN_RSS,
  BAHAMUT_SEARCH_JINA,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  PRYDWEN_ORIGIN,
  NIKKEGG_FEED,
  BD2_API_ORIGIN,
  BD2_SITE_ORIGIN,
  BD2_LOCALE_MAP,
  BD2_DIGEST_CAT_PREF,
  TAPTAP_XUA,
  UA,
  DEFAULT_WATCHLIST,
  DEFAULT_SOURCES,
  RADAR_KEYWORDS,
  INVEN_PREF_GAMES,
  DEFAULT_BLOCKLIST,
  MERCH_TITLE_SUBS,
  MERCH_TITLE_RE,
  VERSION_EVENT_RE,
  PRYDWEN_HUB_TITLES,
  PRYDWEN_HUB_PATHS,
  DIGEST_SOURCE_PRIORITY,
  RADAR_PREFER_RE,
  RADAR_NEWS_RE,
  GK_TITLE_SIGNAL_RE,
  GK_NEWS_KEEP_RE,
  GK_QA_START_RE,
  GK_QA_DEBT_RE,
  GK_QA_BODY_RE,
  GK_MOD_SHORT_RE,
} from "./index-lib-00a.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WATCHLIST_PATH)) {
    fs.writeFileSync(
      WATCHLIST_PATH,
      JSON.stringify(DEFAULT_WATCHLIST, null, 2) + "\n"
    );
  }
  if (!fs.existsSync(SOURCES_PATH)) {
    fs.writeFileSync(
      SOURCES_PATH,
      JSON.stringify(DEFAULT_SOURCES, null, 2) + "\n"
    );
  }
  if (!fs.existsSync(BLOCKLIST_PATH)) {
    fs.writeFileSync(
      BLOCKLIST_PATH,
      JSON.stringify(DEFAULT_BLOCKLIST, null, 2) + "\n"
    );
  }
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function cacheEnabled() {
  return !CACHE_DISABLED;
}

function stableCachePayload(fn, args) {
  // Stable key: fn + sorted-ish plain args object (callers pass fixed key order).
  return JSON.stringify({ fn, args });
}

function cacheKey(fn, args) {
  return crypto
    .createHash("sha1")
    .update(stableCachePayload(fn, args))
    .digest("hex");
}

function cacheGet(key) {
  if (!cacheEnabled()) return undefined;
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(p)) return undefined;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (
      !obj ||
      typeof obj !== "object" ||
      !("saved_at" in obj) ||
      !("value" in obj)
    ) {
      return undefined;
    }
    const ageSec = (Date.now() - Number(obj.saved_at)) / 1000;
    if (!Number.isFinite(ageSec) || ageSec < 0 || ageSec > CACHE_TTL_SEC) {
      return undefined;
    }
    return obj.value;
  } catch {
    return undefined;
  }
}

function cacheSet(key, value) {
  if (!cacheEnabled()) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify({ saved_at: Date.now(), value })
    );
  } catch {
    /* ignore corrupt/unwritable */
  }
}

async function withCache(fn, args, runner) {
  const key = cacheKey(fn, args);
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await runner();
  cacheSet(key, value);
  return value;
}


function readBlocklist() {
  ensureData();
  const bl = readJson(BLOCKLIST_PATH, null);
  if (!bl || typeof bl !== "object") return { ...DEFAULT_BLOCKLIST };
  const maxAgeRaw = Number(bl.max_age_days);
  return {
    title_substrings: Array.isArray(bl.title_substrings)
      ? bl.title_substrings
      : DEFAULT_BLOCKLIST.title_substrings,
    title_exact: Array.isArray(bl.title_exact)
      ? bl.title_exact
      : DEFAULT_BLOCKLIST.title_exact,
    url_substrings: Array.isArray(bl.url_substrings)
      ? bl.url_substrings
      : DEFAULT_BLOCKLIST.url_substrings,
    evergreen_exact: Array.isArray(bl.evergreen_exact)
      ? bl.evergreen_exact
      : DEFAULT_BLOCKLIST.evergreen_exact,
    max_age_days:
      Number.isFinite(maxAgeRaw) && maxAgeRaw > 0
        ? Math.trunc(maxAgeRaw)
        : DEFAULT_BLOCKLIST.max_age_days,
  };
}

function normTitle(s) {
  return String(s ?? "").trim();
}

function includesCI(hay, needle) {
  return String(hay || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

function itemAgeDays(item) {
  const raw = item?.date || item?.updated;
  if (raw == null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 0;
  return ms / 86400000;
}

function isPrydwenHubItem(item) {
  const title = normTitle(item?.title)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const bare = title.replace(/^nikke\s+/, "").trim();
  if (PRYDWEN_HUB_TITLES.has(title) || PRYDWEN_HUB_TITLES.has(bare)) {
    return true;
  }
  let pathname = "";
  try {
    const u = new URL(String(item?.url || ""), PRYDWEN_ORIGIN);
    pathname = u.pathname || "";
  } catch {
    pathname = String(item?.url || "");
  }
  const norm = pathname.replace(/\/+$/, "") || "/";
  if (PRYDWEN_HUB_PATHS.has(norm)) return true;
  // Relative / absolute path ending at hub slug (no deeper segment)
  if (/\/nikke\/(banners|tier-list|characters|guides)\/?$/i.test(norm)) {
    return true;
  }
  return false;
}

/**
 * Cross-game keyword gate: true if title/url hits entry keywords/name/id.
 * Special cases avoid BD1 / bare Last Origin / unrelated fuzzy Steam hits.
 */
function hitsGameKeywords(text, entry, entryId = null) {
  const hay = String(text || "").toLowerCase();
  const id = String(entryId || entry?.id || "")
    .toLowerCase()
    .trim();

  if (id === "bd2") {
    // Require BD2 — NOT bare "brown dust" / "棕色尘埃" (BD1)
    return /brown\s*dust\s*2|brown\s*dust\s*ii|browndust2|棕色尘埃\s*2|棕色尘埃2/.test(
      hay
    );
  }
  if (id === "lo2") {
    // Require LO2 — NOT bare "last origin"
    return /last\s*origin\s*2|라스트오리진\s*2|라스트오리진2/.test(hay);
  }
  if (id === "miraesi") {
    if (/미래시|invisible\s*future|miresi|control9/.test(hay)) return true;
  }
  if (id === "nikke") {
    if (/妮姬|nikke/.test(hay)) return true;
  }

  const aliases = [];
  const pushAlias = (s) => {
    const v = String(s || "")
      .trim()
      .toLowerCase();
    if (v.length >= 2) aliases.push(v);
  };
  pushAlias(id);
  pushAlias(entry?.name);
  pushAlias(entry?.name_zh);
  pushAlias(entry?.gamekee_alias);
  for (const k of Array.isArray(entry?.keywords) ? entry.keywords : []) {
    pushAlias(k);
  }
  for (const a of aliases) {
    if (hay.includes(a)) return true;
  }
  return false;
}

function bahamutItemOnPinnedBoard(item, entryId) {
  const expected = BAHAMUT_BSN[String(entryId || "").toLowerCase()];
  if (expected == null) return false;
  const m = String(item?.url || "").match(/[?&]bsn=(\d+)/i);
  return !!(m && Number(m[1]) === Number(expected));
}

function passesDigestGameGate(item, entry, entryId) {
  const src = String(item?.source || "").toLowerCase();
  const blob = `${item?.title || ""}\n${item?.url || ""}`;
  if (src === "bahamut") {
    // Pinned-board threads are on-game even without the name in the title
    if (bahamutItemOnPinnedBoard(item, entryId)) return true;
    return hitsGameKeywords(blob, entry, entryId);
  }
  if (src === "steam" || src === "taptap" || src === "inven") {
    return hitsGameKeywords(blob, entry, entryId);
  }
  return true;
}

function isBareTapTapAppShell(item) {
  const title = normTitle(item?.title);
  const why = String(item?.why || "");
  if (!/^taptap:/i.test(why)) return false;
  // Has real launch/test signal in the title itself → keep
  if (/公测|测试|預約|预约|CBT|上线|定档|新作|二周目|续作|beta|launch/i.test(title)) {
    return false;
  }
  // Exact short name-only app shells (e.g. 公元) or bare app name with only why-tag
  if (/^[\u4e00-\u9fff]{1,4}$/.test(title)) return true;
  if (title.length <= 16) return true;
  return false;
}

/**
 * Shared ad/noise filter for radar (+ digest merge).
 * item: { title, url, why?, source?, date?, updated? }
 */

export {
  ensureData,
  readJson,
  writeJson,
  cacheEnabled,
  stableCachePayload,
  cacheKey,
  cacheGet,
  cacheSet,
  withCache,
  readBlocklist,
  normTitle,
  includesCI,
  itemAgeDays,
  isPrydwenHubItem,
  hitsGameKeywords,
  bahamutItemOnPinnedBoard,
  passesDigestGameGate,
  isBareTapTapAppShell,
};
