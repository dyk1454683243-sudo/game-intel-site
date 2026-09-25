export * from "./index-lib-02.js";
export {
  radar,
  rssField,
  parseRssItems,
  tokenizeBahamutQuery,
  bahamutQueryMatches,
  resolveBahamutBsn,
  bahamutPreferredQuery,
  normalizeBahamutUrl,
  isWeakBahamutTitle,
  cleanGnnPageTitle,
  parseJinaGnnDate,
  titleFromJinaSnippet,
  parseJinaBahamutSearch,
} from "./index-lib-03a.js";
import {
  radar,
  rssField,
  parseRssItems,
  tokenizeBahamutQuery,
  bahamutQueryMatches,
  resolveBahamutBsn,
  bahamutPreferredQuery,
  normalizeBahamutUrl,
  isWeakBahamutTitle,
  cleanGnnPageTitle,
  parseJinaGnnDate,
  titleFromJinaSnippet,
  parseJinaBahamutSearch,
} from "./index-lib-03a.js";
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
  isBareTapTapAppShell,
  BAHAMUT_GNN_RSS,
  BAHAMUT_SEARCH_JINA,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  RADAR_KEYWORDS,
  isNoise,
  radarScore,
  passesGamekeeRadarTitle,
  truncate,
  stripHtml,
  clampLimit,
  dedupeByUrl,
  dedupeByUrlOrTitle,
  fetchText,
  searchGamekee,
  searchTaptap,
  searchInven,
  radarHitTitle,
} from "./index-lib-02.js";
function isBahamutIntelTitle(title) {
  const t = String(title || "");
  // Drop forum-meta stickies / board rules
  if (/發文前請先閱讀|輕鬆不放縱|閱讀板規|板務公告|板規必讀/.test(t)) return false;
  if (/【\s*公告\s*】/.test(t) && /(置頂|板規|請先閱讀|輕鬆不放縱|發文前)/.test(t)) {
    return false;
  }
  // Tagged intel only — avoid bare 活動 matching 線下活動 in 【閒聊】/【問題】
  if (/【\s*(情報|公告|活動|更新)\s*】/.test(t)) return true;
  if (/情報/.test(t)) return true;
  return false;
}

