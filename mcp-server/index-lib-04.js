export * from "./index-lib-03.js";
export {
  prydwenLinkScore,
  extractPrydwenLinks,
  scrapePrydwenNikke,
  searchNikkeGgFeed,
  searchPrydwen,
  parseNikkeOfficialTitle,
  parseOfficialDateFromTitle,
  parseJinaOfficialLinks,
} from "./index-lib-04a.js";
import {
  prydwenLinkScore,
  extractPrydwenLinks,
  scrapePrydwenNikke,
  searchNikkeGgFeed,
  searchPrydwen,
  parseNikkeOfficialTitle,
  parseOfficialDateFromTitle,
  parseJinaOfficialLinks,
} from "./index-lib-04a.js";
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
function mapBd2Locale(locale) {
  const raw = String(locale || "en").trim().toLowerCase();
  return BD2_LOCALE_MAP[raw] || BD2_LOCALE_MAP.en;
}

function bd2ViewUrl(id, locale) {
  const loc = mapBd2Locale(locale);
  return `${BD2_SITE_ORIGIN}/${loc}/news/view?id=${encodeURIComponent(id)}`;
}

/** Parse BD2 notice id from bare id or news/view URL (?id= or path). */
function parseBd2NoticeId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw) && /^[A-Za-z0-9_-]{12,}$/.test(raw)) {
    return raw;
  }
  try {
    const u = new URL(raw);
    const q = u.searchParams.get("id");
    if (q) return String(q).trim() || null;
    // path like /.../notices/ID or /news/view/ID
    const parts = (u.pathname || "").split("/").filter(Boolean);
    const viewIdx = parts.findIndex((p) => /^view$/i.test(p));
    if (viewIdx >= 0 && parts[viewIdx + 1] && !/^(en-us|ko-kr|ja-jp|zh-tw|zh-cn)$/i.test(parts[viewIdx + 1])) {
      return parts[viewIdx + 1];
    }
    const noticeIdx = parts.findIndex((p) => /^notices?$/i.test(p));
    if (noticeIdx >= 0 && parts[noticeIdx + 1]) return parts[noticeIdx + 1];
  } catch {
    /* fall through */
  }
  const m = raw.match(/[?&]id=([^&#]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim() || null;
    } catch {
      return m[1].trim() || null;
    }
  }
  return null;
}

function isBd2NewsViewUrl(url) {
  const u = String(url || "");
  if (!/browndust2\.com/i.test(u)) return false;
  return /\/news\/view/i.test(u) || /[?&]id=/i.test(u);
}

/**
 * Official BD2 notice detail API — full HTML content (not SPA/Jina).
 * GET /api/notices/{id}?locale=en-us → { subject, content, publishedAt, ... }
 */
async function fetchBd2NoticeDetail(id, locale = "en-us") {
  const noticeId = parseBd2NoticeId(id);
  if (!noticeId) {
    return { ok: false, error: "missing_id", id: null };
  }
  const loc = mapBd2Locale(locale);
  return withCache("bd2NoticeDetail", { id: noticeId, locale: loc }, async () => {
    const headers = {
      Accept: "application/json",
      Origin: BD2_SITE_ORIGIN,
      Referer: BD2_SITE_ORIGIN + "/",
    };
    const apiUrl = `${BD2_API_ORIGIN}/notices/${encodeURIComponent(noticeId)}?locale=${encodeURIComponent(loc)}`;
    try {
      const res = await fetchJson(apiUrl, { headers, timeoutMs: 15000 });
      if (!res.ok || !res.body) {
        return {
          ok: false,
          error: `bd2_detail_http_${res.status || "err"}`,
          id: noticeId,
        };
      }
      const body = res.body;
      const subject = body?.subject != null ? String(body.subject) : "";
      const content = body?.content != null ? String(body.content) : "";
      const publishedAt = body?.publishedAt != null ? String(body.publishedAt) : null;
      return {
        ok: true,
        id: noticeId,
        subject,
        content,
        publishedAt,
        category: body?.category != null ? String(body.category) : null,
        locale: loc,
      };
    } catch (err) {
      return {
        ok: false,
        error: truncate(String(err?.message || err || "bd2_detail_err"), 80),
        id: noticeId,
      };
    }
  });
}

function usesBd2OfficialApi(entryId, officialUrl) {
  if (String(entryId || "").toLowerCase() === "bd2") return true;
  if (officialUrl && /browndust2\.com/i.test(String(officialUrl))) return true;
  return false;
}

function isBd2ComicSubject(title) {
  const t = String(title || "").trim();
  if (!t) return false;
  if (/^📕/.test(t)) return true;
  if (/4-Panel Comics/i.test(t)) return true;
  return false;
}

