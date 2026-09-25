#!/usr/bin/env node
/**
 * Game Intel MCP — short JSON tools for watchlist + multi-source intel.
 * Never returns raw HTML.
 */
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
  withCache,
  passesDigestGameGate,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  PRYDWEN_ORIGIN,
  INVEN_PREF_GAMES,
  isNoise,
  truncate,
  stripHtml,
  itemDateMs,
  dedupeByUrlOrTitle,
  applyDigestDiff,
  pickAlias,
  pickQuery,
  fetchText,
  searchGamekee,
  getArticle,
  searchTaptap,
  searchInven,
  searchSteam,
  searchBahamut,
  isNikkeContext,
  searchPrydwen,
  parseBd2NoticeId,
  isBd2NewsViewUrl,
  fetchBd2NoticeDetail,
  isBd2ComicSubject,
  preferBd2OfficialForDigest,
  searchOfficial,
  attachDigestSummaries,
} from "./index-lib-07.js";


async function digestGame(entryId, entry, opts = {}) {
  const summarize = !!(opts && opts.summarize);
  const alias = pickAlias(entry);
  const query = alias === "www" ? pickQuery(entry) : pickQuery(entry, "");
  const preferInven = INVEN_PREF_GAMES.has(entryId);
  const isNikke =
    entryId === "nikke" ||
    isNikkeContext(pickQuery(entry), entry);

  // Cap mix ≤5 after dedupe+noise. Slots vary by game family.
  let gkCap, tapCap, invCap, bahCap, pryCap, offCap, steamCap;
  if (preferInven) {
    gkCap = 2;
    tapCap = 1;
    invCap = 2;
    bahCap = 1;
    pryCap = 0;
    offCap = 1;
    steamCap = 1;
  } else if (isNikke) {
    gkCap = 2;
    tapCap = 1;
    invCap = 0;
    bahCap = 1;
    pryCap = 2;
    offCap = 1;
    steamCap = 0;
  } else {
    gkCap = 2;
    tapCap = 1;
    invCap = 0;
    bahCap = 1;
    pryCap = 0;
    offCap = 1;
    // Fuzzy Steam search only when no appid; bd2 must not fuzzy-match unrelated apps
    steamCap = entry?.steam_appid != null ? 0 : 1;
    if (entryId === "bd2") steamCap = 0;
  }

  const tapQ = String(
    entry.name_zh || entry.name || pickQuery(entry) || ""
  ).trim();
  const kws = Array.isArray(entry.keywords) ? entry.keywords : [];
  const invenQ = String(kws[0] || entry.name_zh || entry.name || "").trim();
  const bahQ = String(
    BAHAMUT_QUERY_PREF[entryId] ||
      (Array.isArray(entry.keywords) && entry.keywords[0]) ||
      entry.name_zh ||
      entry.name ||
      pickQuery(entry) ||
      ""
  ).trim();
  const steamQ = String(entry.name || entry.name_zh || pickQuery(entry) || "").trim();
  const steamAppid =
    entry?.steam_appid != null && String(entry.steam_appid).trim() !== ""
      ? String(entry.steam_appid).trim()
      : null;

  const empty = { ok: false, items: [] };

  const [
    gkPrimary,
    tapRes,
    invRes,
    bahRes,
    pryRes,
    offRes,
    steamRes,
  ] = await Promise.all([
    (async () => {
      try {
        return await searchGamekee({
          alias,
          query: alias === "www" ? query : query || "",
          limit: gkCap,
        });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!(tapQ && tapCap > 0)) return empty;
      try {
        return await searchTaptap({ query: tapQ, limit: tapCap });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!(preferInven && invCap > 0 && invenQ)) return empty;
      try {
        return await searchInven({ query: invenQ, limit: invCap });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!((bahQ || BAHAMUT_BSN[entryId] != null) && bahCap > 0)) return empty;
      try {
        return await searchBahamut({
          query: bahQ,
          limit: Math.max(bahCap + 2, 4),
          game: entryId,
          bsn: BAHAMUT_BSN[entryId] ?? null,
        });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!(isNikke && pryCap > 0)) return empty;
      try {
        return await searchPrydwen({
          query: pickQuery(entry) || "NIKKE",
          limit: Math.max(pryCap + 3, 5),
        });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!(offCap > 0)) return empty;
      try {
        return await searchOfficial({
          game: entryId,
          // Digest wants latest ops notices, not keyword search
          query: "",
          limit: Math.max(offCap + 2, 4),
          forDigest: true,
        });
      } catch {
        return empty;
      }
    })(),
    (async () => {
      if (!(steamCap > 0 && (steamAppid || steamQ))) return empty;
      try {
        return await searchSteam({
          query: steamQ || undefined,
          appid: steamAppid || undefined,
          limit: Math.max(steamCap + 1, 3),
        });
      } catch {
        return empty;
      }
    })(),
  ]);

  let gkOut = gkPrimary;
  if (!gkOut.ok && alias !== "www" && query) {
    try {
      gkOut = await searchGamekee({ alias: "www", query, limit: gkCap });
    } catch {
      /* keep primary */
    }
  }

  const buckets = {
    gamekee: [],
    official: [],
    taptap: [],
    inven: [],
    bahamut: [],
    prydwen: [],
    steam: [],
  };

  for (const it of (gkOut.items || []).slice(0, gkCap + 2)) {
    const row = {
      title: it.title,
      url: it.url,
      source: "gamekee",
      updated: it.updated || null,
      id: it.id,
    };
    if (isNoise(row)) continue;
    if (buckets.gamekee.length >= gkCap) break;
    buckets.gamekee.push(row);
  }

  {
    let offItems = offRes.items || [];
    if (
      entryId === "bd2" ||
      /browndust2\.com/i.test(String(entry?.official_url || ""))
    ) {
      offItems = preferBd2OfficialForDigest(offItems);
    }
    for (const it of offItems) {
      if (buckets.official.length >= offCap) break;
      const row = {
        title: it.title,
        url: it.url,
        date: it.date || null,
        source: "official",
        ...(it.category ? { category: it.category } : {}),
      };
      if (isNoise(row)) continue;
      if (isBd2ComicSubject(row.title) && offItems.some((x) => !isBd2ComicSubject(x.title))) {
        continue;
      }
      buckets.official.push(row);
    }
  }

  for (const it of tapRes.items || []) {
    if (buckets.taptap.length >= tapCap) break;
    const row = {
      title: it.title,
      url: it.url,
      source: "taptap",
    };
    if (isNoise(row)) continue;
    if (!passesDigestGameGate(row, entry, entryId)) continue;
    buckets.taptap.push(row);
  }

  for (const it of invRes.items || []) {
    if (buckets.inven.length >= invCap) break;
    const row = {
      title: it.title,
      url: it.url,
      source: "inven",
    };
    if (isNoise(row)) continue;
    if (!passesDigestGameGate(row, entry, entryId)) continue;
    buckets.inven.push(row);
  }

  for (const it of bahRes.items || []) {
    if (buckets.bahamut.length >= bahCap) break;
    const row = {
      title: it.title,
      url: it.url,
      date: it.date || null,
      source: "bahamut",
    };
    if (isNoise(row)) continue;
    if (!passesDigestGameGate(row, entry, entryId)) continue;
    buckets.bahamut.push(row);
  }

  for (const it of pryRes.items || []) {
    if (buckets.prydwen.length >= pryCap) break;
    const row = {
      title: it.title,
      url: it.url,
      date: it.date || null,
      source: it.source === "nikkegg" ? "nikkegg" : "prydwen",
    };
    if (isNoise(row)) continue;
    buckets.prydwen.push(row);
  }

  for (const it of steamRes.items || []) {
    if (buckets.steam.length >= steamCap) break;
    const row = {
      title: it.title,
      url: it.url,
      date: it.date || null,
      source: "steam",
    };
    if (isNoise(row)) continue;
    if (!passesDigestGameGate(row, entry, entryId)) continue;
    buckets.steam.push(row);
  }

  // Interleave preferred sources; keep total ≤5
  let order;
  if (preferInven) {
    order = ["official", "inven", "taptap", "gamekee", "bahamut", "steam"];
  } else if (isNikke) {
    order = ["gamekee", "official", "prydwen", "bahamut", "taptap", "steam"];
  } else {
    order = ["gamekee", "official", "taptap", "bahamut", "steam"];
  }
  const mixed = [];
  for (const src of order) {
    const bucket = [...(buckets[src] || [])].sort(
      (a, b) => itemDateMs(b) - itemDateMs(a)
    );
    for (const it of bucket) mixed.push(it);
  }
  let items = dedupeByUrlOrTitle(mixed)
    .filter((it) => !isNoise(it))
    .filter((it) => passesDigestGameGate(it, entry, entryId))
    .slice(0, 5);

  let wantDiff = !!(opts && opts.diff);
  const onlyNew = !!(opts && opts.only_new);
  if (onlyNew) wantDiff = true;

  let new_count;
  let seen_count;
  let skipped_seen;
  let empty_diff = false;

  if (wantDiff) {
    const diffed = applyDigestDiff(entryId, items, { only_new: onlyNew });
    items = diffed.items;
    new_count = diffed.new_count;
    seen_count = diffed.seen_count;
    if (onlyNew) skipped_seen = diffed.skipped_seen;
    if (diffed.empty_diff) empty_diff = true;
  }

  // Summarize after diff filter so morning only_new skips seen articles
  if (summarize && items.length) {
    await attachDigestSummaries(items, entryId, 2);
  }

  const sources = [...new Set(items.map((i) => i.source))];
  const ok = items.length > 0 || empty_diff;
  return {
    game: entryId,
    name: entry.name_zh || entry.name || entryId,
    alias,
    ok,
    count: items.length,
    sources,
    items,
    ...(wantDiff
      ? { new_count: new_count ?? 0, seen_count: seen_count ?? 0 }
      : {}),
    ...(onlyNew ? { skipped_seen: skipped_seen ?? 0 } : {}),
    ...(items.length
      ? {}
      : empty_diff
        ? { error: "empty_diff" }
        : { error: truncate(gkOut.error || offRes.error || "no_items", 80) }),
    ...(gkOut.via ? { via: gkOut.via } : {}),
  };
}


/* Calendar parsers live in ./calendar-parse.js (unit-testable without MCP). */

const CAL_BODY_FETCH_CAP = 6;
const CAL_BODY_CONCURRENCY = 3;
const CAL_BODY_SNIPPET_CHARS = 1800;
const CAL_DATE_BLOB_CHARS = 1200;

/**
 * Strip common Jina reader chrome / nav boilerplate from plain text.
 */

export {
  digestGame,
  CAL_BODY_FETCH_CAP,
  CAL_BODY_CONCURRENCY,
  CAL_BODY_SNIPPET_CHARS,
  CAL_DATE_BLOB_CHARS,
};
