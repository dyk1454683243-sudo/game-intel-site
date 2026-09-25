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

import { server } from "./index-tools-b.js";
import {
  cacheKey,
  cacheGet,
  cacheSet,
  withCache,
  readBlocklist,
  itemAgeDays,
  hitsGameKeywords,
  isBareTapTapAppShell,
  DATA_DIR,
  CACHE_DIR,
  CACHE_TTL_SEC,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  isNoise,
  titleFingerprint,
  dedupeByUrlOrTitle,
  normalizeUrlFp,
  itemFingerprint,
  readDigestSeen,
  updateGameSeen,
  writeDigestSeen,
  applyDigestDiff,
  searchGamekee,
  searchTaptap,
  searchInven,
  steamNewsForApp,
  searchSteam,
  radar,
  searchBahamut,
  searchPrydwen,
  parseBd2NoticeId,
  fetchBd2NoticeDetail,
  searchSmilegateNewsroom,
  searchStarOfficial,
  searchLo2Official,
  searchAsoraOfficial,
  searchBd2Official,
  searchOfficial,
  digestGame,
  fetchCalendarBodySnippet,
  enrichCalendarDates,
  parseEventFromItem,
  buildCalendar,
} from "./index-lib-09.js";

async function main() {
  try {
    const warm = warmGuideCache(DATA_DIR);
    console.error(
      JSON.stringify({
        event: "guide_cache_warm",
        warmed: warm.warmed,
        stats: warm.stats,
      })
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "guide_cache_warm_failed",
        error: String(e && e.message ? e.message : e).slice(0, 120),
      })
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) ===
    path.resolve(process.argv[1]);

if (isMain && process.argv.includes("--smoke")) {
  smoke().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
} else if (isMain) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}

export {
  resolveHwAlias,
  guideHwCard,
  loadDopamine,
  listCharacterIds,
  askIntel,
  cachedGuide,
  warmGuideCache,
  guideCacheStats,
  searchTaptap,
  searchInven,
  searchSteam,
  steamNewsForApp,
  searchBahamut,
  searchPrydwen,
  searchOfficial,
  searchBd2Official,
  fetchBd2NoticeDetail,
  parseBd2NoticeId,
  searchSmilegateNewsroom,
  searchStarOfficial,
  searchLo2Official,
  searchAsoraOfficial,
  radar,
  searchGamekee,
  digestGame,
  buildCalendar,
  enrichCalendarDates,
  fetchCalendarBodySnippet,
  parseEventFromItem,
  parseDatesFromText,
  applyRelativeDayPhrases,
  classifyEventType,
  eventNeedsDateEnrichment,
  bumpEventConfidence,
  shanghaiYmd,
  shanghaiTodayYmd,
  isNoise,
  hitsGameKeywords,
  isBareTapTapAppShell,
  readBlocklist,
  itemAgeDays,
  dedupeByUrlOrTitle,
  titleFingerprint,
  itemFingerprint,
  normalizeUrlFp,
  applyDigestDiff,
  readDigestSeen,
  writeDigestSeen,
  updateGameSeen,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  cacheGet,
  cacheSet,
  cacheKey,
  withCache,
  CACHE_TTL_SEC,
  CACHE_DIR,
};
