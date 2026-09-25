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


async function radar({ q } = {}) {
  const extra = String(q || "").trim();
  const keywords = extra
    ? [extra, ...RADAR_KEYWORDS.filter((k) => k !== extra)].slice(0, 4)
    : ["公测", "预约", "CBT", "新作"];
  const collected = [];

  // TapTap: one community search on primary kw + app search
  const tapKw = keywords[0];
  try {
    const tap = await searchTaptap({ query: tapKw, limit: 6 });
    for (const it of tap.items || []) {
      const row = {
        ...it,
        why: `taptap:${tapKw}`,
      };
      // Prefer titles that actually carry a radar keyword; drop bare app shells
      const titleHasKw =
        !!radarHitTitle(row.title) || includesCI(row.title, tapKw);
      if (!titleHasKw) continue;
      if (isBareTapTapAppShell(row)) continue;
      if (isNoise(row)) continue;
      collected.push(row);
    }
  } catch {
    /* ignore */
  }

  // Inven: Korean/English launch-ish
  const invenQ = extra || "CBT";
  try {
    const inv = await searchInven({ query: invenQ, limit: 5 });
    for (const it of inv.items || []) {
      const row = {
        ...it,
        why: `inven:${invenQ}`,
      };
      const titleHasKw =
        !!radarHitTitle(row.title) || includesCI(row.title, invenQ);
      if (!titleHasKw) continue;
      if (isNoise(row)) continue;
      collected.push(row);
    }
  } catch {
    /* ignore */
  }

  // GameKee www keyword sweeps
  for (const kw of keywords.slice(0, 3)) {
    try {
      const gk = await searchGamekee({ alias: "www", query: kw, limit: 4 });
      for (const it of gk.items || []) {
        const hit = radarHitTitle(it.title) || kw;
        collected.push({
          title: it.title,
          url: it.url,
          source: "gamekee",
          updated: it.updated || null,
          why: `gamekee:${hit}`,
        });
      }
    } catch {
      /* ignore */
    }
  }

  const filtered = dedupeByUrlOrTitle(collected)
    .filter((it) => !isNoise(it))
    .filter((it) => passesGamekeeRadarTitle(it))
    .map((it) => ({
      title: truncate(it.title, 120),
      url: it.url,
      source: it.source,
      why: truncate(it.why || "radar", 40),
      _score: radarScore(it),
    }))
    .sort((a, b) => b._score - a._score || String(a.title).localeCompare(String(b.title)))
    .slice(0, 15)
    .map(({ _score, ...rest }) => rest);

  return {
    ok: filtered.length > 0,
    count: filtered.length,
    keywords,
    items: filtered,
  };
}


/* ---------------- Bahamut GNN (RSS) ---------------- */

function rssField(block, tag) {
  const cdata = new RegExp(
    "<" + tag + "[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</" + tag + ">",
    "i"
  );
  const plain = new RegExp(
    "<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">",
    "i"
  );
  let m = cdata.exec(block);
  if (m) return String(m[1] || "").trim();
  m = plain.exec(block);
  if (m) return String(m[1] || "").trim();
  return "";
}

function parseRssItems(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || "")))) {
    const block = m[1];
    const title = stripHtml(rssField(block, "title"));
    const link = stripHtml(rssField(block, "link"));
    const dateRaw = stripHtml(rssField(block, "pubDate"));
    const description = rssField(block, "description");
    if (!title || !link) continue;
    let date = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) date = d.toISOString();
    }
    out.push({
      title: truncate(title, 120),
      url: link,
      date,
      description: stripHtml(description).slice(0, 400),
    });
  }
  return out;
}

