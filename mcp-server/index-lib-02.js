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

export * from "./index-lib-01.js";
import {
  withCache,
  isPrydwenHubItem,
  GK_ORIGIN,
  TAPTAP_ORIGIN,
  INVEN_ORIGIN,
  STEAM_STORE,
  STEAM_NEWS_API,
  TAPTAP_XUA,
  UA,
  RADAR_KEYWORDS,
  truncate,
  stripHtml,
  articleUrl,
  clampLimit,
  dedupeByUrl,
  resolveGameEntry,
  pickAlias,
  fetchJson,
  fetchText,
  isoFromUnix,
  mapSearchItem,
  expandGamekeeQueries,
  searchGamekeeEntries,
} from "./index-lib-01.js";


async function searchGamekee({ alias, query, limit = 5 }) {
  const lim = clampLimit(limit, 5, 10);
  const a = alias || "www";
  const q = String(query || "").trim();
  return withCache(
    "searchGamekee",
    { alias: a, query: q, limit: lim, v: 2 },
    async () => {
      const queries = q ? expandGamekeeQueries(a, q) : [""];
      const seen = new Set();
      const items = [];
      let lastErr = null;

      for (const qq of queries) {
        const params = new URLSearchParams({
          page_no: "1",
          limit: String(lim),
        });
        let url;
        if (qq) {
          params.set("keyword", qq);
          url = `${GK_ORIGIN}/v1/content/searchArticle?${params}`;
        } else {
          url = `${GK_ORIGIN}/v1/content/pageList?${params}`;
        }
        const res = await fetchJson(url, {
          headers: { "game-alias": a },
        });
        if (!res.body || res.body.code !== 0 || !Array.isArray(res.body.data)) {
          lastErr = truncate(
            res.body?.msg || res.bodyText || `http_${res.status}`,
            100
          );
          continue;
        }
        for (const it of res.body.data) {
          const row = mapSearchItem(it, a);
          const key = String(row.id || row.url || row.title);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(row);
          if (items.length >= lim) break;
        }
        if (items.length >= lim) break;
      }

      // Entity/wiki pages (角色图鉴) often miss searchArticle index — fall back to entry list.
      if (q && items.length < lim && a !== "www") {
        for (const qq of queries) {
          try {
            const entries = await searchGamekeeEntries({
              alias: a,
              query: qq,
              limit: lim,
            });
            for (const row of entries || []) {
              const key = String(row.id || row.url || row.title);
              if (seen.has(key)) continue;
              seen.add(key);
              items.push(row);
              if (items.length >= lim) break;
            }
          } catch {
            /* ignore entry fallback errors */
          }
          if (items.length >= lim) break;
        }
      }

      if (!items.length && lastErr && !q) {
        return {
          ok: false,
          error: lastErr,
          alias: a,
          query: q || null,
        };
      }
      return {
        ok: true,
        alias: a,
        query: q || null,
        queries: q ? queries : undefined,
        count: items.length,
        items: items.slice(0, lim),
      };
    }
  );
}