/** Soft-rank BD2 official items for digest: prefer ops categories, demote comics/goods. */
function preferBd2OfficialForDigest(items) {
  const list = Array.isArray(items) ? [...items] : [];
  if (!list.length) return list;
  const score = (it) => {
    let s = 0;
    const cat = String(it?.category || "").toLowerCase();
    if (BD2_DIGEST_CAT_PREF.has(cat)) s += 10;
    if (cat === "goods" || cat === "shop") s -= 8;
    if (isBd2ComicSubject(it?.title)) s -= 20;
    const ms = itemDateMs(it);
    if (ms) s += Math.min(ms / 1e12, 5);
    return s;
  };
  list.sort((a, b) => score(b) - score(a));
  // If a non-comic preferred item exists, drop leading comic fluff
  const hasSubstance = list.some(
    (it) =>
      !isBd2ComicSubject(it?.title) &&
      BD2_DIGEST_CAT_PREF.has(String(it?.category || "").toLowerCase())
  );
  if (hasSubstance) {
    return list.filter((it) => !isBd2ComicSubject(it?.title));
  }
  return list;
}


const SMILEGATE_NEWSROOM_ORIGIN = "https://newsroom.smilegate.com";

/** Curated public Smilegate / MIRESI official links used when live boards fail. */
const SMILEGATE_MIRESI_SEED = [
  {
    title: "MIRESI — Smilegate TGS 2026 出展 (KR)",
    url: "https://newsroom.smilegate.com/news/1786606454",
  },
  {
    title: "MIRESI — Anime Expo 2026 booth open (EN)",
    url: "https://newsroom.smilegate.com/eng/1783313698",
  },
  {
    title: "MIRESI — 사전예약 페이지 오픈 (KR)",
    url: "https://newsroom.smilegate.com/news/1782281412",
  },
  {
    title: "MIRESI — Partner Creator 모집 (KR)",
    url: "https://newsroom.smilegate.com/news/1782453440",
  },
  {
    title: "MIRESI Chronicle / official site",
    url: "https://miresi.onstove.com/en/history",
  },
];

const MIRESI_OFFICIAL_RE =
  /miresi|미래시|invisible\s*future|control9/i;

function usesSmilegateNewsroom(entryId, officialApi) {
  if (String(officialApi || "").trim() === "smilegate_newsroom") return true;
  return String(entryId || "").toLowerCase() === "miraesi";
}

function absSmilegateUrl(href) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (
        !/newsroom\.smilegate\.com$/i.test(u.hostname) &&
        !/miresi\.onstove\.com$/i.test(u.hostname)
      ) {
        // allow only smilegate newsroom + official site from board scrape
        if (!/smilegate\.com$/i.test(u.hostname)) return null;
      }
      return u.origin + u.pathname + u.search;
    }
    const u = new URL(raw, SMILEGATE_NEWSROOM_ORIGIN + "/");
    return u.origin + u.pathname + u.search;
  } catch {
    return null;
  }
}

function isSmilegateArticleUrl(url) {
  const u = String(url || "");
  if (/[?&]wr_id=\d+/i.test(u)) return true;
  // Live newsroom article paths (EN /eng/{id}, KR /news/{id})
  if (/\/(?:eng|news)\/\d+(?:\/|$|\?)/i.test(u)) return true;
  if (/\/en\/(?:eng|game)\//i.test(u)) return true;
  if (/miresi\.onstove\.com/i.test(u)) return true;
  return false;
}

function matchesMiresiOfficial(title, url, extraKeywords) {
  const blob = `${title || ""} ${url || ""}`;
  if (MIRESI_OFFICIAL_RE.test(blob)) return true;
  const extras = Array.isArray(extraKeywords) ? extraKeywords : [];
  for (const k of extras) {
    const s = String(k || "").trim();
    if (s.length >= 2 && includesCI(blob, s)) return true;
  }
  return false;
}

function parseSmilegateNewsroomHtml(html) {
  const out = [];
  const seen = new Set();
  const re =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const abs = absSmilegateUrl(m[1]);
    if (!abs || !isSmilegateArticleUrl(abs)) continue;
    // Skip bare board / list pages without wr_id or /eng|news/{id}
    if (
      /board\.php/i.test(abs) &&
      !/[?&]wr_id=\d+/i.test(abs)
    ) {
      continue;
    }
    if (/\/(?:eng|news)\/?$/i.test(new URL(abs).pathname)) {
      continue;
    }
    if (seen.has(abs)) continue;
    const title = truncate(stripHtml(m[2]), 160);
    if (!title || title.length < 3) continue;
    // Skip nav chrome
    if (
      /^(HOME|NEWS|EN|KR|KO|PREV|NEXT|더보기|목록|이전|다음)$/i.test(title)
    ) {
      continue;
    }
    seen.add(abs);
    out.push({ title, url: abs, source: "official" });
  }
  return out;
}


export {
  mapBd2Locale,
  bd2ViewUrl,
  parseBd2NoticeId,
  isBd2NewsViewUrl,
  fetchBd2NoticeDetail,
  usesBd2OfficialApi,
  isBd2ComicSubject,
  preferBd2OfficialForDigest,
  usesSmilegateNewsroom,
  absSmilegateUrl,
  isSmilegateArticleUrl,
  matchesMiresiOfficial,
  parseSmilegateNewsroomHtml,
  SMILEGATE_NEWSROOM_ORIGIN,
  SMILEGATE_MIRESI_SEED,
  MIRESI_OFFICIAL_RE,
};
