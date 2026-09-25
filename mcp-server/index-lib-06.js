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

export * from "./index-lib-05.js";
import {
  BD2_API_ORIGIN,
  BD2_SITE_ORIGIN,
  truncate,
  stripHtml,
  clampLimit,
  fetchJson,
  fetchText,
  parseJinaOfficialLinks,
  mapBd2Locale,
  bd2ViewUrl,
  preferBd2OfficialForDigest,
  parseHtmlAnchorLinks,
  matchesAsoraOfficial,
  isAsoraJunkOfficialItem,
  ASORA_PLAYNC_ORIGIN,
  ASORA_NCSOFT_NEWS,
  ASORA_OFFICIAL_SEED,
  ASORA_OFFICIAL_RE,
} from "./index-lib-05.js";


function isAsoraSubstanceItem(it) {
  if (isAsoraJunkOfficialItem(it)) return false;
  const title = String(it?.title || "");
  const url = String(it?.url || "");
  // Dedicated game hub / news on plaync
  if (/astraeoratio\.plaync\.com/i.test(url)) {
    return ASORA_OFFICIAL_RE.test(title + " " + url) || /\/(index|news)/i.test(url);
  }
  // NC Soft article pages with game signal in title or slug
  if (/about\.ncsoft\.com\/tw\/news\/article\//i.test(url)) {
    return ASORA_OFFICIAL_RE.test(title + " " + url);
  }
  // Verified GNN with game keywords
  if (/gnn\.gamer\.com\.tw\/detail\.php/i.test(url)) {
    return ASORA_OFFICIAL_RE.test(title + " " + url);
  }
  return ASORA_OFFICIAL_RE.test(title + " " + url);
}

/** Pull NC Soft TW news list items from Vue __INITIAL_STATE__ (SPA shell). */
function parseNcsoftTwNewsState(html) {
  const out = [];
  const m = String(html || "").match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/
  );
  if (!m) return out;
  let state;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return out;
  }
  const list =
    state?.__COMPONENTS_STATE__?.["news-list"]?.list ||
    state?.["__COMPONENTS_STATE__"]?.["news-list"]?.list ||
    [];
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    const slug = String(row?.slug || "").trim();
    const title = truncate(String(row?.title || "").replace(/\n+/g, " "), 160);
    if (!slug || !title) continue;
    out.push({
      title,
      url: `https://about.ncsoft.com/tw/news/article/${slug}`,
      date: row?.publishDtt ? String(row.publishDtt).slice(0, 10) : undefined,
    });
  }
  return out;
}

async function fetchAsoraOfficialPages() {
  const pages = [
    `${ASORA_PLAYNC_ORIGIN}/zh-tw/index`,
    `${ASORA_PLAYNC_ORIGIN}/zh-tw/news`,
    ASORA_NCSOFT_NEWS,
  ];
  const errors = [];
  const all = [];
  const seen = new Set();

  for (const pageUrl of pages) {
    try {
      const res = await fetchText(pageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        timeoutMs: 12000,
      });
      if (!res.ok || !res.text) {
        errors.push(`asora_http_${res.status || "err"}`);
        // Jina fallback for SPA shells
        try {
          const jina = await fetchText(`https://r.jina.ai/${pageUrl}`, {
            headers: { Accept: "text/plain,text/markdown,*/*" },
            timeoutMs: 20000,
          });
          if (jina.ok && jina.text) {
            for (const it of parseHtmlAnchorLinks(jina.text, pageUrl)) {
              if (seen.has(it.url)) continue;
              seen.add(it.url);
              all.push(it);
            }
          } else {
            errors.push(`asora_jina_${jina.status || "err"}`);
          }
        } catch (je) {
          errors.push(truncate(je.message, 60));
        }
        continue;
      }
      for (const it of parseHtmlAnchorLinks(res.text, pageUrl)) {
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        all.push(it);
      }
      if (/about\.ncsoft\.com/i.test(pageUrl)) {
        for (const it of parseNcsoftTwNewsState(res.text)) {
          if (seen.has(it.url)) continue;
          seen.add(it.url);
          all.push(it);
        }
      }
    } catch (e) {
      errors.push(truncate(e.message, 60));
    }
  }
  return {
    ok: all.length > 0,
    items: all,
    error: errors.length ? errors.join(";") : undefined,
  };
}