function parseArticleRef({ url, id, game }) {
  let articleId = id != null && id !== "" ? Number(id) : null;
  let alias = null;
  if (url) {
    const u = String(url).trim();
    const m =
      u.match(/gamekee\.com\/([^/]+)\/(?:article\/)?(\d+)/i) ||
      u.match(/gamekee\.com\/content\/(\d+)/i);
    if (m) {
      if (m[2]) {
        alias = m[1];
        articleId = Number(m[2]);
      } else {
        articleId = Number(m[1]);
      }
    } else {
      const m2 = u.match(/\/(\d+)(?:\.html)?(?:\?|#|$)/);
      if (m2) articleId = Number(m2[1]);
    }
  }
  if (!alias && game) {
    const entry = resolveGameEntry(game);
    alias = entry ? pickAlias(entry) : String(game).toLowerCase();
  }
  return { articleId, alias: alias || "www" };
}

async function getArticle({ url, id, game }) {
  const { articleId, alias } = parseArticleRef({ url, id, game });
  if (!articleId || !Number.isFinite(articleId)) {
    return { ok: false, error: "need_url_or_id" };
  }
  const detailUrl = `${GK_ORIGIN}/v1/content/detail/${articleId}`;
  const res = await fetchJson(detailUrl, {
    headers: { "game-alias": alias },
  });
  if (!res.body || res.body.code !== 0 || !res.body.data) {
    return {
      ok: false,
      error: truncate(
        res.body?.msg || res.bodyText || `http_${res.status}`,
        100
      ),
      id: articleId,
    };
  }
  const d = res.body.data;
  if (res.isHtml) {
    return { ok: false, error: "html_blocked", id: articleId };
  }
  const resolvedAlias = d.game?.alias || alias || "www";
  const summaryRaw =
    d.summary || d.desc || (typeof d.content === "string" ? d.content : "");
  const summary = truncate(stripHtml(summaryRaw), 800);
  return {
    ok: true,
    id: d.id || articleId,
    title: truncate(d.title || "", 160),
    url: articleUrl(resolvedAlias, d.id || articleId),
    summary,
    updated: isoFromUnix(d.updated_at || d.last_at || d.created_at),
    game: d.game
      ? { id: d.game.id, name: d.game.name, alias: d.game.alias }
      : null,
  };
}

/* ---------------- TapTap ---------------- */

async function taptapApi(apiPath, params = {}) {
  const qs = new URLSearchParams({ ...params, "X-UA": TAPTAP_XUA });
  const url = `${TAPTAP_ORIGIN}${apiPath}?${qs}`;
  return fetchJson(url, {
    headers: {
      Accept: "application/json",
      Referer: TAPTAP_ORIGIN + "/",
    },
    timeoutMs: 15000,
  });
}

async function searchTaptap({ query, limit = 5 }) {
  const lim = clampLimit(limit, 5, 8);
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "need_query", items: [] };
  return withCache("searchTaptap", { query: q, limit: lim }, async () => {
  const items = [];
  let err = null;

  try {
    const appRes = await taptapApi("/webapiv2/app-search/v1/by-keyword", {
      kw: q,
    });
    const list = appRes.body?.data?.list;
    if (appRes.ok && Array.isArray(list)) {
      for (const it of list) {
        if (items.length >= lim) break;
        const id = it?.id;
        const title = truncate(it?.title || "", 120);
        if (!id || !title) continue;
        items.push({
          title,
          url: `${TAPTAP_ORIGIN}/app/${id}`,
          source: "taptap",
        });
      }
    } else if (!items.length) {
      err = truncate(
        appRes.body?.data?.msg ||
          appRes.body?.msg ||
          appRes.bodyText ||
          `http_${appRes.status}`,
        80
      );
    }
  } catch (e) {
    err = truncate(e.message, 80);
  }

  // Best-effort moments/community fill if under limit
  if (items.length < lim) {
    try {
      const com = await taptapApi("/webapiv2/search/v2/community", { kw: q });
      const list = com.body?.data?.list;
      if (com.ok && Array.isArray(list)) {
        for (const row of list) {
          if (items.length >= lim) break;
          if (row?.type && row.type !== "moment") continue;
          const mom = row.moment || {};
          const id = mom.id_str || mom.id;
          const summary = stripHtml(row.search_content?.summary || "");
          const appTitle = mom.app?.title || "";
          const title = truncate(
            summary || appTitle || `moment:${id || ""}`,
            120
          );
          if (!id || !title) continue;
          items.push({
            title,
            url: `${TAPTAP_ORIGIN}/moment/${id}`,
            source: "taptap",
          });
        }
      }
    } catch {
      /* ignore community failures */
    }
  }

  // Prefer non-hub pages; keep hubs only if nothing else fills the limit
  const ranked = dedupeByUrl(items).sort((a, b) => {
    const ah = isPrydwenHubItem(a) ? 1 : 0;
    const bh = isPrydwenHubItem(b) ? 1 : 0;
    if (ah !== bh) return ah - bh;
    return 0;
  });
  const nonHub = ranked.filter((it) => !isPrydwenHubItem(it));
  const deduped = (nonHub.length ? nonHub : ranked).slice(0, lim);
  return {
    ok: deduped.length > 0,
    query: q,
    count: deduped.length,
    items: deduped,
    ...(deduped.length ? {} : { error: err || "no_results" }),
  };
  });
}

/* ---------------- Inven ---------------- */

async function searchInven({ query, limit = 5 }) {
  const lim = clampLimit(limit, 5, 8);
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "need_query", items: [] };
  return withCache("searchInven", { query: q, limit: lim }, async () => {
  // Fragile HTML selectors: board/{game}/{boardId}/{postId} anchors on search page
  const url = `${INVEN_ORIGIN}/search/webzine/article/${encodeURIComponent(q)}`;
  try {
    const res = await fetchText(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      timeoutMs: 18000,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `http_${res.status}`,
        query: q,
        items: [],
      };
    }
    const html = res.text;
    const items = [];
    const seen = new Set();
    const re =
      /href="(https:\/\/www\.inven\.co\.kr\/board\/[^"/]+\/\d+\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && items.length < lim) {
      const href = m[1];
      if (seen.has(href)) continue;
      const title = truncate(stripHtml(m[2]), 120);
      if (!title || title.length < 4) continue;
      seen.add(href);
      items.push({ title, url: href, source: "inven" });
    }
    return {
      ok: items.length > 0,
      query: q,
      count: items.length,
      items,
      ...(items.length ? {} : { error: "no_results_or_selectors" }),
    };
  } catch (e) {
    return {
      ok: false,
      error: truncate(e.message, 80),
      query: q,
      items: [],
    };
  }
  });
}

/* ---------------- Steam ---------------- */

