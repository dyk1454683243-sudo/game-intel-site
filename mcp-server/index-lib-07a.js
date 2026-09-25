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
  includesCI,
  truncate,
  clampLimit,
  readWatchlist,
  resolveGameEntry,
  getArticle,
  steamNewsForApp,
  usesBd2OfficialApi,
  usesSmilegateNewsroom,
  matchesMiresiOfficial,
  searchSmilegateNewsroom,
  usesStarOfficial,
  searchStarOfficial,
  usesLo2Official,
  searchLo2Official,
  usesAsoraOfficial,
  STAR_OFFICIAL_SEED,
  LO2_OFFICIAL_SEED,
  ASORA_OFFICIAL_SEED,
  searchAsoraOfficial,
  searchBd2Official,
  fetchOfficialViaJina,
} from "./index-lib-06.js";


/** Steam / BD2 / Smilegate official paths. Returns a result object, or null to continue. */
export async function officialEarlyLookup({
  lim,
  entryId,
  q,
  steamAppid,
  officialUrl,
  useBd2,
  useSmilegate,
  wlEntry,
  forDigest,
  locale,
}) {

      // 1) Steam appid official path (e.g. Horizon Walker)
      if (steamAppid) {
        const news = await steamNewsForApp(steamAppid, lim);
        const items = (news.items || []).map((it) => ({
          ...it,
          source: "official",
        }));
        return {
          ok: items.length > 0,
          game: entryId,
          query: q || null,
          via: "steam_appid",
          appid: steamAppid,
          count: items.length,
          items,
          ...(items.length ? {} : { error: news.error || "no_official" }),
        };
      }

      // 2) Brown Dust 2 official notices API (prefer over Jina SPA)
      if (useBd2) {
        try {
          // Digest / bare game-name queries → list; otherwise search endpoint
          const wl = wlEntry || {};
          const nameHints = [
            entryId,
            wl.name,
            wl.name_zh,
            ...(Array.isArray(wl.keywords) ? wl.keywords : []),
          ]
            .filter(Boolean)
            .map((x) => String(x).toLowerCase());
          const qIsGameName =
            !q || nameHints.includes(q.toLowerCase());
          const apiQ = qIsGameName ? "" : q;
          const fetched = await searchBd2Official({
            limit: lim,
            query: apiQ || undefined,
            locale: locale || "en",
            forDigest: !!forDigest,
          });
          let items = fetched.items || [];
          // Soft client filter when caller passed a non-game query
          if (q && !qIsGameName && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            if (filtered.length) items = filtered;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: "bd2_notices",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          return {
            ok: false,
            game: entryId,
            query: q || null,
            via: "bd2_notices",
            official_url: officialUrl,
            count: 0,
            items: [],
            error: truncate(e.message, 80),
          };
        }
      }

      // 3) Smilegate newsroom (miraesi / MIRESI) — live scrape + seed fallback
      if (useSmilegate) {
        try {
          const kwHints = [
            ...(Array.isArray(wlEntry.keywords) ? wlEntry.keywords : []),
            wlEntry.name,
            wlEntry.name_zh,
          ].filter(Boolean);
          const fetched = await searchSmilegateNewsroom({
            limit: lim,
            filterKeywords: kwHints,
          });
          let items = fetched.items || [];
          if (q && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            // Keep seeds/live if query is just the game name
            const nameHints = kwHints.map((x) => String(x).toLowerCase());
            const qIsGameName =
              !q || nameHints.includes(q.toLowerCase()) || q.toLowerCase() === entryId;
            if (filtered.length) items = filtered;
            else if (!qIsGameName) items = filtered;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: fetched.via || "smilegate_newsroom",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(fetched.scrape_error
              ? { scrape_error: fetched.scrape_error }
              : {}),
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          return {
            ok: false,
            game: entryId,
            query: q || null,
            via: "smilegate_newsroom",
            official_url: officialUrl,
            count: 0,
            items: [],
            error: truncate(e.message, 80),
          };
        }
      }


  return null;
}
