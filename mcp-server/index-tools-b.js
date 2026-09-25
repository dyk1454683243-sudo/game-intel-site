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

import { server } from "./index-tools-a.js";
import {
  DATA_DIR,
  GK_ORIGIN,
  INVEN_ORIGIN,
  STEAM_NEWS_API,
  BAHAMUT_GNN_RSS,
  PRYDWEN_ORIGIN,
  NIKKEGG_FEED,
  textResult,
  truncate,
  readWatchlist,
  resolveGameEntry,
  fetchJson,
  fetchText,
  getArticle,
  taptapApi,
  searchTaptap,
  searchInven,
  searchSteam,
  radar,
  searchBahamut,
  searchPrydwen,
  digestGame,
  buildCalendar,
} from "./index-lib-09.js";

server.tool(
  "radar",
  "Aggregate launch/CBT/公测/预约 headlines across TapTap+Inven+GameKee. Optional q. Max 15, deduped.",
  {
    q: z.string().max(40).optional(),
  },
  async ({ q }) => {
    try {
      return textResult(await radar({ q }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80), items: [] });
    }
  }
);

server.tool(
  "get_article",
  "Fetch one GameKee article by url or id. Returns {title,url,summary<=800,updated}. No HTML.",
  {
    url: z.string().url().optional(),
    id: z.union([z.number().int(), z.string()]).optional(),
    game: z.string().optional(),
  },
  async ({ url, id, game }) => {
    try {
      if (!url && (id === undefined || id === null || id === "")) {
        return textResult({ ok: false, error: "need_url_or_id" });
      }
      const out = await getArticle({ url, id, game });
      return textResult(out);
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);

server.tool(
  "digest",
  "Multi-source headlines for one/all watchlist games (GameKee+official+TapTap+Bahamut; Prydwen for NIKKE; Inven for miraesi/lo2). Max 5 mixed each. summarize=true attaches ≤240char get_article summaries for top GameKee items. diff=true marks is_new vs digest-seen.json snapshot; only_new filters to new items. Morning routine: digest({ summarize:true, diff:true, only_new:true }).",
  {
    game: z.string().optional(),
    summarize: z.boolean().optional().default(false),
    diff: z.boolean().optional().default(false),
    only_new: z.boolean().optional().default(false),
  },
  async ({ game, summarize, diff, only_new }) => {
    try {
      const wl = readWatchlist();
      let entries;
      if (game) {
        const entry = resolveGameEntry(game);
        if (!entry) {
          return textResult({ ok: false, error: "unknown_game", game });
        }
        entries = [[entry.id, entry]];
      } else {
        entries = Object.entries(wl);
      }
      const digests = [];
      for (const [id, entry] of entries) {
        digests.push(
          await digestGame(id, entry, {
            summarize: !!summarize,
            diff: !!diff,
            only_new: !!only_new,
          })
        );
      }
      return textResult({
        ok: digests.some((d) => d.ok),
        count: digests.length,
        digests,
      });
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);


server.tool(
  "calendar",
  "Gacha/event calendar from digest/official headlines. Heuristic dates+types (banner/event/maintenance/collab/login/other); enriches undated events from article body/summary (GameKee detail or Jina, capped). Relative 今日/tomorrow → Asia/Shanghai. Args: game?, limit<=30 (default 20). Returns short JSON events with start/end YYYY-MM-DD.",
  {
    game: z.string().optional(),
    limit: z.number().int().min(1).max(30).default(20),
  },
  async ({ game, limit }) => {
    try {
      return textResult(
        await buildCalendar({
          game: game || undefined,
          limit: limit ?? 20,
        })
      );
    } catch (e) {
      return textResult({
        ok: false,
        error: truncate(e.message, 80),
        count: 0,
        as_of: new Date().toISOString(),
        events: [],
      });
    }
  }
);


server.tool(
  "resolve_alias",
  "Horizon Walker nickname → canonical id/name (修女→lysandria, 虎鲸→yuha, 木星→set_iuppiter, …). Args: q.",
  {
    q: z.string().min(1).max(80),
  },
  async ({ q }) => {
    try {
      return textResult(resolveHwAlias(DATA_DIR, q));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);

server.tool(
  "guide_hw",
  "Horizon Walker short guide card from local data (skills/stigmata/skill_prio/dopamine teams). Prefer over inventing. Args: q|id, topic?=overview|skills|stigmata|dopamine|all. Example: guide_hw({ q:'修女圣痕', topic:'stigmata' }).",
  {
    q: z.string().max(80).optional(),
    id: z.string().max(40).optional(),
    topic: z
      .enum(["overview", "skills", "stigmata", "dopamine", "all"])
      .optional(),
  },
  async ({ q, id, topic }) => {
    try {
      if (!q && !id) {
        return textResult({ ok: false, error: "need_q_or_id" });
      }
      return textResult(
        cachedGuide(DATA_DIR, {
          game: "hw",
          q: q || undefined,
          id: id || undefined,
          topic: topic || undefined,
        })
      );
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);

server.tool(
  "guide",
  "Multi-game guide card. Args: game (default hw), q|id, topic?=overview|skills|stigmata|dopamine|all. HW fully supported; other watchlist games return no_cards_yet until verified cards exist. Prefer over inventing skill names/numbers.",
  {
    game: z.string().max(20).optional(),
    q: z.string().max(80).optional(),
    id: z.string().max(40).optional(),
    topic: z
      .enum(["overview", "skills", "stigmata", "dopamine", "all"])
      .optional(),
  },
  async ({ game, q, id, topic }) => {
    try {
      if (!q && !id && (game || "hw") === "hw") {
        // allow dopamine-only via topic on hw
        if (topic !== "dopamine") {
          return textResult({ ok: false, error: "need_q_or_id" });
        }
      }
      if (!q && !id && game && game !== "hw") {
        return textResult({ ok: false, error: "need_q_or_id", game });
      }
      return textResult(
        cachedGuide(DATA_DIR, {
          game: game || "hw",
          q: q || undefined,
          id: id || undefined,
          topic: topic || undefined,
        })
      );
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);

server.tool(
  "list_guides",
  "List guide coverage per watchlist game (character counts, stub/rich). Args: game? optional filter.",
  {
    game: z.string().max(20).optional(),
  },
  async ({ game }) => {
    try {
      return textResult(listGuides(DATA_DIR, { game: game || undefined }));
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);


server.tool(
  "ask_intel",
  "Jev-gated intel ask. Runs jev gate game-intel on state, then answer/deep → local guide card (cached); brief → digest note; ask_dai/skip/escalate → return for parent. Args: state (required), game?, with_digest?. Requires PATH incl. $HOME/bin or JEV_PATH_PREFIX for jev.",
  {
    state: z.string().min(1).max(500),
    game: z.string().max(20).optional(),
    with_digest: z.boolean().optional(),
  },
  async ({ state, game, with_digest }) => {
    try {
      const out = await askIntel(DATA_DIR, {
        state,
        game: game || undefined,
        with_digest: !!with_digest,
      });
      return textResult(out);
    } catch (e) {
      return textResult({ ok: false, error: truncate(e.message, 80) });
    }
  }
);

server.tool(
  "healthcheck",
  "Probe GameKee/TapTap/Inven/Steam/Bahamut GNN/nikke.gg (+optional Prydwen). Returns {ok,latency_ms,sources}.",
  {},
  async () => {
    const start = Date.now();
    const sources = {};
    try {
      const gkStart = Date.now();
      const gk = await fetchJson(
        `${GK_ORIGIN}/v1/content/pageList?page_no=1&limit=1`,
        {
          headers: { "game-alias": "nikke" },
          timeoutMs: 12000,
        }
      );
      sources.gamekee = {
        ok: !!(gk.body && gk.body.code === 0),
        latency_ms: Date.now() - gkStart,
        parse_ok: !!(gk.body && typeof gk.body.code === "number"),
        probe: "content_pageList_nikke",
      };
    } catch (e) {
      sources.gamekee = {
        ok: false,
        parse_ok: false,
        error: truncate(e.message, 60),
      };
    }
    try {
      const tpStart = Date.now();
      const tap = await taptapApi("/webapiv2/app-search/v1/by-keyword", {
        kw: "NIKKE",
      });
      sources.taptap = {
        ok: !!(tap.ok && Array.isArray(tap.body?.data?.list)),
        latency_ms: Date.now() - tpStart,
        status: tap.status,
        probe: "app-search_by-keyword",
      };
    } catch (e) {
      sources.taptap = { ok: false, error: truncate(e.message, 60) };
    }
    try {
      const ivStart = Date.now();
      const inv = await fetchText(
        `${INVEN_ORIGIN}/search/webzine/article/NIKKE`,
        { timeoutMs: 12000 }
      );
      sources.inven = {
        ok: inv.ok && inv.text.includes("inven"),
        latency_ms: Date.now() - ivStart,
        status: inv.status,
        probe: "search_webzine_article",
      };
    } catch (e) {
      sources.inven = { ok: false, error: truncate(e.message, 60) };
    }
    try {
      const stStart = Date.now();
      const st = await fetchJson(
        `${STEAM_NEWS_API}?appid=730&count=1`,
        { timeoutMs: 12000 }
      );
      sources.steam = {
        ok: !!(st.body?.appnews?.newsitems?.length),
        latency_ms: Date.now() - stStart,
        probe: "ISteamNews_730",
      };
    } catch (e) {
      sources.steam = { ok: false, error: truncate(e.message, 60) };
    }
    try {
      const bhStart = Date.now();
      const bh = await fetchText(BAHAMUT_GNN_RSS, {
        headers: { Accept: "application/rss+xml,application/xml,text/xml,*/*" },
        timeoutMs: 12000,
      });
      sources.bahamut = {
        ok: bh.ok && /<item>/i.test(bh.text || ""),
        latency_ms: Date.now() - bhStart,
        status: bh.status,
        probe: "gnn_rss",
      };
    } catch (e) {
      sources.bahamut = { ok: false, error: truncate(e.message, 60) };
    }
    try {
      const ngStart = Date.now();
      const ng = await fetchText(NIKKEGG_FEED, {
        headers: { Accept: "application/rss+xml,application/xml,text/xml,*/*" },
        timeoutMs: 12000,
      });
      sources.nikkegg = {
        ok: ng.ok && /<item>/i.test(ng.text || ""),
        latency_ms: Date.now() - ngStart,
        status: ng.status,
        probe: "nikke_gg_feed",
      };
    } catch (e) {
      sources.nikkegg = { ok: false, error: truncate(e.message, 60) };
    }
    try {
      const pyStart = Date.now();
      const py = await fetchText(PRYDWEN_ORIGIN + "/nikke/", {
        headers: { Accept: "text/html" },
        timeoutMs: 12000,
      });
      sources.prydwen = {
        ok: py.ok && /\/nikke\//i.test(py.text || ""),
        latency_ms: Date.now() - pyStart,
        status: py.status,
        probe: "prydwen_nikke_html",
      };
    } catch (e) {
      sources.prydwen = { ok: false, error: truncate(e.message, 60) };
    }
    const ok = Object.values(sources).some((s) => s && s.ok);
    return textResult({
      ok,
      latency_ms: Date.now() - start,
      sources,
    });
  }
);

async function smoke() {
  const out = {};
  try {
    out.resolve_alias = resolveHwAlias(DATA_DIR, "修女");
    out.guide_hw_stigmata = guideHwCard(DATA_DIR, { q: "修女圣痕", topic: "stigmata" });
    out.guide_hw_dopamine = guideHwCard(DATA_DIR, { q: "多巴胺", topic: "dopamine" });
    out.hw_chars = listCharacterIds(DATA_DIR);
    out.guide = guideAny(DATA_DIR, { game: "hw", q: "修女", topic: "overview" });
    out.guide_nikke = guideAny(DATA_DIR, { game: "nikke", id: "rapi" });
    out.list_guides = listGuides(DATA_DIR);
  } catch (e) {
    out.hw_guides = { ok: false, error: String(e.message || e) };
  }
  try {
    out.taptap = await searchTaptap({ query: "NIKKE", limit: 2 });
  } catch (e) {
    out.taptap = { ok: false, error: String(e.message || e) };
  }
  try {
    out.inven = await searchInven({ query: "NIKKE", limit: 2 });
  } catch (e) {
    out.inven = { ok: false, error: String(e.message || e) };
  }
  try {
    out.steam = await searchSteam({ query: "Counter-Strike", limit: 2 });
  } catch (e) {
    out.steam = { ok: false, error: String(e.message || e) };
  }
  try {
    out.bahamut = await searchBahamut({ query: "NIKKE", limit: 3 });
  } catch (e) {
    out.bahamut = { ok: false, error: String(e.message || e) };
  }
  try {
    out.prydwen = await searchPrydwen({ query: "NIKKE", limit: 4 });
  } catch (e) {
    out.prydwen = { ok: false, error: String(e.message || e) };
  }
  try {
    out.radar = await radar({ q: "公测" });
    if (out.radar?.items) {
      out.radar_titles = out.radar.items.map((it) => it.title);
      out.radar.items = out.radar.items.slice(0, 5);
    }
  } catch (e) {
    out.radar = { ok: false, error: String(e.message || e) };
  }
  console.log(JSON.stringify(out, null, 2));
}


export { server };
