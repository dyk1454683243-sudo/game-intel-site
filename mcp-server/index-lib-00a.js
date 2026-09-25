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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.GAME_INTEL_DATA || path.resolve(__dirname, "../data");
const WATCHLIST_PATH = path.join(DATA_DIR, "watchlist.json");
const SOURCES_PATH = path.join(DATA_DIR, "sources.json");
const BLOCKLIST_PATH = path.join(DATA_DIR, "blocklist.json");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const CACHE_DISABLED = process.env.GAME_INTEL_CACHE === "0";
const CACHE_TTL_SEC = (() => {
  const n = Number(process.env.GAME_INTEL_CACHE_TTL_SEC);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 2700;
})();
const DIGEST_SEEN_PATH = path.join(DATA_DIR, "digest-seen.json");
const DIGEST_SEEN_CAP = 80;
/** GAME_INTEL_DIFF=0 disables writing digest snapshots (read-only diff still works). */
const DIFF_WRITE_DISABLED = process.env.GAME_INTEL_DIFF === "0";

const GK_ORIGIN = "https://www.gamekee.com";
const TAPTAP_ORIGIN = "https://www.taptap.cn";
const TAPTAP_PROBE = TAPTAP_ORIGIN + "/";
const INVEN_ORIGIN = "https://www.inven.co.kr";
const STEAM_STORE = "https://store.steampowered.com";
const STEAM_NEWS_API =
  "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";
const BAHAMUT_GNN_RSS = "https://gnn.gamer.com.tw/rss.xml";
const BAHAMUT_SEARCH_JINA =
  "https://r.jina.ai/https://search.gamer.com.tw/";
/** Known 哈啦板 BSN for watchlist games (board list B.php?bsn=). */
const BAHAMUT_BSN = {
  nikke: 36390,
  hw: 81419,
  bd2: 76207,
  star: 79865,
  asora: 85952,
};
/** Prefer these query strings for Bahamut CSE / digest. */
const BAHAMUT_QUERY_PREF = {
  nikke: "NIKKE",
  hw: "地平线行者",
  bd2: "Brown Dust 2",
  star: "蓝色星原",
  asora: "阿索拉",
};
const PRYDWEN_ORIGIN = "https://www.prydwen.gg";
const NIKKEGG_FEED = "https://nikke.gg/feed/";
const BD2_API_ORIGIN = "https://webapi.browndust2.com/api";
const BD2_SITE_ORIGIN = "https://www.browndust2.com";
/** Map short locale → BD2 notices API locale. */
const BD2_LOCALE_MAP = {
  en: "en-us",
  "en-us": "en-us",
  kr: "ko-kr",
  ko: "ko-kr",
  "ko-kr": "ko-kr",
  jp: "ja-jp",
  ja: "ja-jp",
  "ja-jp": "ja-jp",
  tw: "zh-tw",
  "zh-tw": "zh-tw",
  cn: "zh-cn",
  "zh-cn": "zh-cn",
};
/** Prefer these BD2 notice categories in digest official slot. */
const BD2_DIGEST_CAT_PREF = new Set([
  "notice",
  "inspection",
  "event",
  "update",
  "issue",
]);

/** Required by TapTap webapiv2 (VN_CODE); fragile if TapTap changes X-UA schema. */
const TAPTAP_XUA =
  "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=100000000&LOC=CN&PLT=PC&DS=Android&OS=Windows&OSV=10&DT=PC";

const UA =
  "Mozilla/5.0 (compatible; game-intel-mcp/0.3.19; +local) AppleWebKit/537.36";