async function searchAsoraOfficial({ limit = 5, filterKeywords } = {}) {
  const lim = clampLimit(limit, 5, 8);
  const fetchErrors = [];
  let live = [];

  try {
    const fetched = await fetchAsoraOfficialPages();
    if (!fetched.ok && fetched.error) fetchErrors.push(fetched.error);
    for (const it of fetched.items || []) {
      if (!isAsoraSubstanceItem(it)) continue;
      // Extra keyword soft-match only when already substance (avoid NCSOFT nav)
      if (
        !ASORA_OFFICIAL_RE.test(`${it.title || ""} ${it.url || ""}`) &&
        !matchesAsoraOfficial(it.title, it.url, filterKeywords)
      ) {
        continue;
      }
      live.push({
        title: it.title,
        url: it.url,
        source: "official",
        ...(it.date ? { date: it.date } : {}),
      });
      if (live.length >= lim) break;
    }
  } catch (e) {
    fetchErrors.push(truncate(e.message, 80));
  }

  const substance = live.filter((it) => isAsoraSubstanceItem(it));
  if (substance.length) {
    return {
      ok: true,
      items: substance.slice(0, lim),
      via: "asora_official",
    };
  }
  if (live.length) {
    fetchErrors.push("live_only_nav_or_unrelated");
  }

  const seeds = ASORA_OFFICIAL_SEED.slice(0, Math.min(5, lim)).map((it) => ({
    title: it.title,
    url: it.url,
    source: "official",
  }));
  return {
    ok: seeds.length > 0,
    items: seeds,
    via: "asora_seed",
    ...(fetchErrors.length
      ? { scrape_error: truncate(fetchErrors.join(";"), 120) }
      : { scrape_error: "asora_pages_empty" }),
  };
}

async function searchBd2Official({
  limit = 5,
  query,
  locale = "en",
  forDigest = false,
} = {}) {
  const lim = clampLimit(limit, 5, 8);
  const loc = mapBd2Locale(locale);
  const q = String(query || "").trim();
  const headers = {
    Accept: "application/json",
    Origin: BD2_SITE_ORIGIN,
    Referer: BD2_SITE_ORIGIN + "/",
  };
  let apiUrl;
  if (q) {
    const params = new URLSearchParams({
      q,
      locale: loc,
      page: "0",
      limit: String(lim),
    });
    apiUrl = `${BD2_API_ORIGIN}/notices/search?${params}`;
  } else {
    const params = new URLSearchParams({
      locale: loc,
      page: "0",
      limit: String(Math.max(lim, forDigest ? lim + 3 : lim)),
    });
    apiUrl = `${BD2_API_ORIGIN}/notices?${params}`;
  }
  const res = await fetchJson(apiUrl, { headers, timeoutMs: 15000 });
  if (!res.ok || !res.body) {
    return {
      ok: false,
      error: `bd2_api_http_${res.status || "err"}`,
      items: [],
    };
  }
  const rawItems = Array.isArray(res.body.items) ? res.body.items : [];
  let items = rawItems.map((it) => {
    const id = it?.id;
    const subject = String(it?.subject || "").trim();
    const publishedAt = it?.publishedAt
      ? String(it.publishedAt)
      : null;
    const preview = it?.contentPreview
      ? truncate(stripHtml(String(it.contentPreview)), 400)
      : "";
    return {
      title: subject,
      url: id ? bd2ViewUrl(id, loc) : "",
      date: publishedAt,
      source: "official",
      id: id ? String(id) : undefined,
      category: it?.category ? String(it.category) : null,
      ...(preview ? { summary: preview } : {}),
    };
  }).filter((it) => it.title && it.url);

  if (forDigest) {
    items = preferBd2OfficialForDigest(items);
  }
  items = items.slice(0, lim);
  return {
    ok: items.length > 0,
    items,
    via: "bd2_notices",
    locale: loc,
  };
}

async function fetchOfficialViaJina(pageUrl, limit) {
  const jinaUrl = `https://r.jina.ai/${pageUrl}`;
  const res = await fetchText(jinaUrl, {
    headers: { Accept: "text/plain,text/markdown,*/*" },
    timeoutMs: 20000,
  });
  if (!res.ok || !res.text) {
    return {
      ok: false,
      error: `jina_http_${res.status}`,
      items: [],
    };
  }
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  // Nikke: require newsdetail.html?content_id=
  if (/nikke-en\.com/i.test(pageUrl)) {
    const items = parseJinaOfficialLinks(res.text, {
      hostIncludes: ["nikke-en.com"],
      pathIncludes: ["newsdetail.html"],
      requireDetail: true,
    }).slice(0, limit);
    return { ok: items.length > 0, items };
  }
  // Brown Dust 2 SPA often yields only nav — require detail-ish URLs or empty
  if (/browndust2\.com/i.test(pageUrl)) {
    const items = parseJinaOfficialLinks(res.text, {
      hostIncludes: ["browndust2.com"],
      requireDetail: true,
    }).slice(0, limit);
    return { ok: items.length > 0, items };
  }
  // Generic official_url
  const items = parseJinaOfficialLinks(res.text, {
    hostIncludes: host ? [host] : undefined,
    pathIncludes: ["newsdetail", "content_id", "/news/"],
  }).slice(0, limit);
  if (!items.length) {
    const loose = parseJinaOfficialLinks(res.text, {
      hostIncludes: host ? [host] : undefined,
      requireDetail: true,
    }).filter((it) =>
      /news|notice|patch|update|maintenance|event|important/i.test(
        it.title + " " + it.url
      )
    );
    return { ok: loose.length > 0, items: loose.slice(0, limit) };
  }
  return { ok: items.length > 0, items };
}

export {
  isAsoraSubstanceItem,
  parseNcsoftTwNewsState,
  fetchAsoraOfficialPages,
  searchAsoraOfficial,
  searchBd2Official,
  fetchOfficialViaJina,
};
