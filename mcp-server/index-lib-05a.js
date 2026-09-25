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
  includesCI,
  truncate,
  stripHtml,
  clampLimit,
  fetchText,
  parseJinaOfficialLinks,
  matchesMiresiOfficial,
  parseSmilegateNewsroomHtml,
  SMILEGATE_NEWSROOM_ORIGIN,
  SMILEGATE_MIRESI_SEED,
} from "./index-lib-04.js";


async function fetchSmilegateBoard(boardUrl) {
  try {
    const res = await fetchText(boardUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
        Referer: SMILEGATE_NEWSROOM_ORIGIN + "/",
      },
      // Smilegate boards are SSR but can be slow from some egress; use longer timeout
      timeoutMs: 22000,
    });
    if (!res.ok || !res.text) {
      return { ok: false, status: res.status || 0, items: [] };
    }
    return { ok: true, status: res.status, items: parseSmilegateNewsroomHtml(res.text) };
  } catch (e) {
    return { ok: false, status: 0, error: truncate(e.message, 80), items: [] };
  }
}

async function searchSmilegateNewsroom({
  limit = 5,
  filterKeywords,
} = {}) {
  const lim = clampLimit(limit, 5, 8);
  const boards = [
    `${SMILEGATE_NEWSROOM_ORIGIN}/bbs/board.php?bo_table=eng`,
    `${SMILEGATE_NEWSROOM_ORIGIN}/bbs/board.php?bo_table=news`,
    // Newer HTML list routes (SSR, same content as boards when present)
    `${SMILEGATE_NEWSROOM_ORIGIN}/eng`,
    `${SMILEGATE_NEWSROOM_ORIGIN}/news`,
  ];
  const seen = new Set();
  const live = [];
  const fetchErrors = [];

  for (const boardUrl of boards) {
    const fetched = await fetchSmilegateBoard(boardUrl);
    if (!fetched.ok) {
      fetchErrors.push(
        fetched.error || `http_${fetched.status || "err"}`
      );
      continue;
    }
    for (const it of fetched.items || []) {
      if (!matchesMiresiOfficial(it.title, it.url, filterKeywords)) continue;
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      live.push({
        title: it.title,
        url: it.url,
        source: "official",
      });
      if (live.length >= lim) break;
    }
    if (live.length >= lim) break;
  }

  if (live.length) {
    return {
      ok: true,
      items: live.slice(0, lim),
      via: "smilegate_newsroom",
    };
  }

  // Resilient fallback: curated known official posts (no invented dates/prices)
  const seeds = SMILEGATE_MIRESI_SEED.slice(0, Math.min(5, lim)).map((it) => ({
    title: it.title,
    url: it.url,
    source: "official",
  }));
  return {
    ok: seeds.length > 0,
    items: seeds,
    via: "smilegate_seed",
    ...(fetchErrors.length
      ? { scrape_error: truncate(fetchErrors.join(";"), 120) }
      : { scrape_error: "boards_empty" }),
  };
}

const STAR_OFFICIAL_PAGES = [
  "https://azurpromilia.com/news",
  "https://azurpromilia.manjuu.com/en/",
];

/** Curated official-ish Azur Promilia links when live scrape/Jina fails (CF common). */
const STAR_OFFICIAL_SEED = [
  {
    title: "蓝色星原：旅谣 — TapTap 官方：旅迹测试定档 9月17日",
    url: "https://www.taptap.cn/moment/842394655134843472",
  },
  {
    title: "GNN: 蓝色星原：旅谣 双平台事前预约 (media reprint)",
    url: "https://gnn.gamer.com.tw/detail.php?sn=310922",
  },
  {
    title: "Azur Promilia — Official site (pre-reg hub)",
    url: "https://azurpromilia.com/",
  },
  {
    title: "Azur Promilia — Manjuu EN hub",
    url: "https://azurpromilia.manjuu.com/en/",
  },
  {
    title: "Azur Promilia — JP official site",
    url: "https://azurpromilia.jp/",
  },
];

const STAR_OFFICIAL_RE =
  /azur\s*promilia|蓝色星原|旅谣|promilia|奇波|manjuu|yostar/i;

