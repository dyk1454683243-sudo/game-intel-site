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

export * from "./index-lib-08.js";
import {
  normTitle,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  isNoise,
  truncate,
  dedupeByUrlOrTitle,
  readWatchlist,
  resolveGameEntry,
  pickAlias,
  pickQuery,
  searchGamekee,
  searchBahamut,
  searchOfficial,
  digestGame,
  enrichCalendarDates,
  isPrydwenCharacterPage,
  CAL_DATE_BLOB_CHARS,
} from "./index-lib-08.js";


function parseEventFromItem(item, gameMeta = {}) {
  if (!item) return null;
  if (isNoise(item)) return null;

  const title = normTitle(item.title);
  if (!title) return null;

  const summary =
    item.summary != null && String(item.summary).trim()
      ? String(item.summary).trim()
      : "";
  const blob = summary
    ? `${title} ${summary.slice(0, CAL_DATE_BLOB_CHARS)}`
    : title;

  const type = classifyEventType(blob);
  const { start, end, precision } = parseDatesFromText(blob);

  if (isPrydwenCharacterPage(item) && !start && !end && type === "other") {
    return null;
  }

  if (
    type === "other" &&
    (/known\s*issues|statement on|unauthorized|\bfaq\b|兌換碼|coupon|序號|optimization on|\bupdate on\b/i.test(
      title
    ) ||
      /^IMPORTANT\s+\d{1,2}[-/]\d{1,2}\b/i.test(title))
  ) {
    return null;
  }

  if (type === "other") {
    if (!(start && end) || start === end) return null;
  }

  const hasTypeSignal = type !== "other";
  let confidence = "low";
  // Month-only windows stay low (do not blind-bump to high)
  if (precision === "month") {
    confidence = "low";
  } else if (start && end) confidence = "high";
  else if ((start || end) && hasTypeSignal) confidence = "high";

  const name =
    gameMeta.name_zh || gameMeta.name || gameMeta.id || item.game || "";

  return {
    game: gameMeta.id || item.game || null,
    name,
    type,
    title: truncate(title, 120),
    start,
    end,
    note: buildEventNote(title, type),
    url: item.url || "",
    source: item.source || "unknown",
    confidence,
    ...(precision === "month" ? { precision: "month" } : {}),
    ...(item.id ? { id: item.id } : {}),
  };
}

/**
 * Build gacha/event calendar from digest items across watchlist (or one game).
 * Undated events may be enriched via article body/summary (capped fetches).
 * @param {{game?:string, limit?:number}} opts
 */
async function buildCalendar(opts = {}) {
  const limRaw = Number(opts.limit);
  const limit = Math.min(
    Math.max(Number.isFinite(limRaw) ? Math.trunc(limRaw) : 20, 1),
    30
  );
  const as_of = new Date().toISOString();
  const wl = readWatchlist();

  let entries;
  if (opts.game) {
    const entry = resolveGameEntry(opts.game);
    if (!entry) {
      return {
        ok: false,
        error: "unknown_game",
        game: opts.game,
        count: 0,
        as_of,
        events: [],
      };
    }
    entries = [[entry.id, entry]];
  } else {
    entries = Object.entries(wl);
  }

  const events = [];
  for (const [id, entry] of entries) {
    const meta = {
      id,
      name: entry.name,
      name_zh: entry.name_zh,
    };
    const alias = pickAlias(entry);
    const query = pickQuery(entry);
    const bahQ = String(
      BAHAMUT_QUERY_PREF[id] ||
        (Array.isArray(entry.keywords) && entry.keywords[0]) ||
        entry.name_zh ||
        entry.name ||
        query ||
        ""
    ).trim();

    const empty = { ok: false, items: [] };
    const [digest, offRes, gkRes, bahRes] = await Promise.all([
      digestGame(id, entry, {
        summarize: false,
        diff: false,
        only_new: false,
      }).catch(() => empty),
      searchOfficial({
        game: id,
        query: "",
        limit: 8,
        forDigest: true,
      }).catch(() => empty),
      searchGamekee({
        alias,
        query: alias === "www" ? query : query || "",
        limit: 6,
      }).catch(() => empty),
      (bahQ || BAHAMUT_BSN[id] != null
        ? searchBahamut({
            query: bahQ,
            limit: 6,
            game: id,
            bsn: BAHAMUT_BSN[id] ?? null,
          })
        : Promise.resolve(empty)
      ).catch(() => empty),
    ]);

    const pool = [];
    for (const it of digest?.items || []) pool.push(it);
    for (const it of offRes?.items || []) {
      pool.push({
        title: it.title,
        url: it.url,
        date: it.date || null,
        source: "official",
        ...(it.id ? { id: it.id } : {}),
        ...(it.category ? { category: it.category } : {}),
        ...(it.summary ? { summary: it.summary } : {}),
      });
    }
    for (const it of gkRes?.items || []) {
      pool.push({
        title: it.title,
        url: it.url,
        source: "gamekee",
        updated: it.updated || null,
        id: it.id,
        ...(it.summary ? { summary: it.summary } : {}),
      });
    }
    for (const it of bahRes?.items || []) {
      pool.push({
        title: it.title,
        url: it.url,
        date: it.date || null,
        source: "bahamut",
        ...(it.summary ? { summary: it.summary } : {}),
      });
    }

    const merged = dedupeByUrlOrTitle(pool).filter((it) => !isNoise(it));
    const itemByUrl = new Map();
    for (const it of merged) {
      if (it?.url) itemByUrl.set(String(it.url), it);
    }

    const gameEvents = [];
    for (const it of merged) {
      const ev = parseEventFromItem(it, meta);
      if (ev) gameEvents.push(ev);
    }

    await enrichCalendarDates(gameEvents, { gameId: id, itemByUrl });
    events.push(...gameEvents);
  }

  // Dedupe by game + title + window
  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    const key = `${ev.game}|${String(ev.title).toLowerCase()}|${ev.start || ""}|${ev.end || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  deduped.sort((a, b) => {
    if (a.start == null && b.start == null) return 0;
    if (a.start == null) return 1;
    if (b.start == null) return -1;
    if (a.start < b.start) return -1;
    if (a.start > b.start) return 1;
    return 0;
  });

  const capped = deduped.slice(0, Math.min(limit, 30));
  return {
    ok: true,
    count: capped.length,
    as_of,
    events: capped,
  };
}



export {
  parseEventFromItem,
  buildCalendar,
};
