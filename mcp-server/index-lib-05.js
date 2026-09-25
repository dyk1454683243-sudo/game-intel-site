export * from "./index-lib-04.js";
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
} from "./index-lib-05a.js";
import {
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
} from "./index-lib-05a.js";
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
function usesLo2Official(entryId, officialApi) {
  if (String(officialApi || "").trim() === "lo2_official") return true;
  return String(entryId || "").toLowerCase() === "lo2";
}

function matchesLo2Official(title, url, extraKeywords) {
  const blob = `${title || ""} ${url || ""}`;
  if (LO2_OFFICIAL_RE.test(blob)) return true;
  const extras = Array.isArray(extraKeywords) ? extraKeywords : [];
  for (const k of extras) {
    const s = String(k || "").trim();
    if (s.length >= 2 && includesCI(blob, s)) return true;
  }
  return false;
}

async function fetchValofeNewsLinks() {
  const pages = [
    `${VALOFE_ORIGIN}/`,
    `${VALOFE_ORIGIN}/news`,
    `${VALOFE_ORIGIN}/en/news`,
    `${VALOFE_ORIGIN}/kr/news`,
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
        errors.push(`valofe_http_${res.status || "err"}`);
        continue;
      }
      for (const it of parseHtmlAnchorLinks(res.text, pageUrl)) {
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        all.push(it);
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

async function searchLo2Official({ limit = 5, filterKeywords } = {}) {
  const lim = clampLimit(limit, 5, 8);
  const fetchErrors = [];
  let live = [];

  try {
    const fetched = await fetchValofeNewsLinks();
    if (!fetched.ok && fetched.error) fetchErrors.push(fetched.error);
    for (const it of fetched.items || []) {
      if (!matchesLo2Official(it.title, it.url, filterKeywords)) continue;
      live.push({
        title: it.title,
        url: it.url,
        source: "official",
      });
      if (live.length >= lim) break;
    }
  } catch (e) {
    fetchErrors.push(truncate(e.message, 80));
  }

  if (live.length) {
    return {
      ok: true,
      items: live.slice(0, lim),
      via: "lo2_official",
    };
  }

  const seeds = LO2_OFFICIAL_SEED.slice(0, Math.min(5, lim)).map((it) => ({
    title: it.title,
    url: it.url,
    source: "official",
  }));
  return {
    ok: seeds.length > 0,
    items: seeds,
    via: "lo2_seed",
    ...(fetchErrors.length
      ? { scrape_error: truncate(fetchErrors.join(";"), 120) }
      : { scrape_error: "valofe_unreachable_or_empty" }),
  };
}

const ASORA_PLAYNC_ORIGIN = "https://astraeoratio.plaync.com";
const ASORA_NCSOFT_NEWS = "https://about.ncsoft.com/tw/news";

/** Curated Astrae Oratio / 阿索拉 official + verified press when SPA scrape is empty. */
const ASORA_OFFICIAL_SEED = [
  {
    title: "Astrae Oratio — Official TW hub (阿索拉：星之祈愿)",
    url: "https://astraeoratio.plaync.com/zh-tw/index",
  },
  {
    title: "NC: 《阿索拉：星之祈願》公開前導預告首度曝光實際遊戲畫面",
    url: "https://about.ncsoft.com/tw/news/article/astraeoratio_update_260602",
  },
  {
    title: "GNN: 《阿索拉：星之祈願》預告 8 月 19 日啟動 CBT 玩家募集",
    url: "https://gnn.gamer.com.tw/detail.php?sn=309159",
  },
];

const ASORA_OFFICIAL_RE =
  /astrae\s*oratio|astraeoratio|阿索拉|星之祈[愿願]|dynamis\s*one|project\s*at/i;

function usesAsoraOfficial(entryId, officialApi) {
  if (String(officialApi || "").trim() === "asora_official") return true;
  return String(entryId || "").toLowerCase() === "asora";
}

function matchesAsoraOfficial(title, url, extraKeywords) {
  const blob = `${title || ""} ${url || ""}`;
  if (ASORA_OFFICIAL_RE.test(blob)) return true;
  const extras = Array.isArray(extraKeywords) ? extraKeywords : [];
  for (const k of extras) {
    const s = String(k || "").trim();
    if (s.length >= 2 && includesCI(blob, s)) return true;
  }
  return false;
}

function isAsoraJunkOfficialItem(it) {
  const title = String(it?.title || "").trim();
  const url = String(it?.url || "");
  if (/\/terms\/|privacy|cookie|login|signup|register|blog-operating-policy/i.test(url)) {
    return true;
  }
  if (
    /^(HOME|NEWS|ABOUT|LOGIN|SIGN\s*UP|VIEW\s*MORE|FAMILY\s*SITE|GLOBAL|PLAY|ALL|PLAYNC|Operation Policy|CONTACT)$/i.test(
      title
    )
  ) {
    return true;
  }
  // Bare section hubs without article path
  if (/about\.ncsoft\.com\/tw\/(play|news)\/?$/i.test(url) && title.length < 12) {
    return true;
  }
  if (/about\.ncsoft\.com\/tw\/play\//i.test(url) && !ASORA_OFFICIAL_RE.test(title + " " + url)) {
    return true;
  }
  return false;
}


export {
  usesLo2Official,
  matchesLo2Official,
  fetchValofeNewsLinks,
  searchLo2Official,
  usesAsoraOfficial,
  matchesAsoraOfficial,
  isAsoraJunkOfficialItem,
  ASORA_PLAYNC_ORIGIN,
  ASORA_NCSOFT_NEWS,
  ASORA_OFFICIAL_SEED,
  ASORA_OFFICIAL_RE,
};