const DEFAULT_WATCHLIST = {
  hw: {
    name: "Horizon Walker",
    name_zh: "地平线行者",
    gamekee_alias: "hw",
    keywords: ["Horizon Walker", "地平线行者"],
    steam_appid: 3279780,
  },
  nikke: {
    name: "Nikke",
    name_zh: "胜利女神：NIKKE",
    gamekee_alias: "nikke",
    keywords: ["NIKKE", "胜利女神"],
    official_url: "https://nikke-en.com/news.html",
  },
  bd2: {
    name: "Brown Dust 2",
    name_zh: "棕色尘埃2",
    gamekee_alias: "zsca2",
    keywords: ["Brown Dust 2", "棕色尘埃2"],
    official_url: "https://www.browndust2.com/en-us/news",
    official_api: "bd2_notices",
  },
  star: {
    name: "Azure Star Origin",
    name_zh: "蓝色星原：旅谣",
    gamekee_alias: null,
    keywords: [
      "蓝色星原",
      "蓝色星原：旅谣",
      "旅谣",
      "Azur Promilia",
      "蓝色星原旅谣",
      "奇波",
    ],
    official_url: "https://azurpromilia.com/news",
    official_site: "https://azurpromilia.manjuu.com/en/",
    official_api: "star_official",
  },
  miraesi: {
    name: "Invisible Future",
    name_zh: "미래시",
    gamekee_alias: null,
    keywords: [
      "미래시",
      "Invisible Future",
      "MIRESI",
      "CONTROL9",
      "미래시: 보이지 않는 미래",
    ],
    official_url: "https://newsroom.smilegate.com/bbs/board.php?bo_table=eng",
    official_api: "smilegate_newsroom",
    official_site: "https://miresi.onstove.com/en",
  },
  lo2: {
    name: "Last Origin 2",
    name_zh: "Last Origin 2",
    gamekee_alias: null,
    keywords: [
      "Last Origin 2",
      "라스트오리진2",
      "VALOFE",
      "라스트 오리진2",
      "Last Origin II",
    ],
    official_url: "https://www.valofe.com/",
    official_api: "lo2_official",
  },
  asora: {
    name: "Astrae Oratio",
    name_zh: "阿索拉：星之祈愿",
    gamekee_alias: null,
    keywords: [
      "阿索拉",
      "Astrae Oratio",
      "아스트라에",
      "오라티오",
      "Dynamis One",
      "Project AT",
      "星之祈愿",
      "星之祈願",
      "AstraeOratio",
      "NCSOFT",
    ],
    official_url: "https://astraeoratio.plaync.com/zh-tw/index",
    official_site: "https://astraeoratio.plaync.com/zh-tw/index",
    official_api: "asora_official",
  },
};

const DEFAULT_SOURCES = {
  gamekee: { enabled: true, type: "api", note: "primary CN wiki/news" },
  taptap: {
    enabled: true,
    type: "api",
    note: "app-search + community; needs X-UA VN_CODE",
  },
  inven: {
    enabled: true,
    type: "html",
    note: "www.inven.co.kr/search/webzine/article/{q}",
  },
  steam: {
    enabled: true,
    type: "api+html",
    note: "ISteamNews + store suggest/search",
  },
  bahamut: {
    enabled: true,
    type: "jina+html+rss",
    note: "Jina search.gamer type=2 GNN + 哈啦板 BSN scrape + gnn rss.xml token match",
  },
  prydwen: {
    enabled: true,
    type: "html",
    note: "prydwen.gg/nikke (+ banners) character/banner/guide links",
  },
  nikkegg: {
    enabled: true,
    type: "rss",
    note: "nikke.gg/feed/ EN news companion for NIKKE",
  },
  official: {
    enabled: true,
    type: "api+html+jina+steam",
    note: "bd2 notices API; miraesi Smilegate newsroom (+seed); star Azur Promilia (star_official+seed); lo2 VALOFE press (lo2_official+seed); asora NC/plaync (asora_official+seed); nikke official_url via Jina; steam_appid news; digest bucket official",
  },
};

const RADAR_KEYWORDS = ["公测", "预约", "CBT", "新作", "launch"];
const INVEN_PREF_GAMES = new Set(["miraesi", "lo2"]);

const DEFAULT_BLOCKLIST = {
  title_substrings: [
    "加速器",
    "OurPlay",
    "UU加速",
    "迅游",
    "奇游",
    "VPN",
    "梯子",
    "代练",
    "氪金号",
    "初始号",
    "卖号",
    "上号器",
    "下载器",
    "破解",
    "修改器",
    "内购破解",
    "【模型】",
    "模型情報",
    "手办",
    "黏土人",
    "figma",
    "ZOZOTOWN",
    "联名服饰",
    "聯名服飾",
    "周边贩售",
    "週邊販售",
    "一番赏",
    "一番賞",
  ],
  title_exact: ["游戏下载"],
  url_substrings: ["/ad/", "affiliate", "加速"],
  evergreen_exact: ["公主连结", "原神", "崩坏", "鸣潮", "明日方舟"],
  max_age_days: 60,
};