function parseSteamSuggest(html) {
  const out = [];
  const re =
    /data-ds-appid="(\d+)"[^>]*href="([^"]+)"[\s\S]*?<div class="match_name">([^<]+)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    out.push({
      appid: m[1],
      url: m[2].split("?")[0],
      title: truncate(stripHtml(m[3]), 120),
    });
  }
  return out;
}

function parseSteamStoreSearch(html) {
  const out = [];
  const re =
    /data-ds-appid="(\d+)"[^>]*>[\s\S]*?class="title">([^<]+)</gi;
  let m;
  while ((m = re.exec(html))) {
    const appid = m[1];
    out.push({
      appid,
      title: truncate(stripHtml(m[2]), 120),
      url: `${STEAM_STORE}/app/${appid}/`,
    });
  }
  return out;
}

async function resolveSteamApps(query, limit = 3) {
  const q = String(query || "").trim();
  if (!q) return [];
  // suggest endpoint (fragile class=match_name)
  try {
    const sugUrl =
      `${STEAM_STORE}/search/suggest?` +
      new URLSearchParams({
        term: q,
        f: "games",
        cc: "US",
        l: "english",
      });
    const sug = await fetchText(sugUrl, { timeoutMs: 12000 });
    if (sug.ok && sug.text) {
      const parsed = parseSteamSuggest(sug.text);
      if (parsed.length) return parsed.slice(0, limit);
    }
  } catch {
    /* fall through */
  }
  try {
    const storeUrl =
      `${STEAM_STORE}/search/?` +
      new URLSearchParams({ term: q, category1: "998" });
    const page = await fetchText(storeUrl, { timeoutMs: 15000 });
    if (page.ok && page.text) {
      return parseSteamStoreSearch(page.text).slice(0, limit);
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function steamNewsForApp(appid, limit = 5) {
  const lim = clampLimit(limit, 5, 8);
  const url =
    `${STEAM_NEWS_API}?` +
    new URLSearchParams({
      appid: String(appid),
      count: String(lim),
      maxlength: "0",
    });
  const res = await fetchJson(url, { timeoutMs: 12000 });
  const newsitems = res.body?.appnews?.newsitems;
  if (!res.ok || !Array.isArray(newsitems)) {
    return {
      ok: false,
      error: truncate(res.bodyText || `http_${res.status}`, 80),
      items: [],
    };
  }
  const items = newsitems.slice(0, lim).map((n) => {
    // Keep Steam/Akamai announcement URLs as-is (they 302 to community deep links).
    // Only fall back to the app news list page when url is missing.
    const rawUrl = n.url != null ? String(n.url).trim() : "";
    const url = rawUrl || `${STEAM_STORE}/news/app/${appid}/`;
    return {
      title: truncate(n.title || "", 120),
      url,
      date: n.date ? isoFromUnix(n.date) : null,
      source: "steam",
    };
  });
  return { ok: items.length > 0, items };
}

async function searchSteam({ query, appid, limit = 5 }) {
  const lim = clampLimit(limit, 5, 8);
  const aid =
    appid != null && String(appid).trim() !== ""
      ? String(appid).trim()
      : null;
  const q = String(query || "").trim();
  if (!aid && !q) return { ok: false, error: "need_query_or_appid", items: [] };
  return withCache(
    "searchSteam",
    { query: q || null, appid: aid, limit: lim },
    async () => {
      if (aid) {
        const news = await steamNewsForApp(aid, lim);
        return {
          ok: news.ok,
          appid: aid,
          query: q || null,
          count: news.items.length,
          items: news.items,
          ...(news.ok ? {} : { error: news.error || "no_news" }),
        };
      }

      const apps = await resolveSteamApps(q, 3);
      if (!apps.length) {
        return {
          ok: false,
          error: "no_steam_match",
          query: q,
          items: [],
        };
      }

      // Prefer news from first match; pad with other store hits
      const items = [];
      const primary = apps[0];
      const news = await steamNewsForApp(primary.appid, lim);
      for (const it of news.items) {
        if (items.length >= lim) break;
        items.push(it);
      }
      for (const a of apps) {
        if (items.length >= lim) break;
        items.push({
          title: a.title,
          url: a.url,
          date: null,
          source: "steam",
        });
      }
      const deduped = dedupeByUrl(items).slice(0, lim);
      return {
        ok: deduped.length > 0,
        query: q,
        appid: primary.appid,
        count: deduped.length,
        items: deduped,
      };
    }
  );
}

/* ---------------- Radar ---------------- */

function radarHitTitle(title) {
  const t = String(title || "");
  for (const kw of RADAR_KEYWORDS) {
    if (t.toLowerCase().includes(kw.toLowerCase())) return kw;
  }
  return null;
}

export {
  searchGamekee,
  parseArticleRef,
  getArticle,
  taptapApi,
  searchTaptap,
  searchInven,
  parseSteamSuggest,
  parseSteamStoreSearch,
  resolveSteamApps,
  steamNewsForApp,
  searchSteam,
  radarHitTitle,
};