function usesStarOfficial(entryId, officialApi) {
  if (String(officialApi || "").trim() === "star_official") return true;
  return String(entryId || "").toLowerCase() === "star";
}

function matchesStarOfficial(title, url, extraKeywords) {
  const blob = `${title || ""} ${url || ""}`;
  if (STAR_OFFICIAL_RE.test(blob)) return true;
  const extras = Array.isArray(extraKeywords) ? extraKeywords : [];
  for (const k of extras) {
    const s = String(k || "").trim();
    if (s.length >= 2 && includesCI(blob, s)) return true;
  }
  return false;
}

function isStarNewsishUrl(url) {
  const u = String(url || "");
  // Drop legal / account chrome
  if (/\/terms\/|privacy|cookie|login|signup|register|user-agreement/i.test(u)) {
    return false;
  }
  if (/yostar\.co\.jp\/news\//i.test(u)) return true;
  if (/gnn\.gamer\.com\.tw\/detail\.php/i.test(u)) return true;
  if (/azurpromilia\.(com|jp|manjuu\.com)/i.test(u)) {
    return /\/news(?:\/|$|\?)|notice|announcement|press/i.test(u);
  }
  return /\/news(?:\/|$|\?)|notice|announcement|press/i.test(u);
}

function isStarJunkOfficialItem(it) {
  const title = String(it?.title || "");
  const url = String(it?.url || "");
  if (/\/terms\/|privacy|cookie|login|signup/i.test(url)) return true;
  if (/^(to learn more|terms of service|privacy policy|cookie|login|sign up)$/i.test(title.trim())) {
    return true;
  }
  return false;
}

function absUrlFromBase(href, baseUrl) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
  try {
    const u = new URL(raw, baseUrl || "https://azurpromilia.com/");
    return u.origin + u.pathname + u.search;
  } catch {
    return null;
  }
}

function parseHtmlAnchorLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const abs = absUrlFromBase(m[1], baseUrl);
    if (!abs) continue;
    if (seen.has(abs)) continue;
    const title = truncate(stripHtml(m[2]), 160);
    if (!title || title.length < 3) continue;
    if (
      /^(HOME|NEWS|ABOUT|MEDIA|LOGIN|SIGN\s*UP|PREV|NEXT|EN|JP|KR|CN|中文|日本語|한국어)$/i.test(
        title
      )
    ) {
      continue;
    }
    seen.add(abs);
    out.push({ title, url: abs, source: "official" });
  }
  return out;
}

async function fetchStarPageLinks(pageUrl) {
  const errors = [];
  // 1) Direct HTML
  try {
    const res = await fetchText(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      timeoutMs: 15000,
    });
    if (res.ok && res.text) {
      const items = parseHtmlAnchorLinks(res.text, pageUrl);
      if (items.length) return { ok: true, items, via: "star_html" };
      errors.push(`html_empty_${res.status || 0}`);
    } else {
      errors.push(`html_http_${res.status || "err"}`);
    }
  } catch (e) {
    errors.push(truncate(e.message, 60));
  }
  // 2) Jina (often Cloudflare-blocked on these hosts)
  try {
    const jinaUrl = `https://r.jina.ai/${pageUrl}`;
    const res = await fetchText(jinaUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
      timeoutMs: 20000,
    });
    if (res.ok && res.text) {
      let host = "";
      try {
        host = new URL(pageUrl).hostname;
      } catch {
        host = "";
      }
      const items = parseJinaOfficialLinks(res.text, {
        hostIncludes: host ? [host, "azurpromilia", "manjuu.com", "yostar"] : undefined,
        pathIncludes: ["news", "notice", "announcement", "press", "detail"],
      });
      const loose = items.length
        ? items
        : parseJinaOfficialLinks(res.text, {
            hostIncludes: host ? [host] : undefined,
          }).filter((it) =>
            /news|notice|announcement|press|promilia|星原|旅谣/i.test(
              it.title + " " + it.url
            )
          );
      if (loose.length) return { ok: true, items: loose, via: "star_jina" };
      errors.push("jina_empty");
    } else {
      errors.push(`jina_http_${res.status || "err"}`);
    }
  } catch (e) {
    errors.push(truncate(e.message, 60));
  }
  return { ok: false, items: [], error: errors.join(";") || "star_fetch_fail" };
}