async function scrapeBahamutBoard(bsn, limit = 8) {
  const lim = clampLimit(limit, 8, 20);
  const url = `https://forum.gamer.com.tw/B.php?bsn=${bsn}`;
  const res = await fetchText(url, { timeoutMs: 15000 });
  if (!res.ok) return { ok: false, status: res.status, items: [] };
  const html = res.text || "";
  const items = [];
  const seen = new Set();
  const re =
    /href="(C\.php\?bsn=\d+&snA=\d+)[^"]*"[^>]*class="b-list__main__title[^"]*">([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const title = stripHtml(m[2]);
    if (!title || !isBahamutIntelTitle(title)) continue;
    const full = normalizeBahamutUrl(`https://forum.gamer.com.tw/${href}`);
    if (!full || seen.has(full)) continue;
    seen.add(full);
    items.push({
      title: truncate(title, 120),
      url: full,
      date: null,
      source: "bahamut",
    });
    if (items.length >= lim) break;
  }
  return { ok: items.length > 0, items };
}

async function enrichGnnTitles(items, maxFetches = 3) {
  let left = maxFetches;
  for (const it of items) {
    if (left <= 0) break;
    if (!/detail\.php\?sn=/i.test(it.url || "")) continue;
    if (!isWeakBahamutTitle(it.title, it.url)) continue;
    left -= 1;
    try {
      const res = await fetchText(it.url, { timeoutMs: 12000 });
      if (!res.ok) continue;
      const tm = (res.text || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!tm) continue;
      const cleaned = cleanGnnPageTitle(tm[1]);
      if (cleaned && !isWeakBahamutTitle(cleaned, it.url)) it.title = cleaned;
    } catch {
      /* ignore */
    }
  }
  return items;
}

async function searchBahamutRss(query, limit) {
  const lim = clampLimit(limit, 5, 8);
  const q = String(query || "").trim();
  const res = await fetchText(BAHAMUT_GNN_RSS, {
    headers: { Accept: "application/rss+xml,application/xml,text/xml,*/*" },
    timeoutMs: 15000,
  });
  if (!res.ok) return { ok: false, error: `http_${res.status}`, items: [] };
  const parsed = parseRssItems(res.text);
  const items = [];
  for (const it of parsed) {
    if (items.length >= lim) break;
    const hay = it.title + "\n" + (it.description || "");
    if (!bahamutQueryMatches(hay, q)) continue;
    items.push({
      title: it.title,
      url: normalizeBahamutUrl(it.url) || it.url,
      date: it.date || null,
      source: "bahamut",
    });
  }
  return { ok: items.length > 0, items };
}

async function searchBahamutJina(query, limit) {
  const lim = clampLimit(limit, 5, 12);
  const q = String(query || "").trim();
  if (!q) return { ok: false, items: [], gnn: [], forum: [] };
  const target =
    BAHAMUT_SEARCH_JINA +
    `?q=${encodeURIComponent(q)}&type=2`;
  const res = await fetchText(target, { timeoutMs: 25000 });
  if (!res.ok) {
    return {
      ok: false,
      error: `jina_http_${res.status}`,
      items: [],
      gnn: [],
      forum: [],
    };
  }
  const { gnn, forum } = parseJinaBahamutSearch(res.text);
  return {
    ok: gnn.length + forum.length > 0,
    gnn: gnn.slice(0, lim),
    forum: forum.slice(0, lim),
    items: [...gnn, ...forum].slice(0, lim),
  };
}

async function searchBahamut({ query, limit = 5, game = null, bsn = null }) {
  const lim = clampLimit(limit, 5, 8);
  const resolvedBsn = resolveBahamutBsn(game, bsn);
  const q = bahamutPreferredQuery(game, query);
  if (!q && resolvedBsn == null) {
    return { ok: false, error: "need_query", items: [] };
  }
  return withCache(
    "searchBahamut",
    { query: q || null, limit: lim, game: game || null, bsn: resolvedBsn },
    async () => {
  const tierGnn = [];
  const tierBoard = [];
  const tierForum = [];
  const tierRss = [];
  const errors = [];

  // 1) Jina GNN-focused search (type=2)
  if (q) {
    try {
      const jina = await searchBahamutJina(q, Math.max(lim, 8));
      if (jina.error) errors.push(jina.error);
      for (const it of jina.gnn || []) tierGnn.push(it);
      for (const it of jina.forum || []) {
        // When BSN is pinned, drop cross-board forum noise (e.g. hw must be 81419)
        if (resolvedBsn != null) {
          const m = String(it.url || "").match(/[?&]bsn=(\d+)/i);
          if (!m || Number(m[1]) !== Number(resolvedBsn)) continue;
        }
        if (!isBahamutIntelTitle(it.title)) continue;
        tierForum.push(it);
      }
    } catch (e) {
      errors.push(truncate(e.message, 60));
    }
  }

  // 2) Board scrape when BSN known
  if (resolvedBsn != null) {
    try {
      const board = await scrapeBahamutBoard(resolvedBsn, Math.max(lim, 6));
      for (const it of board.items || []) tierBoard.push(it);
    } catch (e) {
      errors.push(truncate(e.message, 60));
    }
  }

  // 3) RSS token match fallback
  if (q) {
    try {
      const rss = await searchBahamutRss(q, lim);
      if (rss.error) errors.push(rss.error);
      for (const it of rss.items || []) tierRss.push(it);
    } catch (e) {
      errors.push(truncate(e.message, 60));
    }
  }

  // Priority merge: with BSN pin prefer board scrape; else GNN > board > forum > RSS
  const merged = dedupeByUrl(
    resolvedBsn != null
      ? [...tierBoard, ...tierGnn, ...tierForum, ...tierRss]
      : [...tierGnn, ...tierBoard, ...tierForum, ...tierRss]
  ).slice(0, lim);

  await enrichGnnTitles(merged, 3);

  return {
    ok: merged.length > 0,
    query: q || null,
    game: game || null,
    bsn: resolvedBsn,
    count: merged.length,
    items: merged,
    ...(merged.length
      ? {}
      : { error: errors[0] || "no_match" }),
  };
    }
  );
}

/* ---------------- Prydwen + nikke.gg ---------------- */

const PRYDWEN_NAV_JUNK = new Set([
  "/nikke",
  "/nikke/",
  "/nikke/tools",
  "/nikke/builds",
  "/nikke/teams-database",
]);

function isNikkeContext(query, entry) {
  const parts = [
    query,
    entry?.id,
    entry?.name,
    entry?.name_zh,
    ...(Array.isArray(entry?.keywords) ? entry.keywords : []),
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
  const blob = parts.join(" ");
  return /nikke|胜利女神|勝利女神|니케|goddess of victory/.test(blob);
}

function prydwenTitleFromPath(pathname) {
  const segs = String(pathname || "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const last = segs[segs.length - 1] || "nikke";
  return truncate(
    last
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    120
  );
}


export {
  isBahamutIntelTitle,
  scrapeBahamutBoard,
  enrichGnnTitles,
  searchBahamutRss,
  searchBahamutJina,
  searchBahamut,
  isNikkeContext,
  prydwenTitleFromPath,
  PRYDWEN_NAV_JUNK,
};
