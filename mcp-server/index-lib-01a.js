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
  ensureData,
  readJson,
  writeJson,
  withCache,
  readBlocklist,
  normTitle,
  includesCI,
  itemAgeDays,
  isPrydwenHubItem,
  DATA_DIR,
  WATCHLIST_PATH,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  DIFF_WRITE_DISABLED,
  GK_ORIGIN,
  UA,
  DEFAULT_WATCHLIST,
  DEFAULT_BLOCKLIST,
  MERCH_TITLE_SUBS,
  MERCH_TITLE_RE,
  VERSION_EVENT_RE,
  DIGEST_SOURCE_PRIORITY,
  RADAR_PREFER_RE,
  RADAR_NEWS_RE,
  GK_TITLE_SIGNAL_RE,
  GK_NEWS_KEEP_RE,
  GK_QA_START_RE,
  GK_QA_DEBT_RE,
  GK_QA_BODY_RE,
  GK_MOD_SHORT_RE,
} from "./index-lib-00.js";


function isNoise(item) {
  const bl = readBlocklist();
  const title = normTitle(item?.title);
  const url = String(item?.url || "");
  const why = String(item?.why || "");
  const titleLower = title.toLowerCase();

  // Very short titles (≤4) are usually water / nav crumbs
  if (!title || title.length <= 4) return true;

  for (const sub of bl.title_substrings) {
    if (!sub || !includesCI(title, sub)) continue;
    // Merch/peripheral: keep if title also has version/event signal
    if (MERCH_TITLE_SUBS.has(sub) && VERSION_EVENT_RE.test(title)) continue;
    return true;
  }
  // Extra merch pass (covers titles matching merch RE even if blocklist stale)
  if (MERCH_TITLE_RE.test(title) && !VERSION_EVENT_RE.test(title)) {
    return true;
  }
  // "游戏下载" exact or as whole title (also listed in title_exact)
  if (title === "游戏下载" || titleLower === "游戏下载".toLowerCase()) {
    return true;
  }
  for (const exact of bl.title_exact) {
    if (exact && titleLower === String(exact).toLowerCase()) return true;
  }
  for (const sub of bl.url_substrings) {
    if (sub && includesCI(url, sub)) return true;
  }

  // Bare Prydwen hub pages (not character/news slugs)
  if (isPrydwenHubItem(item)) return true;

  // Soft age filter: dated items older than max_age_days are noise
  const age = itemAgeDays(item);
  const maxAge = bl.max_age_days ?? DEFAULT_BLOCKLIST.max_age_days;
  if (age != null && age > maxAge) return true;

  // Evergreen live-ops: hard-block bare game-name titles from generic
  // taptap:公测|预约 hits (v1). Also block exact evergreen titles unless
  // the title itself signals 新作/二周目/续作.
  const isEvergreenExact = bl.evergreen_exact.some(
    (n) => n && titleLower === String(n).toLowerCase()
  );
  if (isEvergreenExact) {
    if (RADAR_NEWS_RE.test(title)) return false;
    // why-only generic 公测/预约 (e.g. taptap:公测) with bare name
    if (/^taptap:(公测|预约)$/i.test(why.trim())) return true;
    // bare evergreen title is noise for radar/digest unless news signal
    return true;
  }

  // GameKee player Q&A / water-post noise (keep strong news/ops titles)
  const src = String(item?.source || "").toLowerCase();
  if (src === "gamekee") {
    if (!GK_NEWS_KEEP_RE.test(title)) {
      if (GK_QA_START_RE.test(title)) return true;
      if (GK_QA_DEBT_RE.test(title) && !/公告|更新/.test(title)) return true;
      if (/[?？]$/.test(title) && /^(请问|請問|求)/.test(title)) return true;
      // mod疑问 / short mod troubleshooting without news signal
      if (/mod疑问|mod問題/i.test(title)) return true;
      if (GK_MOD_SHORT_RE.test(title) && title.length <= 24) return true;
      if (GK_QA_BODY_RE.test(title)) return true;
    }
  }

  return false;
}