function tokenizeBahamutQuery(query) {
  return String(query || "")
    .split(/[\s/|、，,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function bahamutQueryMatches(haystack, query) {
  const hay = String(haystack || "").toLowerCase();
  const tokens = tokenizeBahamutQuery(query);
  if (!tokens.length) {
    const q = String(query || "").trim().toLowerCase();
    return q.length >= 2 && hay.includes(q);
  }
  return tokens.some((t) => hay.includes(t.toLowerCase()));
}

function resolveBahamutBsn(game, bsn) {
  if (bsn != null && Number.isFinite(Number(bsn))) return Number(bsn);
  const key = String(game || "")
    .toLowerCase()
    .trim();
  if (key && BAHAMUT_BSN[key] != null) return BAHAMUT_BSN[key];
  return null;
}

function bahamutPreferredQuery(game, query) {
  const key = String(game || "")
    .toLowerCase()
    .trim();
  if (key && BAHAMUT_QUERY_PREF[key]) return BAHAMUT_QUERY_PREF[key];
  return String(query || "").trim();
}

function normalizeBahamutUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (/gnn\.gamer\.com\.tw$/i.test(url.hostname) && /detail\.php$/i.test(url.pathname)) {
      const sn = url.searchParams.get("sn");
      if (sn) return `https://gnn.gamer.com.tw/detail.php?sn=${sn}`;
    }
    if (/forum\.gamer\.com\.tw$/i.test(url.hostname) && /C\.php$/i.test(url.pathname)) {
      const bsn = url.searchParams.get("bsn");
      const snA = url.searchParams.get("snA");
      if (bsn && snA) return `https://forum.gamer.com.tw/C.php?bsn=${bsn}&snA=${snA}`;
    }
  } catch {
    /* ignore */
  }
  return String(u || "").trim();
}

function isWeakBahamutTitle(title, url) {
  const t = String(title || "").trim();
  if (!t || t.length < 8) return true;
  if (/^(detail|B\.php|C\.php|gnn\.gamer|forum\.gamer|GNN\s*#)/i.test(t)) return true;
  if (/巴哈姆特電玩資訊站/.test(t) && t.length < 40) return true;
  if (/gnn\.gamer\.com\.tw|forum\.gamer\.com\.tw/i.test(t)) return true;
  if (/^【獲取方式】|^image\.\s*SSR|\bgamer\.com\.tw\b/i.test(t)) return true;
  // Jina snippets often lack a proper 《headline》 for GNN detail pages
  if (/detail\.php/i.test(url || "") && !/《[^》]{2,}》/.test(t)) return true;
  if (/detail\.php/i.test(url || "") && /^(GNN|新聞|detail)$/i.test(t)) return true;
  return false;
}

function cleanGnnPageTitle(raw) {
  let t = stripHtml(raw || "");
  t = t
    .replace(/\s*[-\u2013|\uff5c]\s*\u5df4\u54c8\u59c6\u7279\s*$/u, "")
    .replace(/\s*[-\u2013|\uff5c]\s*GNN.*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  // Drop trailing EN duplicate book-title if a ZH 《...》 already exists
  if ((t.match(/\u300a/g) || []).length >= 2) {
    t = t.replace(/\u300a[^\u300b]{0,60}\u300b\s*$/u, "").trim();
  }
  return truncate(t, 120);
}

function parseJinaGnnDate(snippet) {
  const m = String(snippet || "").match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/
  );
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function titleFromJinaSnippet(snippet) {
  let s = String(snippet || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*(?:\.\.\.|…|\*{0,2}\.{3}\*{0,2})?\s*/u, "");
  s = s.replace(/^\.\.\.\s*/, "").replace(/^…\s*/, "");
  // Prefer bracketed intel-style titles
  const tagged = s.match(/【[^】]{1,40}】[^【]{0,80}/);
  if (tagged) return truncate(tagged[0].trim(), 120);
  const book = s.match(/《[^》]+》[^《.]{0,60}/);
  if (book) return truncate(book[0].trim(), 120);
  if (s.length >= 12) return truncate(s, 120);
  return "";
}

/** Parse Jina markdown of Bahamut Google-CSE results for GNN + forum links. */
function parseJinaBahamutSearch(md) {
  const text = String(md || "");
  const gnn = [];
  const forum = [];
  const seen = new Set();

  const re =
    /https:\/\/(?:gnn\.gamer\.com\.tw\/detail\.php\?sn=\d+|forum\.gamer\.com\.tw\/C\.php\?bsn=\d+&snA=\d+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const url = normalizeBahamutUrl(m[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const after = text.slice(m.index, Math.min(text.length, m.index + 700));
    const date = parseJinaGnnDate(after);
    let title = titleFromJinaSnippet(after);
    // Drop breadcrumb-only chunks
    if (/\u5df4\u54c8\u59c6\u7279/.test(title) && /(detail|\u54c8\u5566)/.test(title)) title = "";
    if (!title) {
      const snip = after.match(
        /20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[\s\S]{0,220}/
      );
      if (snip) title = titleFromJinaSnippet(snip[0]);
    }
    if (!title) {
      title = /detail\.php/i.test(url)
        ? `GNN #${(url.match(/sn=(\d+)/) || [])[1] || "?"}`
        : `Forum thread`;
    }
    const item = {
      title: truncate(title, 120),
      url,
      date,
      source: "bahamut",
    };
    if (/detail\.php/i.test(url)) gnn.push(item);
    else forum.push(item);
  }
  return { gnn, forum };
}


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
};