/** Merch/peripheral title_substrings: drop unless version/event signal present. */
const MERCH_TITLE_SUBS = new Set([
  "【模型】",
  "模型情報",
  "手办",
  "黏土人",
  "figma",
  "ZOZOTOWN",
  "联名服饰",
  "聯名服飾",
  "周边贩售",
  "週邊販售",
  "一番赏",
  "一番賞",
]);
const MERCH_TITLE_RE =
  /【模型】|模型情報|手办|黏土人|figma|ZOZOTOWN|联名服饰|聯名服飾|周边贩售|週邊販售|一番赏|一番賞/i;
const VERSION_EVENT_RE =
  /(版本|更新|上线|活動|活动|聯動|联动|卡池|banner|pickup)/i;
const PRYDWEN_HUB_TITLES = new Set([
  "banners",
  "tier list",
  "characters",
  "guides",
]);
const PRYDWEN_HUB_PATHS = new Set([
  "/nikke/banners",
  "/nikke/tier-list",
  "/nikke/characters",
  "/nikke/guides",
]);
const DIGEST_SOURCE_PRIORITY = {
  bahamut: 100,
  official: 95,
  nikkegg: 90,
  gamekee: 80,
  inven: 70,
  prydwen: 60,
  taptap: 50,
  steam: 40,
};

/** Prefer these title signals when ranking radar hits. */
const RADAR_PREFER_RE =
  /新作|公测定档|不删档|计费删档|CBT招募|预约突破|上线|开服|测试定档/i;
const RADAR_NEWS_RE = /新作|二周目|续作/i;
const GK_TITLE_SIGNAL_RE = /公测|预约|测试|定档|新作/;
const GK_NEWS_KEEP_RE =
  /公告|更新|维护|維護|版本|活动|活動|卡池|pickup|招募|补丁|補丁|已知问题|征集|访谈|訪談|Statement|Patch|Maintenance|Event/i;
const GK_QA_START_RE =
  /^(请问|請問|問|求|帮忙|幫|有没有|有沒有|怎么|怎麼|为何|為何)/;
const GK_QA_DEBT_RE = /还债|還債/;
/** GameKee water-post / Q&A title noise (no news signal). */
const GK_QA_BODY_RE =
  /mod疑问|mod問題|疑问|疑問|求助|求大佬|不生效|怎么弄|怎麼弄|目录不是|目錄不是/;
const GK_MOD_SHORT_RE = /^mod\b/i;


export {
  __dirname,
  DATA_DIR,
  WATCHLIST_PATH,
  SOURCES_PATH,
  BLOCKLIST_PATH,
  CACHE_DIR,
  CACHE_DISABLED,
  CACHE_TTL_SEC,
  DIGEST_SEEN_PATH,
  DIGEST_SEEN_CAP,
  DIFF_WRITE_DISABLED,
  GK_ORIGIN,
  TAPTAP_ORIGIN,
  TAPTAP_PROBE,
  INVEN_ORIGIN,
  STEAM_STORE,
  STEAM_NEWS_API,
  BAHAMUT_GNN_RSS,
  BAHAMUT_SEARCH_JINA,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  PRYDWEN_ORIGIN,
  NIKKEGG_FEED,
  BD2_API_ORIGIN,
  BD2_SITE_ORIGIN,
  BD2_LOCALE_MAP,
  BD2_DIGEST_CAT_PREF,
  TAPTAP_XUA,
  UA,
  DEFAULT_WATCHLIST,
  DEFAULT_SOURCES,
  RADAR_KEYWORDS,
  INVEN_PREF_GAMES,
  DEFAULT_BLOCKLIST,
  MERCH_TITLE_SUBS,
  MERCH_TITLE_RE,
  VERSION_EVENT_RE,
  PRYDWEN_HUB_TITLES,
  PRYDWEN_HUB_PATHS,
  DIGEST_SOURCE_PRIORITY,
  RADAR_PREFER_RE,
  RADAR_NEWS_RE,
  GK_TITLE_SIGNAL_RE,
  GK_NEWS_KEEP_RE,
  GK_QA_START_RE,
  GK_QA_DEBT_RE,
  GK_QA_BODY_RE,
  GK_MOD_SHORT_RE,
};