function radarScore(item) {
  const title = normTitle(item?.title);
  let score = 0;
  if (RADAR_PREFER_RE.test(title)) score += 10;
  if (RADAR_NEWS_RE.test(title)) score += 4;
  if (/CBT|公测|预约|定档|开服|上线/i.test(title)) score += 3;
  // Mild demotion for evergreen mentions that survived filter (news about them)
  const bl = readBlocklist();
  if (
    bl.evergreen_exact.some(
      (n) => n && title.toLowerCase().includes(String(n).toLowerCase())
    )
  ) {
    score -= 2;
  }
  return score;
}

function passesGamekeeRadarTitle(it) {
  const title = normTitle(it?.title);
  const why = String(it?.why || "");
  // Cap generic www 公测/预约 keyword hits: require title signal
  if (/^gamekee:(公测|预约)$/i.test(why.trim())) {
    return GK_TITLE_SIGNAL_RE.test(title);
  }
  return true;
}

function j(obj) {
  return JSON.stringify(obj);
}

function textResult(obj) {
  return { content: [{ type: "text", text: j(obj) }] };
}

function truncate(s, n = 48) {
  const t = String(s ?? "");
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function stripHtml(s) {
  return String(s ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function absGkUrl(u) {
  if (!u) return "";
  const s = String(u);
  if (s.startsWith("//")) return "https:" + s;
  if (s.startsWith("/")) return GK_ORIGIN + s;
  return s;
}

function articleUrl(alias, id) {
  const a = alias || "www";
  return `${GK_ORIGIN}/${a}/${id}.html`;
}

function clampLimit(n, def, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(Math.trunc(v), 1), max);
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const u = String(it?.url || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}

function titleFingerprint(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[《》【】\[\]()（）「」『』]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourcePriority(source) {
  return DIGEST_SOURCE_PRIORITY[String(source || "").toLowerCase()] ?? 0;
}

function itemDateMs(item) {
  const raw = item?.date || item?.updated;
  if (raw == null || raw === "") return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** URL dedupe, then title-fingerprint dedupe keeping higher-priority source. */
function dedupeByUrlOrTitle(items) {
  const urlDeduped = dedupeByUrl(items);
  const seenFp = new Map();
  const out = [];
  for (const it of urlDeduped) {
    const fp = titleFingerprint(it?.title);
    if (fp.length >= 8) {
      const existingIdx = seenFp.get(fp);
      if (existingIdx != null) {
        const prev = out[existingIdx];
        if (sourcePriority(it?.source) > sourcePriority(prev?.source)) {
          out[existingIdx] = it;
        } else if (
          sourcePriority(it?.source) === sourcePriority(prev?.source) &&
          itemDateMs(it) > itemDateMs(prev)
        ) {
          out[existingIdx] = it;
        }
        continue;
      }
      seenFp.set(fp, out.length);
    }
    out.push(it);
  }
  return out;
}

function normalizeUrlFp(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    u.hash = "";
    let p = u.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return `${u.protocol}//${u.host.toLowerCase()}${p}${u.search}`;
  } catch {
    return s.replace(/#.*$/, "").toLowerCase();
  }
}

/** Prefer normalized URL; else title fingerprint (same normalize as dedupe). */
function itemFingerprint(item) {
  const urlFp = normalizeUrlFp(item?.url);
  if (urlFp) return urlFp;
  return titleFingerprint(item?.title);
}


export {
  isNoise,
  radarScore,
  passesGamekeeRadarTitle,
  j,
  textResult,
  truncate,
  stripHtml,
  absGkUrl,
  articleUrl,
  clampLimit,
  dedupeByUrl,
  titleFingerprint,
  sourcePriority,
  itemDateMs,
  dedupeByUrlOrTitle,
  normalizeUrlFp,
  itemFingerprint,
};
