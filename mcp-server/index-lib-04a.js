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
  PRYDWEN_ORIGIN,
  NIKKEGG_FEED,
  BD2_API_ORIGIN,
  BD2_SITE_ORIGIN,
  BD2_LOCALE_MAP,
  BD2_DIGEST_CAT_PREF,
  truncate,
  stripHtml,
  clampLimit,
  dedupeByUrl,
  itemDateMs,
  fetchJson,
  fetchText,
  parseRssItems,
  isNikkeContext,
  prydwenTitleFromPath,
  PRYDWEN_NAV_JUNK,
} from "./index-lib-03.js";


function prydwenLinkScore(pathname, query) {
  const p = String(pathname || "").toLowerCase();
  const norm = p.replace(/\/+$/, "");
  let score = 0;
  if (/\/characters\//.test(p)) score += 60;
  if (/\/guides\//.test(p)) score += 35;
  if (/\/banners\//.test(p)) score += 40;
  if (/wishlist|meta-teams|beginners/.test(p)) score += 12;
  if (/tier-list/.test(p) && !/^\/nikke\/tier-list$/.test(norm)) score += 12;
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (q && q !== "nikke" && p.includes(q.replace(/\s+/g, "-"))) score += 20;
  if (PRYDWEN_NAV_JUNK.has(norm) || PRYDWEN_NAV_JUNK.has(p)) score -= 100;
  if (/^\/nikke\/(tools|builds|teams-database)$/.test(norm)) score -= 100;
  // Bare hub index pages: demote hard so character/news win first slots
  if (/^\/nikke\/(banners|tier-list|characters|guides)$/.test(norm)) {
    score -= 120;
  }
  return score;
}

function extractPrydwenLinks(html) {
  const found = new Map();
  const re = /(?:href|url)=["'](\/nikke\/[^"'#?]+)/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let pathOnly = m[1].split("#")[0].split("?")[0];
    if (!pathOnly.startsWith("/nikke/")) continue;
    const key = pathOnly.replace(/\/+$/, "") || "/nikke";
    if (!found.has(key)) found.set(key, pathOnly);
  }
  return [...found.keys()];
}

async function scrapePrydwenNikke(query, limit) {
  const pages = [
    PRYDWEN_ORIGIN + "/nikke/",
    PRYDWEN_ORIGIN + "/nikke/banners",
  ];
  const scored = [];
  const seen = new Set();
  for (const url of pages) {
    try {
      const res = await fetchText(url, {
        headers: { Accept: "text/html" },
        timeoutMs: 15000,
      });
      if (!res.ok) continue;
      for (const pathname of extractPrydwenLinks(res.text)) {
        const score = prydwenLinkScore(pathname, query);
        if (score < 10) continue;
        const abs = PRYDWEN_ORIGIN + pathname;
        if (seen.has(abs)) continue;
        seen.add(abs);
        scored.push({
          title: prydwenTitleFromPath(pathname),
          url: abs,
          source: "prydwen",
          _score: score,
        });
      }
    } catch {
      /* ignore page */
    }
  }
  scored.sort(
    (a, b) => b._score - a._score || a.title.localeCompare(b.title)
  );
  return scored.slice(0, limit).map(({ _score, ...rest }) => rest);
}

async function searchNikkeGgFeed({ query, limit = 5 }) {
  const lim = clampLimit(limit, 5, 8);
  const q = String(query || "").trim();
  const nikkeCtx = isNikkeContext(q, null);
  try {
    const res = await fetchText(NIKKEGG_FEED, {
      headers: { Accept: "application/rss+xml,application/xml,text/xml,*/*" },
      timeoutMs: 15000,
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}`, items: [] };
    }
    const parsed = parseRssItems(res.text);
    const qLower = q.toLowerCase();
    const items = [];
    for (const it of parsed) {
      if (items.length >= lim) break;
      if (q && !nikkeCtx) {
        const hay = (it.title + "\n" + (it.description || "")).toLowerCase();
        if (!hay.includes(qLower)) continue;
      }
      items.push({
        title: it.title,
        url: it.url,
        date: it.date || null,
        source: "nikkegg",
      });
    }
    return {
      ok: items.length > 0,
      query: q || "NIKKE",
      count: items.length,
      items,
      ...(items.length ? {} : { error: "no_match" }),
    };
  } catch (e) {
    return { ok: false, error: truncate(e.message, 80), items: [] };
  }
}

async function searchPrydwen({ query, limit = 5 } = {}) {
  const lim = clampLimit(limit, 5, 8);
  const q = String(query || "NIKKE").trim() || "NIKKE";
  return withCache("searchPrydwen", { query: q, limit: lim }, async () => {
  const nikkeCtx = isNikkeContext(q, null);

  const items = [];
  // Prydwen HTML scrape only makes sense for NIKKE
  if (nikkeCtx) {
    try {
      const pry = await scrapePrydwenNikke(q, Math.max(2, Math.ceil(lim / 2)));
      for (const it of pry) {
        if (items.length >= lim) break;
        items.push(it);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const feedLim = Math.max(1, lim - items.length || Math.ceil(lim / 2));
    const feed = await searchNikkeGgFeed({ query: q, limit: feedLim });
    for (const it of feed.items || []) {
      if (items.length >= lim) break;
      items.push(it);
    }
  } catch {
    /* ignore */
  }

  const deduped = dedupeByUrl(items).slice(0, lim);
  return {
    ok: deduped.length > 0,
    query: q,
    count: deduped.length,
    items: deduped,
    ...(deduped.length
      ? {}
      : {
          error: nikkeCtx ? "no_items" : "not_nikke_context_no_match",
        }),
  };
  });
}


/* ---------------- Official sources ---------------- */

function parseNikkeOfficialTitle(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  // Drop trailing body snippet after NEW!
  t = t.replace(/\s*NEW![\s\S]*$/i, "").trim();
  // Prefer IMPORTANT / date-prefixed headline chunk
  const m = t.match(
    /^(IMPORTANT\s+\d{1,2}-\d{1,2}\s+.+?)(?:\s{2,}|\s+Commanders[,:]|\s+Hello\.|$)/i
  );
  if (m) return truncate(m[1].trim(), 120);
  // Truncate long marketing paste
  if (t.length > 140) {
    const cut = t.slice(0, 140);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 60 ? cut.slice(0, sp) : cut).trim();
  }
  return truncate(t, 120);
}

function parseOfficialDateFromTitle(title) {
  const t = String(title || "");
  // IMPORTANT MM-DD ...
  let m = t.match(/\b(\d{1,2})-(\d{1,2})\b/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const now = new Date();
      let year = now.getUTCFullYear();
      // Assume current year; if far in future relative to now-60d window, leave null
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function parseJinaOfficialLinks(md, { hostIncludes, pathIncludes, requireDetail } = {}) {
  const text = String(md || "");
  const items = [];
  const seen = new Set();
  // Titles from Jina can be very long (headline + body snippet)
  const re = /\[([^\]]{2,1200})\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const rawTitle = stripHtml(m[1]);
    let url = m[2].trim();
    try {
      const u = new URL(url);
      url = u.origin + u.pathname + u.search;
    } catch {
      continue;
    }
    if (hostIncludes && !hostIncludes.some((h) => includesCI(url, h))) continue;
    if (pathIncludes && !pathIncludes.some((p) => includesCI(url, p))) continue;
    // Skip pure nav / social
    if (/youtube|discord|facebook|twitter|tiktok|instagram/i.test(url)) continue;
    if (
      /\/(character|story|pack|screenshot|media|contest|events\/)/i.test(url) &&
      !/newsdetail|content_id/i.test(url)
    ) {
      continue;
    }
    // Listing / filter pages are not articles
    if (/[?&](page|type)=/i.test(url) && !/content_id|newsdetail/i.test(url)) {
      continue;
    }
    if (requireDetail && !/newsdetail|content_id|\/news\/\d+/i.test(url)) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const title = parseNikkeOfficialTitle(rawTitle);
    if (!title || title.length < 4) continue;
    // Skip bare nav / locale labels
    if (
      /^(HOME|NEWS|ABOUT GAME|MEDIA|ALL|NOTICE|MAINTENANCE|EVENT|PREV|NEXT|SPECIAL|Developer Notes|Package Products|Known Issues)$/i.test(
        title
      )
    ) {
      continue;
    }
    if (/^(한국어|中文|日本語|English)$/i.test(title)) continue;
    items.push({
      title,
      url,
      date: parseOfficialDateFromTitle(title),
      source: "official",
    });
  }
  return items;
}


export {
  prydwenLinkScore,
  extractPrydwenLinks,
  scrapePrydwenNikke,
  searchNikkeGgFeed,
  searchPrydwen,
  parseNikkeOfficialTitle,
  parseOfficialDateFromTitle,
  parseJinaOfficialLinks,
};