async function searchStarOfficial({ limit = 5, filterKeywords } = {}) {
  const lim = clampLimit(limit, 5, 8);
  const seen = new Set();
  const live = [];
  const fetchErrors = [];

  for (const pageUrl of STAR_OFFICIAL_PAGES) {
    const fetched = await fetchStarPageLinks(pageUrl);
    if (!fetched.ok) {
      if (fetched.error) fetchErrors.push(fetched.error);
      continue;
    }
    for (const it of fetched.items || []) {
      if (isStarJunkOfficialItem(it)) continue;
      // Require news-ish URL; SPA hubs rarely expose article links
      if (!isStarNewsishUrl(it.url)) continue;
      // Soft keyword filter when title/url mention the game or known hosts
      if (
        !matchesStarOfficial(it.title, it.url, filterKeywords) &&
        !/azurpromilia|yostar|manjuu/i.test(it.url)
      ) {
        continue;
      }
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      live.push({
        title: it.title,
        url: it.url,
        source: "official",
        ...(it.date ? { date: it.date } : {}),
      });
      if (live.length >= lim) break;
    }
    if (live.length >= lim) break;
  }

  // Live SPA pages often only yield nav/legal — prefer curated seed then
  const substance = live.filter((it) => !isStarJunkOfficialItem(it));
  if (substance.length) {
    return {
      ok: true,
      items: substance.slice(0, lim),
      via: "star_official",
    };
  }
  if (live.length) {
    fetchErrors.push("live_only_nav_or_legal");
  }

  const seeds = STAR_OFFICIAL_SEED.slice(0, Math.min(5, lim)).map((it) => ({
    title: it.title,
    url: it.url,
    source: "official",
  }));
  return {
    ok: seeds.length > 0,
    items: seeds,
    via: "star_seed",
    ...(fetchErrors.length
      ? { scrape_error: truncate(fetchErrors.join(";"), 120) }
      : { scrape_error: "pages_empty" }),
  };
}

const VALOFE_ORIGIN = "https://www.valofe.com";

/** Curated VALOFE / Last Origin 2 publisher announcements (no dedicated game site yet). */
const LO2_OFFICIAL_SEED = [
  {
    title: "VALOFE — Last Origin 2 开发本格化 / 组队 (GameChosun)",
    url: "https://www.gamechosun.co.kr/webzine/article/view.php?no=223244",
  },
  {
    title: "VALOFE — Last Origin 2 开发本格化 (ThisIsGame)",
    url: "https://www.thisisgame.com/articles/427567",
  },
  {
    title: "VALOFE — Last Origin 2 开发本格化 (Edaily)",
    url: "https://www2.edaily.co.kr/News/Read?mediaCodeNo=257&newsId=02843766645512552",
  },
  {
    title: "VALOFE launches Last Origin 2 development (Inven Global EN)",
    url: "https://www.invenglobal.com/articles/21680/valofe-launches-first-new-development-project-last-origin-2",
  },
  {
    title: "VALOFE — Last Origin 2 development start (KR Inven)",
    url: "https://www.inven.co.kr/webzine/news/?news=316246",
  },
];

const LO2_OFFICIAL_RE =
  /last\s*origin\s*2|last\s*origin\s*ii|라스트\s*오리진\s*2|라스트오리진2|valofe/i;


export {
  fetchSmilegateBoard,
  searchSmilegateNewsroom,
  usesStarOfficial,
  matchesStarOfficial,
  isStarNewsishUrl,
  isStarJunkOfficialItem,
  absUrlFromBase,
  parseHtmlAnchorLinks,
  fetchStarPageLinks,
  searchStarOfficial,
  STAR_OFFICIAL_PAGES,
  STAR_OFFICIAL_SEED,
  STAR_OFFICIAL_RE,
  VALOFE_ORIGIN,
  LO2_OFFICIAL_SEED,
  LO2_OFFICIAL_RE,
};
