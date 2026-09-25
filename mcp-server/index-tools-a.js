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
  BAHAMUT_BSN,
  textResult,
  truncate,
  readWatchlist,
  writeWatchlist,
  resolveGameEntry,
  pickAlias,
  pickQuery,
  searchGamekee,
  searchTaptap,
  searchInven,
  searchSteam,
  bahamutPreferredQuery,
  searchBahamut,
  searchPrydwen,
  searchOfficial,
} from "./index-lib-09.js";

const server = new McpServer({
  name: "game-intel",
  version: "0.3.23",
});

server.tool(
  "watchlist",
  "Return current watchlist short JSON (id → name/keywords/alias).",
  {},
  async () => {
    const wl = readWatchlist();
    const games = Object.entries(wl).map(([id, e]) => ({
      id,
      name: e.name || "",
      name_zh: e.name_zh || "",
      gamekee_alias: e.gamekee_alias ?? null,
      keywords: Array.isArray(e.keywords) ? e.keywords.slice(0, 8) : [],
    }));
    return textResult({ ok: true, count: games.length, games });
  }
);

server.tool(
  "add_watch",
  "Add/update a watchlist entry. Persists to data/watchlist.json",
  {
    id: z.string().min(1).max(32),
    name: z.string().min(1).max(80),
    name_zh: z.string().max(80).optional(),
    keywords: z.array(z.string().max(40)).max(12).default([]),
    gamekee_alias: z.string().max(32).nullable().optional(),
  },
  async ({ id, name, name_zh, keywords, gamekee_alias }) => {
    const key = String(id).toLowerCase().trim().replace(/[^a-z0-9_-]/g, "");
    if (!key) return textResult({ ok: false, error: "bad_id" });
    const wl = readWatchlist();
    const prev = wl[key] || {};
    wl[key] = {
      name: String(name).trim(),
      name_zh: name_zh != null ? String(name_zh).trim() : prev.name_zh || "",
      gamekee_alias:
        gamekee_alias === undefined
          ? prev.gamekee_alias ?? null
          : gamekee_alias
            ? String(gamekee_alias).trim()
            : null,
      keywords: (Array.isArray(keywords) ? keywords : [])
        .map((k) => String(k).trim())
        .filter(Boolean)
        .slice(0, 12),
      ...(prev.steam_appid != null ? { steam_appid: prev.steam_appid } : {}),
      ...(prev.official_url ? { official_url: prev.official_url } : {}),
    };
    writeWatchlist(wl);
    return textResult({ ok: true, id: key, entry: wl[key] });
  }
);

server.tool(
  "remove_watch",
  "Remove a watchlist entry by id.",
  {
    id: z.string().min(1).max(32),
  },
  async ({ id }) => {
    const key = String(id).toLowerCase().trim();
    const wl = readWatchlist();
    if (!wl[key]) return textResult({ ok: false, error: "not_found", id: key });
    delete wl[key];
    writeWatchlist(wl);
    return textResult({ ok: true, removed: key });
  }
);

server.tool(
  "search_gamekee",
  "Search GameKee articles. Args: game|query, limit<=10. Returns [{title,url,id,updated}].",
  {
    game: z.string().optional(),
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  },
  async ({ game, query, limit }) => {
    try {
      const entry = game ? resolveGameEntry(game) : null;
      const alias = entry ? pickAlias(entry) : "www";
      const q =
        String(query || "").trim() ||
        (entry ? (alias === "www" ? pickQuery(entry) : "") : "");
      if (!q && !entry && !game) {
        return textResult({
          ok: false,
          error: "need_game_or_query",
        });
      }
      const useAlias =
        entry && entry.gamekee_alias
          ? entry.gamekee_alias
          : game && !entry
            ? String(game).toLowerCase()
            : alias;
      const out = await searchGamekee({
        alias: useAlias,
        query: q,
        limit,
      });
      return textResult({
        ...out,
        game: entry?.id || game || null,
      });
    } catch (e) {
      return textResult({
        ok: false,
        error: truncate(e.message, 80),
      });
    }
  }
);

server.tool(
  "search_taptap",
  "Search TapTap apps/moments best-effort. Args: query, limit<=8. Returns [{title,url,source:taptap}].",
  {
    query: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ query, limit }) => {
    try {
      return textResult(await searchTaptap({ query, limit }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "search_inven",
  "Search Inven (KR) webzine/boards. Args: query (KO/EN), limit<=8. Returns [{title,url,source:inven}].",
  {
    query: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ query, limit }) => {
    try {
      return textResult(await searchInven({ query, limit }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "search_bahamut",
  "Bahamut per-game intel: Jina GNN search (type=2) + 哈啦板 scrape + RSS token match. Args: query required, limit<=8. Returns [{title,url,date?,source:bahamut}].",
  {
    query: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ query, limit }) => {
    try {
      const entry = resolveGameEntry(query);
      const game = entry?.id || null;
      return textResult(
        await searchBahamut({
          query: game ? bahamutPreferredQuery(game, query) : query,
          limit,
          game,
          bsn: game ? BAHAMUT_BSN[game] ?? null : null,
        })
      );
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "search_prydwen",
  "NIKKE Prydwen links + nikke.gg RSS. Args: query optional (default NIKKE), limit<=8. Items source prydwen|nikkegg.",
  {
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ query, limit }) => {
    try {
      return textResult(await searchPrydwen({ query, limit }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "search_steam",
  "Steam news/search. Args: query and/or appid, limit<=8. Returns [{title,url,date?,source:steam}].",
  {
    query: z.string().max(80).optional(),
    appid: z.union([z.number().int(), z.string()]).optional(),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ query, appid, limit }) => {
    try {
      return textResult(await searchSteam({ query, appid, limit }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "search_official",
  "Official news for a watchlist game (BD2 notices API / Jina official_url / steam_appid). Args: game, query?, limit<=8. source=official.",
  {
    game: z.string().min(1).max(40),
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(8).default(5),
  },
  async ({ game, query, limit }) => {
    try {
      return textResult(await searchOfficial({ game, query, limit }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);


export { server };
