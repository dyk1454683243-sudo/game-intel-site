/**
 * Pure HTML renderers for the human UI. No DOM, no invented tiers or pull advice.
 * Non-deep games stay identity-only. Deep character cards are the eight DEEP_GAMES.
 */
import { portraitImgSrc } from "./portrait.js";
import {
  displayCharacterName,
  displayGameName,
  displaySinnerName,
  getLang,
  languageSwitcher,
  localizePath,
  tx,
} from "./i18n.js";

export const DEEP_GAMES = Object.freeze(["hw", "nikke", "bd2", "reverse-1999", "arknights-endfield", "limbus-company", "zenless-zone-zero", "wuthering-waves"]);

export const WATCH_ORDER = Object.freeze([
  { id: "hw", name: "Horizon Walker", name_zh: "地平线行者" },
  { id: "nikke", name: "NIKKE", name_zh: "胜利女神：NIKKE" },
  { id: "bd2", name: "Brown Dust 2", name_zh: "棕色尘埃2" },
  { id: "zenless-zone-zero", name: "Zenless Zone Zero", name_zh: "绝区零" },
  { id: "star", name: "Azure Star Origin", name_zh: "蓝色星原：旅谣" },
  { id: "asora", name: "Astrae Oratio", name_zh: "阿索拉：星之祈愿" },
  { id: "miraesi", name: "Invisible Future", name_zh: "미래시" },
  { id: "lo2", name: "Last Origin 2", name_zh: "Last Origin 2" },
  { id: "reverse-1999", name: "Reverse: 1999", name_zh: "重返未来：1999" },
  { id: "arknights-endfield", name: "Arknights: Endfield", name_zh: "明日方舟：终末地" },
  { id: "limbus-company", name: "Limbus Company", name_zh: "边狱公司" },
  { id: "wuthering-waves", name: "Wuthering Waves", name_zh: "鸣潮" },
]);

const NAV = [
  ["home", "/", ["首页", "Home", "ホーム"]],
  ["catalog", "/catalog/", ["目录", "Catalog", "カタログ"]],
  ["watchlist", "/watchlist/", ["观察名单", "Watchlist", "ウォッチリスト"]],
  ["me", "/me/", ["我的关注", "Following", "フォロー"]],
  ["planner", "/planner/", ["抽卡规划", "Planner", "計画"]],
  ["compare", "/compare/", ["对比", "Compare", "比較"]],
  ["claims", "/claims/", ["核对墙", "Claims", "照合"]],
  ["for-ai", "/for-ai/", ["给 AI", "For AI", "AI 向け"]],
  ["developers", "/developers/", ["开发者", "Developers", "開発者"]],
];

const VIEW_PATH = {
  home: "/",
  catalog: "/catalog/",
  watchlist: "/watchlist/",
  me: "/me/",
  planner: "/planner/",
  compare: "/compare/",
  claims: "/claims/",
  "for-ai": "/for-ai/",
  developers: "/developers/",
  game: "/game/",
  character: "/character/",
};

const PUBLIC_SITE = "https://game-intel-ai.dyk1454683243.workers.dev";

const GAP = "未见可靠出处";

const TEAM_KEY_LABELS = {
  dopamine_auto: "多巴胺自动",
  story: "主线开荒",
  rift_45: "45层裂隙",
  dopamine: "多巴胺",
  spec_ops: "特殊作战",
  union: "总力战",
  training: "特殊训练场",
  comp: "配队",
  note: "说明",
};

export function teamLines(card) {
  const teams = card && card.teams;
  if (!teams || typeof teams !== "object" || Array.isArray(teams)) return [];
  const out = [];
  for (const [key, value] of Object.entries(teams)) {
    const label = teamLabel(key);
    const lines = Array.isArray(value) ? value : [value];
    for (const line of lines) {
      if (line == null || String(line).trim() === "") continue;
      out.push({ label, text: String(line) });
    }
  }
  return out;
}

export function isDeep(id) {
  return DEEP_GAMES.includes(String(id || ""));
}

const TEAM_LABELS_EN = {
  dopamine_auto: "Dopamine auto",
  story: "Story",
  rift_45: "Rift 45",
  dopamine: "Dopamine",
  spec_ops: "Spec ops",
  union: "Union raid",
  training: "Training",
  comp: "Team",
  note: "Note",
};

const TEAM_LABELS_JA = {
  dopamine_auto: "ドーパミン自動",
  story: "ストーリー",
  rift_45: "裂隙45階",
  dopamine: "ドーパミン",
  spec_ops: "特殊作戦",
  union: "総力戦",
  training: "訓練場",
  comp: "編成",
  note: "メモ",
};

function teamLabel(key) {
  const zh = TEAM_KEY_LABELS[key];
  if (!zh) return key;
  return tx(zh, TEAM_LABELS_EN[key] || key, TEAM_LABELS_JA[key] || zh);
}

export function deepNames() {
  const lang = getLang();
  return DEEP_GAMES.map((id) => {
    const row = WATCH_ORDER.find((game) => game.id === id);
    if (!row) return id;
    if (lang === "en") return `${row.name} (${id})`;
    return `${row.name_zh}（${id}）`;
  }).join(lang === "en" ? ", " : "、");
}

export function safeId(value) {
  const s = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(s) ? s : "";
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeHttpUrl(url) {
  const s = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  if (/[\s<>"']/.test(s)) return "";
  return s;
}

export function shanghaiToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shanghaiDayFromStamp(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return shanghaiToday(new Date(parsed));
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function gameHref(id) {
  return localizePath(`/game/?id=${encodeURIComponent(id)}`);
}

export function characterHref(game, id) {
  return localizePath(`/character/?game=${encodeURIComponent(game)}&id=${encodeURIComponent(id)}`);
}

export function compareAddHref(game, id) {
  return localizePath(`/compare/?add=${encodeURIComponent(`${game}:${id}`)}`);
}

export function aliasPartNames(doc) {
  const raw = [];
  if (doc && Array.isArray(doc._parts)) raw.push(...doc._parts);
  if (doc && doc._meta && Array.isArray(doc._meta.parts)) raw.push(...doc._meta.parts);
  const out = [];
  for (const name of raw) {
    if (typeof name === "string" && /^aliases\.p\d+\.json$/.test(name) && !out.includes(name)) {
      out.push(name);
    }
  }
  return out;
}

export function mergeAliasDocs(docs) {
  const aliases = {};
  for (const doc of docs || []) {
    const rows = doc && doc.aliases;
    if (!rows || typeof rows !== "object") continue;
    for (const [key, row] of Object.entries(rows)) {
      if (!aliases[key]) aliases[key] = row;
    }
  }
  return { aliases };
}

export function aliasesByCharacterId(doc) {
  const out = {};
  const aliases = doc && doc.aliases && typeof doc.aliases === "object" ? doc.aliases : {};
  for (const [key, row] of Object.entries(aliases)) {
    if (!row || typeof row !== "object" || !row.id) continue;
    if (row.kind && row.kind !== "character") continue;
    if (!out[row.id]) out[row.id] = [];
    out[row.id].push(key);
  }
  return out;
}

export function filterGames(games, opts = {}) {
  const q = String(opts.q || "").trim().toLowerCase();
  const platform = String(opts.platform || "");
  const tag = String(opts.tag || "");
  const kind = String(opts.kind || "all");
  return (games || []).filter((game) => {
    if (kind === "watchlist" && !game.watchlist) return false;
    if (kind === "stub" && game.stub !== true) return false;
    if (kind === "deep" && !isDeep(game.id)) return false;
    if (platform && !(game.platforms || []).includes(platform)) return false;
    if (tag && !(game.tags || []).includes(tag)) return false;
    if (!q) return true;
    const hay = [game.id, game.name, game.name_zh, ...(game.platforms || []), ...(game.tags || [])]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function filterCharacters(chars, q, aliasesById) {
  const query = String(q || "").trim().toLowerCase();
  const list = chars || [];
  if (!query) return list;
  return list.filter((card) => {
    const extra = (aliasesById && aliasesById[card.id]) || [];
    const sinner = card.sinner && typeof card.sinner === "object" ? card.sinner : {};
    const hay = [card.id, card.name, card.name_zh, sinner.id, sinner.name, sinner.name_en, sinner.name_zh, ...extra]
      .join("\n")
      .toLowerCase();
    return hay.includes(query);
  });
}

export function gapSentences(value) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (typeof node === "string") {
      if (node.includes(GAP) && !seen.has(node)) {
        seen.add(node);
        found.push(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) walk(node[key]);
    }
  };
  walk(value);
  return found;
}

function watchRank(id) {
  const index = WATCH_ORDER.findIndex((row) => row.id === id);
  return index === -1 ? 100 : index;
}

function watchMeta(id) {
  return WATCH_ORDER.find((row) => row.id === id) || null;
}

function hrefFor(href) {
  const raw = String(href || "");
  if (!raw.startsWith("/")) return raw;
  return localizePath(raw);
}

function link(href, label) {
  const safe = safeHttpUrl(href) || (String(href || "").startsWith("/") ? String(href) : "");
  if (!safe) return esc(label || href || "");
  const local = safe.startsWith("/") ? hrefFor(safe) : safe;
  return `<a href="${esc(local)}"${safe.startsWith("/") ? "" : ' rel="noopener noreferrer"'}>${esc(label || safe)}</a>`;
}

function chips(values) {
  const list = (values || []).filter((value) => value != null && String(value).trim() !== "");
  if (!list.length) return `<span class="meta">${esc(tx("无", "None", "なし"))}</span>`;
  return list.map((value) => `<span class="tag">${esc(value)}</span>`).join("");
}

function flag(text, kind) {
  return `<span class="flag ${kind}">${esc(text)}</span>`;
}

function followButton(kind, game, id, pressed) {
  const gid = safeId(game);
  if (!gid) return "";
  const on = pressed === true;
  if (kind === "char") {
    const cid = safeId(id);
    if (!cid) return "";
    return `<button type="button" class="follow" data-follow-kind="char" data-game="${esc(gid)}" data-id="${esc(cid)}" aria-pressed="${on ? "true" : "false"}">${esc(on ? tx("已关注这个角色", "Following this character", "このキャラをフォロー中") : tx("关注这个角色", "Follow this character", "このキャラをフォロー"))}</button>`;
  }
  return `<button type="button" class="follow" data-follow-kind="game" data-game="${esc(gid)}" aria-pressed="${on ? "true" : "false"}">${esc(on ? tx("已关注这部游戏", "Following this game", "このゲームをフォロー中") : tx("关注这部游戏", "Follow this game", "このゲームをフォロー"))}</button>`;
}

let framePath = "/";

function renderNav(active) {
  const links = NAV.map(([id, href, labels]) => {
    const current = id === active ? ' aria-current="page"' : "";
    return `<a href="${esc(hrefFor(href))}"${current}>${esc(tx(labels[0], labels[1], labels[2]))}</a>`;
  }).join("");
  const navLabel = tx("主导航", "Primary", "メインメニュー");
  return `<header class="top"><a class="brand" href="${esc(hrefFor("/"))}">game-intel</a><nav class="site-nav" aria-label="${esc(navLabel)}">${links}</nav>${languageSwitcher(framePath)}</header>`;
}

function renderFooter() {
  return `<footer class="site-foot"><p>${esc(tx("人读网页专区，AI 读 MCP 与 /v1，同一份已发布数据。", "People read the site. AI reads MCP and /v1. Both use the same published data.", "人はサイトを読み、AI は MCP と /v1 を読む。同じ公開データです。"))}</p><p>${esc(tx("目录宽、深耕窄、出处硬。不编造评分或价格。", "Broad catalog, narrow guides, hard sources. No invented scores or prices.", "目録は広く、深掘りは狭く、出典は厳しく。点数や価格は作らない。"))}</p><p>${esc(tx("无登录。关注名单只留在这台浏览器。CDK 不在本站。", "No login. The follow list stays in this browser. Redeem codes are not claimed here.", "ログインなし。フォローはブラウザ内だけ。引き換えコードは代行しない。"))}</p></footer>`;
}

function depthBanner(kind, label) {
  return `<p class="depth-banner ${kind}">${esc(label)}</p>`;
}

function characterDepth(card) {
  if (!card || card.stub === true) return "stub";
  if (!card.summary || card.summary.stub === true) return "partial";
  return "deep";
}

export function renderFrame(active, body, opts = {}) {
  framePath = opts.path || VIEW_PATH[active] || "/";
  return `<a class="skip" href="#main">${esc(tx("跳到内容", "Skip to content", "本文へ"))}</a>${renderNav(active)}<main id="main" tabindex="-1">${body}</main>${renderFooter()}`;
}

export function renderError(message) {
  return `<p class="error">${esc(message || tx("加载失败", "Could not load", "読み込めません"))}</p>`;
}

function freshnessNote(meta, today) {
  if (!meta || typeof meta !== "object") return "";
  const bits = [];
  if (meta.fixture === true) bits.push(tx("fixture：示例数据，不是实时情报", "fixture: sample data, not live intel", "fixture：見本データで、ライブ情報ではない"));
  const day = shanghaiDayFromStamp(meta.generated_at);
  if (day && today && day !== today) {
    bits.push(tx(
      `generated_at ${meta.generated_at} 不是上海当日 ${today}`,
      `generated_at ${meta.generated_at} is not the Shanghai day ${today}`,
      `generated_at ${meta.generated_at} は上海の当日 ${today} ではない`
    ));
  }
  if (!bits.length) return "";
  return `<p class="gap">${bits.map((bit) => esc(bit)).join(" · ")}</p>`;
}

function metaLine(meta) {
  if (!meta || typeof meta !== "object") return "";
  const bits = [meta.generated_at, meta.timezone, meta.source].filter(Boolean);
  return bits.length ? `<p class="meta">${bits.map((bit) => esc(bit)).join(" · ")}</p>` : "";
}

function headlineItem(item) {
  const title = item && item.title ? String(item.title) : "";
  if (!title) return "";
  const href = safeHttpUrl(item.url);
  const heading = href ? link(href, title) : esc(title);
  const bits = [];
  if (item.source) bits.push(esc(item.source));
  if (item.why) bits.push(esc(item.why));
  const when = item.date || item.updated || item.published_at || item.as_of;
  const day = shanghaiDayFromStamp(when);
  if (day) bits.push(esc(day));
  const meta = bits.length ? `<span class="meta">${bits.join(" · ")}</span>` : "";
  const summary = item.summary ? `<p class="blurb">${esc(item.summary)}</p>` : "";
  return `<li>${heading}${meta ? ` ${meta}` : ""}${summary}</li>`;
}

function jsonLink(href, label) {
  return `<p class="meta">${esc(tx("JSON：", "JSON: ", "JSON："))}${link(href, label || href)}</p>`;
}

function zoneEntries() {
  return `<nav class="zones" aria-label="${esc(tx("首页入口", "Home sections", "ホームの入口"))}">
<a class="zone" href="${esc(hrefFor("/watchlist/"))}"><strong>${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</strong><span>${esc(tx("深耕从图鉴进。其余游戏只保留身份。", "Guides start from the watchlist. Other games stay identity-only.", "深掘りはウォッチリストから。それ以外は身元だけ。"))}</span></a>
<a class="zone" href="${esc(hrefFor("/me/"))}"><strong>${esc(tx("我的关注", "Following", "フォロー"))}</strong><span>${esc(tx("只看订阅的游戏和角色。名单留在这台浏览器。", "Only games and characters you follow. The list stays in this browser.", "フォローしたゲームとキャラだけ。リストはこのブラウザに残る。"))}</span></a>
<a class="zone" href="${esc(hrefFor("/planner/"))}"><strong>${esc(tx("抽卡规划", "Planner", "計画"))}</strong><span>${esc(tx("按有出处的卡池日期看还剩几天。没有写明的保底不算。", "Days left use sourced banner dates. Unstated pity is not calculated.", "残り日数は出典のある日付だけ。書いていない天井は計算しない。"))}</span></a>
<a class="zone" href="${esc(hrefFor("/compare/"))}"><strong>${esc(tx("角色对比", "Compare", "比較"))}</strong><span>${esc(tx("同一游戏 2 到 4 张卡。空字段保持暂无出处。", "2 to 4 cards from the same game. Empty fields stay empty.", "同じゲームの 2〜4 枚。空欄は埋めない。"))}</span></a>
<a class="zone" href="${esc(hrefFor("/for-ai/"))}"><strong>${esc(tx("给 AI", "For AI", "AI 向け"))}</strong><span>${esc(tx("MCP、OpenAPI、llms.txt。与人读同一份已发布数据。", "MCP, OpenAPI, llms.txt. The same published data people read.", "MCP、OpenAPI、llms.txt。人が読むのと同じ公開データ。"))}</span></a>
</nav>`;
}

export function renderHome({ digest, radar, digestError = "", radarError = "", today } = {}) {
  const day = today || shanghaiToday();
  const digestBlock = digestError
    ? renderError(digestError)
    : renderDigest(digest, day);
  const radarBlock = radarError ? renderError(radarError) : renderRadar(radar, day);
  return `<h1>${esc(tx("今日情报", "Today", "今日の情報"))}</h1>
<p class="lede">${tx("今日摘要读已发布的 <code>/v1/digest.json</code>。人从观察名单继续，AI 从「给 AI」读同一份数据。", "Today's brief is the published <code>/v1/digest.json</code>. People continue from the watchlist. AI reads the same data from For AI.", "今日の摘要は公開済みの <code>/v1/digest.json</code>。人はウォッチリストへ、AI は「AI 向け」から同じデータを読む。")}</p>
${zoneEntries()}
<section aria-labelledby="digest-h">${digestBlock}</section>
<section aria-labelledby="radar-h">${radarBlock}</section>`;
}

function renderDigest(digest, today) {
  const head = `<h2 id="digest-h">${esc(tx("今日摘要", "Today's brief", "今日の摘要"))}</h2>${freshnessNote(digest && digest.meta, today)}${metaLine(digest && digest.meta)}`;
  const rows = (digest && digest.digests) || [];
  if (!rows.length) {
    return `${head}<p class="meta">${esc(tx("今日摘要暂无条目。", "No brief items today.", "今日の摘要はまだありません。"))}</p>${jsonLink("/v1/digest.json", "/v1/digest.json")}`;
  }
  const ordered = [...rows].sort((a, b) => watchRank(a.game) - watchRank(b.game) || String(a.game).localeCompare(String(b.game)));
  const blocks = ordered
    .map((row) => {
      const id = safeId(row.game);
      const fallback = watchMeta(row.game);
      const name = row.name || (fallback ? displayGameName(fallback) : "") || row.game || tx("未命名", "Untitled", "無題");
      const title = id ? link(gameHref(id), name) : esc(name);
      const items = Array.isArray(row.items) ? row.items : [];
      const shown = items.slice(0, 8);
      const list = shown.map(headlineItem).filter(Boolean).join("");
      const more =
        items.length > shown.length
          ? `<p class="meta">${esc(tx(`其余 ${items.length - shown.length} 条见 /v1/digest.json`, `${items.length - shown.length} more in /v1/digest.json`, `残り ${items.length - shown.length} 件は /v1/digest.json`))}</p>`
          : "";
      const count = Number.isFinite(row.count) ? row.count : items.length;
      return `<article class="card"><h3>${title} <span class="meta">${esc(id || row.game || "")} · ${esc(tx(`${count} 条`, `${count} items`, `${count} 件`))}</span></h3>${
        list ? `<ul class="headlines">${list}</ul>` : `<p class="meta">${esc(tx("暂无条目。", "No items.", "項目はありません。"))}</p>`
      }${more}</article>`;
    })
    .join("");
  return `${head}<div class="digest-list">${blocks}</div>${jsonLink("/v1/digest.json", "/v1/digest.json")}`;
}

function renderRadar(radar, today) {
  const head = `<h2 id="radar-h">${esc(tx("雷达", "Radar", "レーダー"))}</h2><p class="rule">${esc(tx("雷达不是第二份目录，只列出 JSON 里已有的标题与出处。", "Radar is not a second catalog. It only lists titles and sources already in the JSON.", "レーダーは第二の目録ではない。JSON にある題と出典だけを出す。"))}</p>${freshnessNote(radar && radar.meta, today)}${metaLine(radar && radar.meta)}`;
  const keywords = (radar && radar.keywords) || [];
  const keywordLine = keywords.length ? `<p>${esc(tx("关键词：", "Keywords: ", "キーワード："))}${chips(keywords)}</p>` : "";
  const channels = radar && radar.channels && typeof radar.channels === "object" ? radar.channels : null;
  let channelLine = "";
  if (channels) {
    const problems = Object.entries(channels)
      .filter(([, row]) => row && row.error)
      .map(([name, row]) => `${name}：${row.error}`);
    if (problems.length) channelLine = `<p class="gap">${problems.map((line) => esc(line)).join(" · ")}</p>`;
  }
  const items = (radar && radar.items) || [];
  if (!items.length) {
    return `${head}${keywordLine}${channelLine}<p class="meta">${esc(tx("雷达暂无条目。", "Radar has no items.", "レーダーに項目はありません。"))}</p>${jsonLink("/v1/radar.json", "/v1/radar.json")}`;
  }
  const shown = items.slice(0, 20);
  const list = shown.map(headlineItem).filter(Boolean).join("");
  const more =
    items.length > shown.length
      ? `<p class="meta">${esc(tx(`其余 ${items.length - shown.length} 条见 /v1/radar.json`, `${items.length - shown.length} more in /v1/radar.json`, `残り ${items.length - shown.length} 件は /v1/radar.json`))}</p>`
      : "";
  return `${head}${keywordLine}${channelLine}<ul class="headlines feed">${list}</ul>${more}${jsonLink("/v1/radar.json", "/v1/radar.json")}`;
}

function option(value, label, current) {
  const selected = String(value) === String(current || "") ? " selected" : "";
  return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
}

function sortedUnique(games, key) {
  const set = new Set();
  for (const game of games || []) {
    for (const value of game[key] || []) set.add(value);
  }
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
}

function flagWatch() {
  return flag(tx("观察名单", "Watchlist", "ウォッチリスト"), "wl");
}
function flagDeep() {
  return flag(tx("已深耕", "Guides", "深掘りあり"), "deep");
}
function flagGap() {
  return flag(tx("尚无深耕", "No guides yet", "深掘りなし"), "gap");
}
function depthWord(deep) {
  return deep ? tx("深耕", "Guides", "深掘り") : tx("尚无深耕", "No guides yet", "深掘りなし");
}
function gapChrome() {
  return tx(GAP, "No reliable source", "信頼できる出典がない");
}
function sourceGap() {
  return tx(`出处：${GAP}`, "Sources: no reliable source", "出典：信頼できる出典がない");
}

function gameSubtitle(game, title) {
  const bits = [];
  const zh = typeof game.name_zh === "string" ? game.name_zh.trim() : "";
  const en = typeof game.name === "string" ? game.name.trim() : "";
  if (getLang() === "zh-CN") {
    if (en && en !== title) bits.push(en);
  } else if (zh && zh !== title) bits.push(zh);
  else if (en && en !== title) bits.push(en);
  if (game.id) bits.push(game.id);
  return bits.filter(Boolean).join(" · ");
}

export function renderCatalog(index, opts = {}) {
  const games = (index && index.games) || [];
  const filtered = filterGames(games, opts);
  const platforms = sortedUnique(games, "platforms");
  const tags = sortedUnique(games, "tags");
  const kind = opts.kind || "all";
  const total = index && index.count != null ? index.count : games.length;
  const rows = filtered
    .map((game) => {
      const title = displayGameName(game) || game.id;
      const sub = gameSubtitle(game, title);
      const marks = [];
      if (game.watchlist) marks.push(flagWatch());
      if (game.stub === true) marks.push(flag("stub", "stub"));
      marks.push(isDeep(game.id) ? flagDeep() : flagGap());
      const tone = isDeep(game.id) ? "row-deep" : "row-stub";
      return `<li><a class="row ${tone}" href="${esc(gameHref(game.id))}"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span><span class="row-tags">${chips(game.platforms)} ${chips(game.tags)}</span><span class="row-flags">${marks.join(" ")}</span></a></li>`;
    })
    .join("");
  return `<h1>${esc(tx("目录", "Catalog", "カタログ"))}</h1>
<p class="lede">${tx(
    `轻目录，共 ${esc(total)} 部。stub 身份卡只展示名称、平台、标签、出处和 steam_appid，不写评分或价格。`,
    `A light catalog of ${esc(total)} games. Stub identity cards show the stored name, platforms, tags, sources, and steam_appid. No scores or prices.`,
    `軽い目録、${esc(total)} 本。stub の身元カードは名前、プラットフォーム、タグ、出典、steam_appid だけ。点数や価格は書かない。`
  )}</p>
<p class="meta">${index && index.as_of ? `as_of ${esc(index.as_of)}` : ""} ${index && index.timezone ? esc(index.timezone) : ""}</p>
<form id="filters" role="search">
<label>${esc(tx("搜索", "Search", "検索"))} <input id="q" name="q" type="search" value="${esc(opts.q || "")}" placeholder="${esc(tx("名称、id、标签", "Name, id, tag", "名前、id、タグ"))}" autocomplete="off"/></label>
<label>${esc(tx("范围", "Scope", "範囲"))} <select id="kind" name="kind">${option("all", tx("全部", "All", "すべて"), kind)}${option("watchlist", tx("观察名单", "Watchlist", "ウォッチリスト"), kind)}${option("stub", tx("仅身份", "Identity only", "身元のみ"), kind)}${option("deep", tx("已深耕", "Guides", "深掘りあり"), kind)}</select></label>
<label>${esc(tx("平台", "Platform", "プラットフォーム"))} <select id="platform" name="platform">${option("", tx("全部平台", "All platforms", "すべてのプラットフォーム"), opts.platform)}${platforms.map((value) => option(value, value, opts.platform)).join("")}</select></label>
<label>${esc(tx("标签", "Tag", "タグ"))} <select id="tag" name="tag">${option("", tx("全部标签", "All tags", "すべてのタグ"), opts.tag)}${tags.map((value) => option(value, value, opts.tag)).join("")}</select></label>
</form>
<p class="meta">${esc(tx(`显示 ${filtered.length} 部`, `Showing ${filtered.length}`, `${filtered.length} 本を表示`))}</p>
${rows ? `<ul class="rows">${rows}</ul>` : `<p class="meta">${esc(tx("没有匹配的游戏。", "No matching games.", "一致するゲームはありません。"))}</p>`}
${jsonLink("/v1/games/index.json", "/v1/games/index.json")}`;
}

function identityFacts(game) {
  const title = displayGameName(game) || game.id;
  const sub = gameSubtitle(game, title).replace(new RegExp(` · ${game.id}$`), "");
  const steam = game.steam_appid == null || game.steam_appid === "" ? tx("无", "None", "なし") : game.steam_appid;
  const marks = [];
  if (game.watchlist) marks.push(flagWatch());
  if (game.stub === true) marks.push(flag("stub", "stub"));
  marks.push(isDeep(game.id) ? flagDeep() : flagGap());
  const deep = isDeep(game.id);
  return `<p class="crumbs">${link("/catalog/", tx("目录", "Catalog", "カタログ"))}${game.watchlist ? ` / ${link("/watchlist/", tx("观察名单", "Watchlist", "ウォッチリスト"))}` : ""} / ${esc(title)}</p>
${depthBanner(deep ? "deep" : "stub", depthWord(deep))}
<h1>${esc(title)} <code>${esc(game.id || "")}</code></h1>
<p class="flags">${marks.join(" ")}</p>
<p class="follow-row">${followButton("game", game.id)}</p>
${sub ? `<p class="meta">${esc(sub)}</p>` : ""}
<dl class="facts">
<dt>${esc(tx("平台", "Platform", "プラットフォーム"))}</dt><dd>${chips(game.platforms)}</dd>
<dt>${esc(tx("标签", "Tags", "タグ"))}</dt><dd>${chips(game.tags)}</dd>
<dt>steam_appid</dt><dd><code>${esc(steam)}</code></dd>
${game.as_of ? `<dt>as_of</dt><dd>${esc(game.as_of)}${game.timezone ? ` ${esc(game.timezone)}` : ""}</dd>` : ""}
</dl>
<h2>${esc(tx("出处", "Sources", "出典"))}</h2>
${renderSourceList(game.sources)}
${game.note ? `<p class="meta">${esc(tx("备注：", "Note: ", "メモ："))}${esc(game.note)}</p>` : ""}
${gapBanner(game)}`;
}

function renderSourceList(sources) {
  const items = normalizeSources(sources);
  if (!items.length) return `<p class="gap">${esc(sourceGap())}</p>`;
  return `<ul class="sources">${items
    .map((item) => `<li>${link(item.url, item.label || item.url)}</li>`)
    .join("")}</ul>`;
}

function normalizeSources(sources) {
  const out = [];
  const seen = new Set();
  const add = (url, label) => {
    const href = safeHttpUrl(url);
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ url: href, label: label || href });
  };
  const list = Array.isArray(sources) ? sources : sources ? [sources] : [];
  for (const source of list) {
    if (typeof source === "string") add(source, source);
    else if (source && typeof source === "object") add(source.url, source.label || source.url);
  }
  return out;
}

function gapBanner(value) {
  const sentences = gapSentences(value);
  if (!sentences.length) return "";
  return `<aside class="gap-banner"><strong>${esc(gapChrome())}</strong><ul>${sentences.map((sentence) => `<li>${esc(sentence)}</li>`).join("")}</ul></aside>`;
}

const BANNER_STATUS = {
  current: "进行中",
  ended: "已结束",
  upcoming: "未开始",
};

const CODE_STATUS = {
  active: "有效期内",
  expired: "已过期",
  expiry_not_stated: "出处未写有效期",
  reported_working: "页面称仍可用，无官方截止",
  listed_permanent: "出处标为永久",
};

function bannerStatus(status) {
  const zh = BANNER_STATUS[status];
  if (!zh) return "";
  const en = { current: "Live", ended: "Ended", upcoming: "Upcoming" }[status];
  const ja = { current: "開催中", ended: "終了", upcoming: "開始前" }[status];
  return tx(zh, en, ja);
}

function codeStatus(status) {
  const zh = CODE_STATUS[status];
  if (!zh) return status || "";
  const en = {
    active: "In window",
    expired: "Expired",
    expiry_not_stated: "Source states no expiry",
    reported_working: "Page says it still works; no official end",
    listed_permanent: "Source marks it permanent",
  }[status];
  const ja = {
    active: "期限内",
    expired: "期限切れ",
    expiry_not_stated: "出典に期限の記載なし",
    reported_working: "ページは有効と書く。公式の締切なし",
    listed_permanent: "出典は無期限と書く",
  }[status];
  return tx(zh, en || zh, ja || zh);
}

function renderBanners(doc) {
  const rows = doc && Array.isArray(doc.banners) ? doc.banners : [];
  if (!rows.length) return "";
  const items = rows
    .map((row) => {
      const ups = Array.isArray(row.up) ? row.up.filter(Boolean).join("、") : "";
      const when = [row.start_text || row.start, row.end_text || row.end].filter(Boolean).join(" → ");
      const label = bannerStatus(row.status);
      const kind = row.status === "current" ? "deep" : "gap";
      const src = safeHttpUrl(row.source);
      return `<li><strong>${esc(row.name || row.id || tx("卡池", "Banner", "ガチャ"))}</strong> ${label ? flag(label, kind) : ""}<div class="meta">${esc(ups)}</div><div class="meta">${esc(when)}${row.timezone ? ` · ${esc(row.timezone)}` : ""}</div>${src ? `<div>${link(src, tx("出处", "Source", "出典"))}</div>` : ""}</li>`;
    })
    .join("");
  return `<h2>${esc(tx("卡池", "Banners", "ガチャ"))}</h2><p class="rule">${tx("名称、UP 和起止时间只来自 <code>banners.json</code>。出处没写时区的，这里不补。", "Names, rate-up units, and times come only from <code>banners.json</code>. A missing timezone is not filled in.", "名称、ピックアップ、期間は <code>banners.json</code> だけ。出典にないタイムゾーンは補わない。")}</p><ul>${items}</ul>`;
}

function renderCodes(doc) {
  const rows = doc && Array.isArray(doc.codes) ? doc.codes : [];
  if (!rows.length) {
    const note = doc && typeof doc.note === "string" ? doc.note.trim() : "";
    if (!note) return "";
    return `<h2>${esc(tx("兑换码", "Redeem codes", "引き換えコード"))}</h2><p class="rule">${esc(note)}</p>`;
  }
  const items = rows
    .map((row) => {
      const label = codeStatus(row.status);
      const kind = row.status === "expired" ? "gap" : "wl";
      const src = safeHttpUrl(row.source);
      const when = row.expires_text || row.expires || "";
      const rewards = row.rewards || tx("出处未写奖励", "Source does not list rewards", "出典に報酬の記載なし");
      return `<li><code>${esc(row.code || "")}</code> ${label ? flag(label, kind) : ""}<div>${esc(rewards)}</div><div class="meta">${esc(when)}${row.timezone ? ` · ${esc(row.timezone)}` : ""}</div>${src ? `<div>${link(src, tx("出处", "Source", "出典"))}</div>` : ""}</li>`;
    })
    .join("");
  return `<h2>${esc(tx("兑换码", "Redeem codes", "引き換えコード"))}</h2><p class="rule">${esc(tx("只转写已发布出处里的码、奖励和有效期。过期的保持标出。本站不代领。", "Codes, rewards, and windows are copied from published sources. Expired rows stay marked. This site does not redeem them.", "コード、報酬、期限は公開出典の転記だけ。期限切れは残す。このサイトは代行しない。"))}</p><ul>${items}</ul>`;
}

export function renderGame(game, extras = {}) {
  if (!game || !game.id) return renderError(tx("未找到该游戏", "Game not found", "ゲームが見つかりません"));
  const deep = isDeep(game.id);
  const guideIndex = extras.guideIndex;
  const guideError = extras.guideError || "";
  const q = extras.q || "";
  const aliasesById = extras.aliasesById || null;
  let deepBlock = "";
  if (!deep) {
    deepBlock = `<p class="rule">${esc(tx("尚无深耕。这里只保留身份和出处，不写图鉴。", "No guides yet. This page keeps identity and sources only.", "深掘りはまだない。身元と出典だけを残す。"))}</p>`;
  } else if (guideError) {
    deepBlock = `<h2>${esc(tx("角色", "Characters", "キャラクター"))}</h2>${renderError(guideError)}`;
  } else {
    const chars = (guideIndex && guideIndex.characters) || [];
    const filtered = filterCharacters(chars, q, aliasesById);
    const count = guideIndex && guideIndex.character_count != null ? guideIndex.character_count : chars.length;
    const rowHtml = (card) => {
      const name = displayCharacterName(card) || card.id;
      const stub = card.stub === true ? ` ${flag("stub", "stub")}` : "";
      const tone = card.stub === true ? "char-stub" : "char-deep";
      return `<li><a class="char-row ${tone}" href="${esc(characterHref(game.id, card.id))}">${portraitTag(card)}<span><span class="row-title">${esc(name)}</span> <code>${esc(card.id)}</code>${stub}</span></a></li>`;
    };
    const grouped = filtered.some((card) => card.sinner && card.sinner.id);
    const unit = game.id === "limbus-company" ? tx("人格", "Identities", "人格") : tx("角色", "Characters", "キャラクター");
    let listHtml = `<p class="meta">${esc(tx("深耕目录为空", "Guide index is empty", "深掘り目録は空です"))}</p>`;
    if (filtered.length && !grouped) listHtml = `<ul class="char-list">${filtered.map(rowHtml).join("")}</ul>`;
    if (filtered.length && grouped) {
      const groups = new Map();
      for (const card of filtered) {
        const sinner = card.sinner && card.sinner.id ? card.sinner : { id: "", name_zh: "未分组", order: 999 };
        if (!groups.has(sinner.id)) groups.set(sinner.id, { ...sinner, cards: [] });
        groups.get(sinner.id).cards.push(card);
      }
      listHtml = [...groups.values()]
        .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999) || String(a.name_zh || a.id).localeCompare(String(b.name_zh || b.id), "zh"))
        .map((group) => {
          const title = group.id ? displaySinnerName(group) || group.id : tx("未分组", "Ungrouped", "未分類");
          return `<section class="sinner-group"><h3>${esc(title)}${group.id ? ` <code>${esc(group.id)}</code>` : ""}</h3><ul class="char-list">${group.cards.map(rowHtml).join("")}</ul></section>`;
        })
        .join("");
    }
    const groupedNote = grouped
      ? tx("边狱公司以人格为卡，并按罪人分组。", "Limbus Company cards are identities, grouped by sinner.", "Limbus Company のカードは人格で、罪人ごとに分かれる。")
      : "";
    deepBlock = `<h2>${esc(unit)}</h2>
<p class="rule">${tx(
      `图鉴只对观察名单里已深耕的游戏开放。角色卡来自 <code>/v1/guides/${esc(game.id)}/</code>，页内是结论、技能养成、配队、出处、立绘。`,
      `Guides are only open for watchlist games that already have them. Cards come from <code>/v1/guides/${esc(game.id)}/</code>: conclusion, skills, teams, sources, and portrait.`,
      `図鑑は、すでに深掘りしたウォッチリストのゲームだけ。カードは <code>/v1/guides/${esc(game.id)}/</code> の結論、スキル、編成、出典、立ち絵。`
    )}${groupedNote}</p>
<form id="filters" role="search"><label>${esc(tx(`搜索${unit}`, `Search ${unit}`, `${unit}を検索`))} <input id="q" name="q" type="search" value="${esc(q)}" placeholder="${esc(tx("角色名、别名或 id", "Name, alias, or id", "名前、別名、id"))}" autocomplete="off"/></label></form>
<p class="meta">${esc(tx(`${count} 名，显示 ${filtered.length} 名`, `${count} total, showing ${filtered.length}`, `${count} 名中 ${filtered.length} 名を表示`))}</p>
${listHtml}`;
  }
  const tone = deep ? "sheet sheet-deep" : "sheet sheet-stub";
  const pools = deep ? `${renderBanners(extras.banners)}${renderCodes(extras.codes)}` : "";
  return `<article class="${tone}">${identityFacts(game)}${deepBlock}${pools}${renderGameNews(extras.news, extras.newsError || "")}${jsonLink(`/v1/games/${encodeURIComponent(game.id)}.json`, `/v1/games/${game.id}.json`)}</article>`;
}

export function newsForGame(digest, gameId) {
  const rows = (digest && digest.digests) || [];
  const row = rows.find((item) => item && String(item.game) === String(gameId));
  return row && Array.isArray(row.items) ? row.items : [];
}

function renderGameNews(items, error) {
  const label = tx("该游资讯", "News for this game", "このゲームの情報");
  const head = `<h2>${esc(label)}</h2><p class="rule">${esc(tx("只列出已发布 digest 里这部游戏的标题和出处。", "Only titles and sources already published in the digest for this game.", "公開済み digest にある、このゲームの題と出典だけ。"))}</p>`;
  if (error) return `<section aria-label="${esc(label)}">${head}${renderError(error)}</section>`;
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, 8);
  const html = shown.map(headlineItem).filter(Boolean).join("");
  const more =
    list.length > shown.length
      ? `<p class="meta">${esc(tx(`其余 ${list.length - shown.length} 条见 /v1/digest.json`, `${list.length - shown.length} more in /v1/digest.json`, `残り ${list.length - shown.length} 件は /v1/digest.json`))}</p>`
      : "";
  const body = html ? `<ul class="headlines">${html}</ul>${more}` : `<p class="meta">${esc(tx("暂无已发布资讯。", "No published news.", "公開済みの情報はありません。"))}</p>`;
  return `<section aria-label="${esc(label)}">${head}${body}</section>`;
}

export function renderWatchlist({ watchlist, catalog, guides } = {}) {
  const catalogById = new Map(((catalog && catalog.games) || []).map((game) => [game.id, game]));
  const guideById = new Map(((guides && guides.games) || []).map((game) => [game.id, game]));
  const watchById = new Map(((watchlist && watchlist.games) || []).map((game) => [game.id, game]));
  const ids = WATCH_ORDER.map((row) => row.id);
  for (const game of (watchlist && watchlist.games) || []) {
    if (game && game.id && !ids.includes(game.id)) ids.push(game.id);
  }
  const cards = ids
    .map((id) => {
      const shell = watchMeta(id);
      const fromWatch = watchById.get(id);
      const fromCatalog = catalogById.get(id);
      const guide = guideById.get(id);
      const nameZh = (fromCatalog && fromCatalog.name_zh) || (fromWatch && fromWatch.name_zh) || (shell && shell.name_zh) || id;
      const name = (fromCatalog && fromCatalog.name) || (fromWatch && fromWatch.name) || (shell && shell.name) || "";
      const deep = isDeep(id);
      const marks = [flagWatch()];
      if (fromCatalog && fromCatalog.stub === true) marks.push(flag("stub", "stub"));
      if (!fromWatch) marks.push(flag(tx("观察名单 JSON 未收录", "Missing from watchlist JSON", "ウォッチリスト JSON にない"), "gap"));
      if (!fromCatalog) marks.push(flag(tx("目录索引未收录", "Missing from the catalog index", "目録インデックスにない"), "gap"));
      marks.push(deep ? flagDeep() : flagGap());
      const count = guide && guide.character_count != null ? guide.character_count : null;
      const steam = (fromCatalog && fromCatalog.steam_appid) || (fromWatch && fromWatch.steam_appid);
      const empty = !deep && (count == null || count === 0);
      const thin = !deep && typeof count === "number" && count > 0 ? tx(`身份卡 ${count}，不写强度。`, `${count} identity cards. No strength text.`, `身元カード ${count}。強度は書かない。`) : "";
      const title = displayGameName({ id, name, name_zh: nameZh }) || id;
      const metaBits = getLang() === "zh-CN"
        ? (name && name !== nameZh ? `${name} · ${id}` : id)
        : (nameZh && nameZh !== title ? `${nameZh} · ${id}` : id);
      const emptyNote = empty ? tx("深耕目录为空。", "The guide index is empty.", "深掘り目録は空です。") : thin;
      return `<article class="card ${deep ? "card-deep" : "card-stub"}"><h2>${link(gameHref(id), title)}</h2>
<p class="meta">${esc(metaBits)}</p>
<p class="flags">${marks.join(" ")}</p>
${fromCatalog ? `<p>${esc(tx("平台", "Platform", "プラットフォーム"))} ${chips(fromCatalog.platforms)}</p><p>${esc(tx("标签", "Tags", "タグ"))} ${chips(fromCatalog.tags)}</p>` : ""}
${steam != null && steam !== "" ? `<p class="meta">steam_appid <code>${esc(steam)}</code></p>` : ""}
${deep ? `<p><a href="${esc(gameHref(id))}">${esc(tx("角色列表", "Character list", "キャラ一覧"))}${count != null ? ` · ${esc(count)}` : ""}</a></p>` : `<p class="rule">${esc(tx("尚无深耕。", "No guides yet.", "深掘りはまだない。"))}${esc(emptyNote)}</p>`}
</article>`;
    })
    .join("");
  const meta = watchlist && watchlist.meta;
  return `<h1>${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</h1>
<p class="lede">${esc(tx(
    "地平线行者、NIKKE、棕色尘埃2、重返未来：1999、终末地、边狱公司、绝区零、鸣潮有角色深耕。边狱公司按罪人分组。阿索拉只有身份卡。星原、미래시、LO2 保留空目录。",
    "Horizon Walker, NIKKE, Brown Dust 2, Reverse: 1999, Arknights: Endfield, Limbus Company, Zenless Zone Zero, and Wuthering Waves have character guides. Limbus Company is grouped by sinner. Astrae Oratio is identity-only. Azure Star Origin, 미래시, and Last Origin 2 keep empty directories.",
    "Horizon Walker、NIKKE、Brown Dust 2、Reverse: 1999、Arknights: Endfield、Limbus Company、Zenless Zone Zero、Wuthering Waves に役割ガイドがある。Limbus Company は罪人ごと。Astrae Oratio は身元カードのみ。Azure Star Origin、미래시、Last Origin 2 は空の目録のまま。"
  ))}</p>
${freshnessNote(meta, shanghaiToday())}
${metaLine(meta)}
<div class="stack">${cards}</div>
${jsonLink("/v1/watchlist.json", "/v1/watchlist.json")}`;
}

function ratingLines(ratings) {
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return [];
  const keys = [
    ["combined", tx("综合", "Overall", "総合")],
    ["story", tx("故事", "Story", "ストーリー")],
    ["boss", "Boss"],
    ["pvp", "PvP"],
  ];
  return keys.filter(([key]) => ratings[key]).map(([key, label]) => `${label} ${ratings[key]}`);
}

function hasCostumePull(card) {
  return Array.isArray(card.costume_ratings) && card.costume_ratings.some((row) => row && row.pull);
}

function profileBits(card, summary) {
  const bits = [];
  if (card.rarity) bits.push(tx(`稀有度 ${card.rarity}`, `Rarity ${card.rarity}`, `レア度 ${card.rarity}`));
  if (card.faction) bits.push(tx(`阵营 ${card.faction}`, `Faction ${card.faction}`, `陣営 ${card.faction}`));
  if (card.element) bits.push(tx(`属性 ${card.element}`, `Element ${card.element}`, `属性 ${card.element}`));
  if (card.attack_type) bits.push(tx(`攻击 ${card.attack_type}`, `Attack ${card.attack_type}`, `攻撃 ${card.attack_type}`));
  if (card.burst) bits.push(tx(`爆裂 ${card.burst}`, `Burst ${card.burst}`, `バースト ${card.burst}`));
  if (card.manufacturer) bits.push(tx(`制造商 ${card.manufacturer}`, `Manufacturer ${card.manufacturer}`, `メーカー ${card.manufacturer}`));
  if (card.role && !(summary && summary.position) && card.role !== (summary && summary.tier)) {
    bits.push(tx(`定位 ${card.role}`, `Role ${card.role}`, `役割 ${card.role}`));
  }
  return bits;
}

function portraitTag(card, large) {
  const name = (card && (displayCharacterName(card) || card.id)) || tx("角色", "Character", "キャラクター");
  const src = portraitImgSrc(card && card.portrait);
  const cls = large ? "portrait lg" : "portrait";
  const width = large ? 128 : 48;
  const height = large ? 171 : 48;
  if (!src) {
    return `<span class="${cls} placeholder" role="img" aria-label="${esc(tx(`${name}，无头像`, `${name}, no portrait`, `${name}、画像なし`))}">${esc(tx("无图", "No image", "画像なし"))}</span>`;
  }
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(name)}" width="${width}" height="${height}" loading="lazy" decoding="async"/>`;
}

function renderIdentityFacts(card) {
  const parts = [];
  const sinner = card.sinner && typeof card.sinner === "object" ? card.sinner : null;
  if (sinner && (sinner.id || sinner.name_zh || sinner.name_en)) {
    const label = displaySinnerName(sinner) || sinner.id;
    const src = safeHttpUrl(sinner.source);
    parts.push(
      `<p><span class="k">${esc(tx("罪人", "Sinner", "罪人"))}</span> ${esc(label)}${sinner.id ? ` <code>${esc(sinner.id)}</code>` : ""}${src ? ` ${link(src, tx("罪人出处", "Sinner source", "罪人の出典"))}` : ""}</p>`
    );
  }
  if (Array.isArray(card.sin_affinities) && card.sin_affinities.length) {
    const line = card.sin_affinities
      .map((row) => `${row.sin || ""}${row.count != null ? ` ×${row.count}` : ""}`.trim())
      .filter(Boolean)
      .join(" · ");
    if (line) parts.push(`<p><span class="k">${esc(tx("罪孽属性", "Sin affinities", "罪の属性"))}</span> ${esc(line)}</p>`);
  }
  const combat = card.combat && typeof card.combat === "object" && !Array.isArray(card.combat) ? card.combat : null;
  if (combat) {
    const bits = [];
    if (combat.level) bits.push(`Lv${combat.level}`);
    if (combat.max_hp) bits.push(`HP ${combat.max_hp}`);
    if (combat.speed) bits.push(tx(`速度 ${combat.speed}`, `Speed ${combat.speed}`, `速度 ${combat.speed}`));
    if (combat.defense) bits.push(tx(`防御 ${combat.defense}`, `Defense ${combat.defense}`, `防御 ${combat.defense}`));
    const res = combat.resistances && typeof combat.resistances === "object" ? combat.resistances : null;
    if (res) {
      const labels = [
        ["slash", tx("斩", "Slash", "斬")],
        ["pierce", tx("突", "Pierce", "突")],
        ["blunt", tx("打", "Blunt", "打")],
      ];
      const shown = labels.filter(([key]) => res[key]).map(([key, label]) => `${label} ${res[key]}`);
      if (shown.length) bits.push(shown.join(" / "));
    }
    if (bits.length) parts.push(`<p><span class="k">${esc(tx("面板", "Stats", "ステータス"))}</span> ${esc(bits.join(" · "))}</p>`);
  }
  return parts.join("");
}

function portraitCite(card) {
  const src = portraitImgSrc(card && card.portrait);
  if (!src) return `<p class="gap">${esc(tx(`头像：${GAP}`, "Portrait: no reliable source", "立ち絵：信頼できる出典がない"))}</p>`;
  const source = safeHttpUrl(card.portrait_source);
  if (!source) return `<p class="gap">${esc(tx(`头像：${GAP}`, "Portrait: no reliable source", "立ち絵：信頼できる出典がない"))}</p>`;
  const label = card.portrait_via ? String(card.portrait_via) : source;
  return `<p class="meta">${esc(tx("头像出处", "Portrait source", "立ち絵の出典"))} ${link(source, label)}</p>`;
}

function renderStrength(card) {
  const summary = card.summary && typeof card.summary === "object" ? card.summary : null;
  const grades = ratingLines(card.ratings);
  const parts = [];
  if (summary && summary.stub === true) parts.push(`<p class="flags">${flag("summary.stub", "stub")}</p>`);
  const tierLabel = tx("强度", "Strength", "強度");
  const pullLabel = tx("抽取建议", "Pull note", "引くかどうか");
  if (summary && summary.tier) parts.push(`<p><span class="k">${esc(tierLabel)}</span> ${esc(summary.tier)}</p>`);
  else if (grades.length) parts.push(`<p><span class="k">${esc(tierLabel)}</span> ${esc(grades.join(" / "))}</p>`);
  else parts.push(`<p class="gap"><span class="k">${esc(tierLabel)}</span> ${esc(gapChrome())}</p>`);
  if (card.ratings && safeHttpUrl(card.ratings.url) && grades.length) {
    parts.push(`<p class="meta">${esc(tx("梯度出处", "Tier source", "評価の出典"))} ${link(card.ratings.url, card.ratings.url)}</p>`);
  }
  if (summary && summary.position) parts.push(`<p><span class="k">${esc(tx("定位", "Position", "役割"))}</span> ${esc(summary.position)}</p>`);
  const profile = profileBits(card, summary);
  if (profile.length) parts.push(`<p><span class="k">${esc(tx("档案", "Profile", "プロフィール"))}</span> ${esc(profile.join(" · "))}</p>`);
  if (summary && summary.pull) parts.push(`<p><span class="k">${esc(pullLabel)}</span> ${esc(summary.pull)}</p>`);
  else if (!hasCostumePull(card)) parts.push(`<p class="gap"><span class="k">${esc(pullLabel)}</span> ${esc(gapChrome())}</p>`);
  if (summary && summary.skip) parts.push(`<p><span class="k">${esc(tx("不追", "Skip", "追わない"))}</span> ${esc(summary.skip)}</p>`);
  if (summary && summary.caveat) parts.push(`<p class="caveat">${esc(summary.caveat)}</p>`);
  return parts.join("");
}

function renderCostumes(card) {
  const costumes = Array.isArray(card.costumes) ? card.costumes : [];
  const ratings = Array.isArray(card.costume_ratings) ? card.costume_ratings : [];
  if (!costumes.length && !ratings.length) return `<p class="gap">${esc(gapChrome())}</p>`;
  const byLabel = new Map();
  for (const rating of ratings) {
    if (rating && rating.label) byLabel.set(rating.label, rating);
  }
  const seen = new Set();
  const rows = [];
  const push = (name, costume, rating) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const bits = [`<strong>${esc(name)}</strong>`];
    if (costume && costume.type) bits.push(`<span class="tag">${esc(costume.type)}</span>`);
    if (costume && costume.skill) bits.push(`<span class="meta">${esc(tx("技能", "Skill", "スキル"))} ${esc(costume.skill)}</span>`);
    if (rating && rating.tier) bits.push(flag(rating.tier, "deep"));
    if (rating && rating.pull) bits.push(`<span>${esc(tx("抽取建议：", "Pull note: ", "引くかどうか："))}${esc(rating.pull)}</span>`);
    if (rating && safeHttpUrl(rating.source)) bits.push(link(rating.source, tx("出处", "Source", "出典")));
    rows.push(`<li>${bits.join(" ")}</li>`);
  };
  for (const costume of costumes) {
    const name = costume && (costume.name || costume.label);
    push(name, costume, name ? byLabel.get(name) : null);
  }
  for (const rating of ratings) push(rating && rating.label, null, rating);
  return rows.length ? `<ul class="costumes">${rows.join("")}</ul>` : `<p class="gap">${esc(gapChrome())}</p>`;
}

function renderSkills(card) {
  const skills = Array.isArray(card.skills) ? card.skills : [];
  const prio =
    Array.isArray(card.skill_prio) && card.skill_prio.length
      ? `<h3>${esc(tx("加点", "Priority", "優先度"))}</h3><ol>${card.skill_prio.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>`
      : "";
  if (!skills.length) return `<p class="gap">${esc(tx(`技能：${GAP}`, "Skills: no reliable source", "スキル：信頼できる出典がない"))}</p>${prio}`;
  const items = skills
    .map((skill) => {
      const name = skill && skill.name ? skill.name : tx("未命名", "Untitled", "無題");
      const bits = [];
      if (skill && skill.type) bits.push(`<code>${esc(skill.type)}</code>`);
      if (skill && skill.costume) bits.push(`<span class="tag">${esc(skill.costume)}</span>`);
      const summary =
        skill && skill.summary
          ? `<p>${esc(skill.summary)}</p>`
          : `<p class="gap">${esc(tx(`摘要：${GAP}`, "Summary: no reliable source", "要約：信頼できる出典がない"))}</p>`;
      return `<li><strong>${esc(name)}</strong> ${bits.join(" ")}${summary}</li>`;
    })
    .join("");
  let extra = prio;
  const talent = card.talent && typeof card.talent === "object" ? card.talent : null;
  const talentName = talent && talent.name;
  const already = skills.some((skill) => skill && skill.name === talentName);
  if (talentName && !already) {
    extra += `<h3>${esc(tx("天赋", "Talent", "天賦"))}</h3><p><strong>${esc(talentName)}</strong></p>${
      talent.summary ? `<p>${esc(talent.summary)}</p>` : `<p class="gap">${esc(tx(`摘要：${GAP}`, "Summary: no reliable source", "要約：信頼できる出典がない"))}</p>`
    }`;
  }
  return `<ul class="skills">${items}</ul>${extra}`;
}

function renderTeams(card) {
  const lines = teamLines(card);
  const heading = esc(tx("配队", "Teams", "編成"));
  if (!lines.length) return `<section><h2>${heading}</h2><p class="gap">${esc(gapChrome())}</p></section>`;
  return `<section><h2>${heading}</h2><ul>${lines
    .map((row) => `<li><span class="k">${esc(row.label)}</span> ${esc(row.text)}</li>`)
    .join("")}</ul></section>`;
}

function renderStigmata(stigmata) {
  if (!stigmata || typeof stigmata !== "object" || Array.isArray(stigmata)) return "";
  const parts = [];
  if (stigmata.set_name) parts.push(`<p><span class="k">${esc(tx("套装", "Set", "セット"))}</span> ${esc(stigmata.set_name)}</p>`);
  if (stigmata.nickname) parts.push(`<p><span class="k">${esc(tx("别名", "Alias", "別名"))}</span> ${esc(stigmata.nickname)}</p>`);
  if (stigmata.pieces != null && stigmata.pieces !== "") {
    parts.push(`<p><span class="k">${esc(tx("件数", "Pieces", "個数"))}</span> ${esc(stigmata.pieces)}</p>`);
  }
  if (Array.isArray(stigmata.notes) && stigmata.notes.length) {
    parts.push(`<ul>${stigmata.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>`);
  }
  if (!parts.length) return "";
  return `<section><h2>${esc(tx("圣痕", "Stigmata", "聖痕"))}</h2>${parts.join("")}</section>`;
}

function collectCardSources(card) {
  const items = normalizeSources(card.sources);
  const seen = new Set(items.map((item) => item.url));
  const add = (url, label) => {
    const href = safeHttpUrl(url);
    if (!href || seen.has(href)) return;
    seen.add(href);
    items.push({ url: href, label: label || href });
  };
  if (card.summary && Array.isArray(card.summary.sources)) {
    for (const url of card.summary.sources) add(url, url);
  }
  if (Array.isArray(card.costume_ratings)) {
    for (const rating of card.costume_ratings) {
      if (rating && rating.source) add(rating.source, rating.label ? `${rating.label} 出处` : rating.source);
    }
  }
  if (card.ratings && card.ratings.url) add(card.ratings.url, "梯度出处");
  return items;
}

export function renderCharacter(gameId, card, opts = {}) {
  const id = safeId(gameId) || String(gameId || "");
  const known = watchMeta(id);
  const gameLabel = known ? displayGameName(known) || id : id;
  if (!isDeep(id)) {
    const requested = safeId(opts.id);
    const gap = tx("尚无深耕", "No guides yet", "深掘りなし");
    return `<article class="sheet sheet-stub"><p class="crumbs">${link("/watchlist/", tx("观察名单", "Watchlist", "ウォッチリスト"))} / ${link(gameHref(id), gameLabel)}</p>
${depthBanner("stub", gap)}
<h1>${esc(gap)}</h1>
<p class="rule">${esc(tx(`角色深耕只开放给${deepNames()}。`, `Character guides are only open for ${deepNames()}.`, `役割ガイドがあるのは ${deepNames()} だけ。`))}</p>
<p class="flags">${flag(gap, "gap")}</p>
${requested ? `<p class="follow-row">${followButton("char", id, requested)}</p>` : ""}</article>`;
  }
  if (!card || typeof card !== "object") return renderError(tx("未找到角色卡", "Character card not found", "キャラカードが見つかりません"));
  if (card.game && card.game !== id) {
    return `<h1>${esc(tx("卡面不一致", "Card does not match", "カードが一致しない"))}</h1><p class="gap">${esc(tx(
      `角色卡 game 为 ${card.game}，地址是 ${id}。不展示这份卡。`,
      `The card game is ${card.game} and the address is ${id}. This card is not shown.`,
      `カードの game は ${card.game}、アドレスは ${id}。このカードは出さない。`
    ))}</p>`;
  }
  const name = displayCharacterName(card) || tx("未命名", "Untitled", "無題");
  const stored = [card.name_en, card.name, card.name_zh, card.name_ja]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, all) => value && value !== name && all.indexOf(value) === index);
  const en = getLang() === "zh-CN" ? (card.name_en && card.name_en !== name ? card.name_en : "") : stored.join(" · ");
  const nick = Array.isArray(card.nicknames) && card.nicknames.length ? card.nicknames.join("、") : "";
  const depth = characterDepth(card);
  const depthLabel = depth === "deep"
    ? tx("深耕", "Guides", "深掘り")
    : depth === "partial"
      ? tx("结论未完成", "Conclusion incomplete", "結論は未完")
      : "stub";
  const marks = [];
  if (card.stub === true) marks.push(flag("stub", "stub"));
  const sources = collectCardSources(card);
  const weapon = typeof card.weapon === "string" && card.weapon.trim() ? card.weapon : "";
  const depthNote =
    depth === "deep"
      ? tx(
          "深耕卡。结论、技能养成、配队、出处、立绘都只来自这张已发布 JSON。",
          "Guide card. Conclusion, skills, teams, sources, and portrait come only from this published JSON.",
          "深掘りカード。結論、スキル、編成、出典、立ち絵は、この公開 JSON だけ。"
        )
      : depth === "partial"
        ? tx(
            "结论未完成（summary.stub）。其余栏只显示卡上已有字段，不补评分或价格。",
            "Conclusion incomplete (summary.stub). Other fields show only what is on the card. No scores or prices are added.",
            "結論は未完（summary.stub）。他の欄はカードにある項目だけ。点数や価格は足さない。"
          )
        : tx(
            "stub 身份卡。只显示卡上已有字段，不补强度、价格或档位。",
            "Stub identity card. Only fields already on the card are shown. Strength, price, and tier are not added.",
            "stub の身元カード。カードにある項目だけ。強度、価格、段階は足さない。"
          );
  return `<article class="sheet sheet-${depth}"><p class="crumbs">${link("/watchlist/", tx("观察名单", "Watchlist", "ウォッチリスト"))} / ${link(gameHref(id), gameLabel)} / ${esc(name)}</p>
${depthBanner(depth, depthLabel)}
<div class="char-head"><figure class="art"><figcaption>${esc(tx("立绘", "Portrait", "立ち絵"))}</figcaption>${portraitTag(card, true)}</figure><div>
<h1>${esc(name)} <code>${esc(card.id || "")}</code></h1>
${card.id ? `<p class="follow-row">${followButton("char", id, card.id)} <a class="action compare-add" href="${esc(compareAddHref(id, card.id))}">${esc(tx("加入对比", "Add to compare", "比較に入れる"))}</a></p>` : ""}
${marks.length ? `<p class="flags">${marks.join(" ")}</p>` : ""}
<p class="rule">${esc(depthNote)}</p>
<p class="meta">${esc([en, nick ? tx(`别名 ${nick}`, `Aliases ${nick}`, `別名 ${nick}`) : "", card.as_of ? `as_of ${card.as_of}` : ""].filter(Boolean).join(" · "))}</p>
${card.verified ? `<p class="meta">${esc(tx("核对：", "Checked: ", "照合："))}${esc(card.verified)}</p>` : ""}
${portraitCite(card)}
${renderIdentityFacts(card)}
</div></div>
${gapBanner(card)}
<section><h2>${esc(tx("结论", "Conclusion", "結論"))}</h2>${renderStrength(card)}</section>
${typeof card.review === "string" && card.review.trim() ? `<section><h2>${esc(tx("评述", "Review", "評述"))}</h2><p>${esc(card.review)}</p></section>` : ""}
<section><h2>${esc(tx("服装", "Costumes", "衣装"))}</h2>${renderCostumes(card)}</section>
<section><h2>${esc(tx("技能养成", "Skills", "スキル"))}</h2>${renderSkills(card)}</section>
${renderTeams(card)}
${renderStigmata(card.stigmata)}
${weapon ? `<section><h2>${esc(tx("武器", "Weapon", "武器"))}</h2><p>${esc(weapon)}</p></section>` : ""}
<section><h2>${esc(tx("出处", "Sources", "出典"))}</h2>${
    sources.length
      ? `<ul class="sources">${sources.map((item) => `<li>${link(item.url, item.label || item.url)}</li>`).join("")}</ul>`
      : `<p class="gap">${esc(sourceGap())}</p>`
  }</section>
${card.id ? jsonLink(`/v1/guides/${encodeURIComponent(id)}/characters/${encodeURIComponent(card.id)}.json`, `/v1/guides/${id}/characters/${card.id}.json`) : ""}</article>`;
}

function personalBannerItem(row) {
  const marks = (row.matched || [])
    .map((item) => flag(item.mark === "rerun" ? tx(`复刻 ${item.name}`, `Rerun ${item.name}`, `復刻 ${item.name}`) : `UP ${item.name}`, item.mark === "rerun" ? "wl" : "deep"))
    .join(" ");
  const status = bannerStatus(row.status);
  const when = [row.start_text || row.start, row.end_text || row.end].filter(Boolean).join(" → ");
  const src = safeHttpUrl(row.source);
  const ups = Array.isArray(row.up) ? row.up.join("、") : "";
  return `<li><strong>${esc(row.name || row.id || tx("卡池", "Banner", "ガチャ"))}</strong> ${status ? flag(status, row.status === "current" ? "deep" : "gap") : ""} ${marks}<div class="meta">${esc(ups)}</div><div class="meta">${esc(when)}${row.timezone ? ` · ${esc(row.timezone)}` : ""}</div>${src ? `<div>${link(src, tx("出处", "Source", "出典"))}</div>` : ""}</li>`;
}

function personalCodeItem(row) {
  const bits = [];
  if ((row.marks || []).includes("new")) bits.push(flag(tx("新码", "New code", "新しいコード"), "deep"));
  if ((row.marks || []).includes("expiring")) {
    const left = row.days_left === 0
      ? tx("今天到期", "Expires today", "本日期限")
      : tx(`还有 ${row.days_left} 天`, `${row.days_left} days left`, `あと ${row.days_left} 日`);
    bits.push(flag(left, "stub"));
  }
  if ((row.marks || []).includes("expired")) bits.push(flag(tx("已过期", "Expired", "期限切れ"), "gap"));
  const label = codeStatus(row.status);
  if (label && !bits.length) bits.push(flag(label, row.status === "expired" ? "gap" : "wl"));
  const src = safeHttpUrl(row.source);
  const when = row.expires_text || row.expires || "";
  return `<li><code>${esc(row.code || "")}</code> ${bits.join(" ")}<div>${esc(row.rewards || tx("出处未写奖励", "Source does not list rewards", "出典に報酬の記載なし"))}</div><div class="meta">${esc(row.game || "")}${when ? ` · ${esc(when)}` : ""}</div>${src ? `<div>${link(src, tx("出处", "Source", "出典"))}</div>` : ""}</li>`;
}

export function renderMe(doc, opts = {}) {
  if (!doc || doc.ok === false) return renderError(opts.message || tx("无法整理关注列表", "Could not build the follow list", "フォローをまとめられません"));
  const follows = doc.follows || { games: [], chars: [] };
  const labels = doc.labels || { games: {}, chars: {} };
  const share = doc.share || {};
  const highlights = doc.highlights || {};
  const bannerHits = highlights.banners || [];
  const fresh = highlights.codes_new || [];
  const expiring = highlights.codes_expiring || [];
  const games = (follows.games || [])
    .map((id) => {
      const gid = safeId(id);
      if (!gid) return "";
      return `<li>${link(gameHref(gid), (labels.games && labels.games[gid]) || gid)} <code>${esc(gid)}</code> ${followButton("game", gid, "", true)}</li>`;
    })
    .filter(Boolean)
    .join("");
  const loose = [];
  const sinnerGroups = new Map();
  for (const row of follows.chars || []) {
    const gid = safeId(row && row.game);
    const cid = safeId(row && row.id);
    if (!gid || !cid) continue;
    const key = `${gid}:${cid}`;
    const name = (labels.chars && labels.chars[key]) || cid;
    const li = `<li>${link(characterHref(gid, cid), name)} <code>${esc(key)}</code> ${followButton("char", gid, cid, true)} <button type="button" class="action" data-planner-add="${esc(key)}" data-planner-name="${esc(name)}">${esc(tx("加入规划", "Add to planner", "計画に入れる"))}</button></li>`;
    const sinner = labels.char_sinner && labels.char_sinner[key];
    if (sinner && sinner.id) {
      if (!sinnerGroups.has(sinner.id)) sinnerGroups.set(sinner.id, { ...sinner, items: [] });
      sinnerGroups.get(sinner.id).items.push(li);
    } else loose.push(li);
  }
  const chars = loose.join("");
  const sinnerHtml = [...sinnerGroups.values()]
    .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999) || String(a.name_zh || a.id).localeCompare(String(b.name_zh || b.id), "zh"))
    .map((group) => `<h3>${esc(displaySinnerName(group) || group.name_zh || group.id)} <code>${esc(group.id)}</code></h3><ul class="follow-list">${group.items.join("")}</ul>`)
    .join("");
  const listHtml = games || chars || sinnerHtml
    ? `${games ? `<h2>${esc(tx("游戏", "Games", "ゲーム"))}</h2><ul class="follow-list">${games}</ul>` : ""}${chars || sinnerHtml ? `<h2>${esc(tx("角色", "Characters", "キャラクター"))}</h2>${chars ? `<ul class="follow-list">${chars}</ul>` : ""}${sinnerHtml}` : ""}`
    : `<p class="meta">${esc(tx("还没有关注。打开游戏页或角色卡，点「关注」。", "Nothing followed yet. Open a game or character and choose Follow.", "まだフォローがありません。ゲームかキャラを開いてフォローしてください。"))}</p>`;
  const bannerHtml = bannerHits.length
    ? `<ul>${bannerHits.map(personalBannerItem).join("")}</ul>`
    : `<p class="meta">没有对上的 UP 或复刻。</p>`;
  const freshHtml = fresh.length
    ? `<ul>${fresh.map(personalCodeItem).join("")}</ul>`
    : `<p class="meta">没有落在近 45 天内的新码。</p>`;
  const expiringHtml = expiring.length
    ? `<ul>${expiring.map(personalCodeItem).join("")}</ul>`
    : `<p class="meta">没有 21 天内到期的码。</p>`;
  const feedItems = (doc.feed && doc.feed.items) || [];
  const feedHtml = feedItems.length
    ? `<ul class="headlines">${feedItems.slice(0, 20).map(headlineItem).filter(Boolean).join("")}</ul>`
    : `<p class="meta">没有对上的情报条目。</p>`;
  const digestRows = (doc.digest && doc.digest.digests) || [];
  const digestHtml = digestRows.length
    ? digestRows
        .map((row) => {
          const id = safeId(row.game);
          const name = row.name_zh || row.name || row.game;
          const title = id ? link(gameHref(id), name) : esc(name);
          const items = (row.items || []).slice(0, 8).map(headlineItem).filter(Boolean).join("");
          return `<article class="card"><h3>${title} <span class="meta">${esc(id || row.game || "")} · ${esc(row.count != null ? row.count : (row.items || []).length)} 条</span></h3>${items ? `<ul class="headlines">${items}</ul>` : `<p class="meta">暂无条目。</p>`}</article>`;
        })
        .join("")
    : `<p class="meta">没有对上的摘要。</p>`;
  const poolHtml = (doc.banners || []).length
    ? `<ul>${doc.banners.map(personalBannerItem).join("")}</ul>`
    : `<p class="meta">没有已发布卡池。</p>`;
  const liveCodes = (doc.codes || []).filter((row) => !(row.marks || []).includes("expired"));
  const oldCodes = (doc.codes || []).filter((row) => (row.marks || []).includes("expired"));
  const codeHtml = liveCodes.length ? `<ul>${liveCodes.map(personalCodeItem).join("")}</ul>` : `<p class="meta">没有未过期的码。</p>`;
  const oldHtml = oldCodes.length
    ? `<details class="expired"><summary>已过期的码（${oldCodes.length}）</summary><ul>${oldCodes.map(personalCodeItem).join("")}</ul></details>`
    : "";
  const missing = (doc.meta && doc.meta.missing) || [];
  const missingHtml = missing.length ? `<p class="gap">这些已发布文件没有读到：${esc(missing.join("、"))}</p>` : "";
  const note = opts.note ? `<p class="meta" id="follow-status" role="status">${esc(opts.note)}</p>` : `<p class="meta" id="follow-status" role="status"></p>`;
  const query = share.query || "";
  const page = localizePath(share.page || "/me/");
  const atom = share.atom || "/v1/personal.atom";
  const api = query ? `/v1/personal?${query}` : "/v1/personal";
  return `<h1>${esc(tx("我的关注", "Following", "フォロー"))}</h1>
<p class="lede">${esc(tx("按这台浏览器里的关注列表，过滤已发布的 feed、digest、卡池和兑换码。不建账号，名单不上传。", "Filters the published feed, digest, banners, and codes by the follow list in this browser. No account. The list is not uploaded.", "このブラウザのフォローで、公開済みの feed、digest、ガチャ、コードを絞る。アカウントなし。リストは送らない。"))}</p>
<p><a href="${esc(localizePath("/planner/"))}">${esc(tx("打开抽卡规划", "Open the pull planner", "ガチャ計画を開く"))}</a> <button type="button" class="action" data-planner-action="add-follows">${esc(tx("把关注的角色加入规划", "Add followed characters to the planner", "フォロー中のキャラを計画に入れる"))}</button></p>
${opts.imported ? `<p class="meta">${esc(tx("已从链接导入。之后只改这台浏览器里的名单。", "Imported from the link. Later edits stay in this browser.", "リンクから読み込んだ。以降の変更はこのブラウザだけ。"))}</p>` : ""}
${note}
${listHtml}
<form id="follow-import">
<label>${esc(tx("导入订阅码或链接", "Import a code or link", "購読コードかリンクを読み込む"))} <input id="follow-code" name="code" type="text" autocomplete="off" placeholder="${esc(tx("gi1.… 或 /me/?games=nikke&chars=nikke:modernia", "gi1.… or /me/?games=nikke&chars=nikke:modernia", "gi1.… または /me/?games=nikke&chars=nikke:modernia"))}"/></label>
<label>${esc(tx("分享链接", "Share link", "共有リンク"))} <input id="share-url" readonly value="${esc(page)}"/></label>
<label>${esc(tx("订阅码", "Share code", "購読コード"))} <input id="share-code" readonly value="${esc(share.code || "")}"/></label>
<div class="follow-actions">
<button type="submit" class="action">${esc(tx("导入", "Import", "読み込む"))}</button>
<button type="button" class="action" data-follow-action="copy-url">${esc(tx("复制链接", "Copy link", "リンクをコピー"))}</button>
<button type="button" class="action" data-follow-action="copy-code">${esc(tx("复制订阅码", "Copy code", "コードをコピー"))}</button>
<button type="button" class="action" data-follow-action="clear">${esc(tx("清空关注", "Clear follows", "フォローを消す"))}</button>
</div>
</form>
<p class="rule">UP / 复刻只来自 <code>banners.json</code> 的 <code>up_characters</code>。新码看 ISO 起始日是否落在近 45 天。即将过期看 ISO 截止日是否落在 21 天内。过期的保持标出。本站不代领。</p>
${missingHtml}
<section aria-labelledby="focus-h"><h2 id="focus-h">${esc(tx("重点", "Highlights", "注目"))}</h2>
<h3>${esc(tx("关注角色的 UP / 复刻", "Followed characters on rate-up or rerun", "フォロー中キャラのピックアップ / 復刻"))}</h3>${bannerHtml}
<h3>${esc(tx("新兑换码", "New codes", "新しいコード"))}</h3>${freshHtml}
<h3>${esc(tx("即将过期", "Expiring soon", "まもなく期限"))}</h3>${expiringHtml}
</section>
<section aria-labelledby="feed-h"><h2 id="feed-h">${esc(tx("情报", "Intel", "情報"))}</h2><p class="rule">${esc(tx("关注整部游戏时保留该游条目。只关注角色时，标题或摘要要出现已发布的名字或别名。", "A followed game keeps that game's items. A character follow keeps items whose title or summary contains a published name or alias.", "ゲームをフォローするとその項目を残す。キャラだけのときは、題か要約に公開済みの名前か別名があるもの。"))}</p>${feedHtml}</section>
<section aria-labelledby="digest-h"><h2 id="digest-h">${esc(tx("摘要", "Brief", "摘要"))}</h2><div class="digest-list">${digestHtml}</div></section>
<section aria-labelledby="pool-h"><h2 id="pool-h">${esc(tx("卡池", "Banners", "ガチャ"))}</h2>${poolHtml}</section>
<section aria-labelledby="code-h"><h2 id="code-h">${esc(tx("兑换码", "Redeem codes", "引き換えコード"))}</h2>${codeHtml}${oldHtml}</section>
<p class="meta">Atom：${link(atom, atom)}</p>
${jsonLink(api, "/v1/personal")}`;
}

export function renderForAi() {
  if (getLang() !== "zh-CN") return renderForAiIntl();
  return `<h1>给 AI</h1>
<p class="lede">人和 AI 读同一份已发布数据。本页只说明入口，不另开写卡接口。</p>
<h2>双入口</h2>
<ul class="plain">
<li>人：网页专区。首页（今日情报）→ 目录或观察名单 → 游戏页（身份、深耕入口、该游资讯）→ 角色卡。核对墙单列。</li>
<li>AI：MCP <code>/mcp</code> 与 JSON <code>/v1</code>。发现文档是 <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>，与 <a href="/.well-known/ai-catalog.json">/.well-known/ai-catalog.json</a> 相同。</li>
</ul>
<h2>入口</h2>
<dl class="facts">
<dt>开发者</dt><dd><a href="/developers/"><code>/developers/</code></a> 中英说明：端点、curl、MCP 接入、出处和署名。</dd>
<dt>MCP</dt><dd>连接 <code>/mcp</code>（Streamable HTTP，只读已发布 JSON）。<br/>托管站 <code>${PUBLIC_SITE}/mcp</code></dd>
<dt>OpenAPI</dt><dd><a href="/v1/openapi.json"><code>/v1/openapi.json</code></a>（<a href="/openapi.json"><code>/openapi.json</code></a> 同一份）</dd>
<dt>llms.txt</dt><dd><a href="/llms.txt"><code>/llms.txt</code></a></dd>
</dl>
<h2>写卡统一框架</h2>
<p>字段跟现有 <a href="/schema/character-card.schema.json">character-card schema</a>。非 stub 必填 <code>sources[]</code>（https）和 <code>as_of</code>，缺则拒绝。</p>
<ol class="steps">
<li>填模板</li>
<li>校验</li>
<li>可选审</li>
<li>发布</li>
<li>人读页与 <code>/v1</code> 同步</li>
</ol>
<p>MCP 只读已发布数据。新写走公开投稿口 <a href="/claims/"><code>POST /v1/claims</code></a>（公开，不需要密钥；https <code>sources</code> 必填），或走仓库里的导出管线。不另开私有 MCP 写通道。</p>
<p class="rule">不编造评分、价格、档位。出处外链在人读页上始终可见。深耕图鉴有 ${deepNames()}。CDK 不在本站。</p>
<h2>各页对应的 /v1</h2>
<p>人读页只消费已发布 JSON，不另造第二套库。</p>
<dl class="facts">
<dt>首页</dt><dd><code>/v1/digest.json</code> · <code>/v1/radar.json</code></dd>
<dt>目录</dt><dd><code>/v1/games/index.json</code></dd>
<dt>观察名单</dt><dd><code>/v1/watchlist.json</code> · <code>/v1/games/index.json</code> · <code>/v1/guides/index.json</code></dd>
<dt>我的关注</dt><dd>浏览器 <code>localStorage</code>。分享用 <code>/me/?games=&amp;chars=</code> 或订阅码 <code>gi1.</code>。机器读 <code>GET /v1/personal</code>、<code>/v1/personal.atom</code>，MCP 工具 <code>personal_digest</code>。服务端不保存名单。</dd>
<dt>游戏页</dt><dd><code>/v1/games/{id}.json</code> · <code>/v1/digest.json</code>。深耕再读 <code>/v1/guides/{id}/index.json</code>、别名、<code>banners.json</code> 与 <code>codes.json</code>。</dd>
<dt>角色卡</dt><dd><code>/v1/guides/{game}/characters/{id}.json</code>，深耕八款：${deepNames()}。边狱公司的卡是人格，带 <code>sinner</code>，游戏页和关注列表按罪人分组。</dd>
<dt>核对墙</dt><dd>读 <code>GET /v1/claims.json</code>。写 <code>POST /v1/claims</code>，公开，不需要密钥。</dd>
<dt>给 AI</dt><dd><code>/.well-known/mcp.json</code> · <a href="/developers/"><code>/developers/</code></a> · <a href="/v1/openapi.json"><code>/v1/openapi.json</code></a> · <code>/openapi.json</code> · <code>/llms.txt</code>。数据仍是上面的 <code>/v1</code>。读接口的可选密钥写在开发者页，投稿不使用它。</dd>
<dt>草图</dt><dd><code>/sketches/</code> 不读 JSON。</dd>
</dl>
<p class="meta">线框草图：<a href="/sketches/">首页 / 游戏页 / 角色卡</a></p>`;
}

function renderForAiIntl() {
  const dev = esc(hrefFor("/developers/"));
  const sketches = esc(hrefFor("/sketches/"));
  const claims = esc(hrefFor("/claims/"));
  const en = getLang() === "en";
  const h1 = en ? "For AI" : "AI 向け";
  const lede = en
    ? "People and AI read the same published data. This page only lists the doors. It does not add a private write API."
    : "人と AI は同じ公開データを読む。このページは入口だけ。非公開の書き込み API は足さない。";
  const people = en
    ? "People: the site. Home, catalog or watchlist, game page, character card. Claims are separate."
    : "人：サイト。ホーム、カタログかウォッチリスト、ゲーム、キャラカード。照合は別。";
  const step1 = en ? "Fill the template" : "テンプレートを埋める";
  const step2 = en ? "Validate" : "検証";
  const step3 = en ? "Optional review" : "任意の確認";
  const step4 = en ? "Publish" : "公開";
  const step5 = en ? "The human page and /v1 stay in sync" : "人のページと /v1 を揃える";
  const write = en
    ? `MCP only reads published data. New writing uses the public <a href="${claims}"><code>POST /v1/claims</code></a> (no key; https <code>sources</code> required) or the repo export. There is no private MCP write channel.`
    : `MCP は公開データだけを読む。新しい記述は公開の <a href="${claims}"><code>POST /v1/claims</code></a>（鍵は不要。https の <code>sources</code> が必要）か、リポジトリの書き出し。非公開の MCP 書き込みはない。`;
  return `<h1>${h1}</h1>
<p class="lede">${lede}</p>
<h2>${en ? "Two doors" : "二つの入口"}</h2>
<ul class="plain">
<li>${people}</li>
<li>AI: MCP <code>/mcp</code> and JSON <code>/v1</code>. Discovery is <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>, the same document as <a href="/.well-known/ai-catalog.json">/.well-known/ai-catalog.json</a>.</li>
</ul>
<h2>${en ? "Entrances" : "入口"}</h2>
<dl class="facts">
<dt>${en ? "Developers" : "開発者"}</dt><dd><a href="${dev}"><code>/developers/</code></a></dd>
<dt>MCP</dt><dd><code>/mcp</code><br/><code>${PUBLIC_SITE}/mcp</code></dd>
<dt>OpenAPI</dt><dd><a href="/v1/openapi.json"><code>/v1/openapi.json</code></a> (<a href="/openapi.json"><code>/openapi.json</code></a>)</dd>
<dt>llms.txt</dt><dd><a href="/llms.txt"><code>/llms.txt</code></a></dd>
</dl>
<h2>${en ? "One write path" : "書き込みは一つの経路"}</h2>
<p><a href="/schema/character-card.schema.json">character-card schema</a>. Non-stub cards need https <code>sources[]</code> and <code>as_of</code>.</p>
<ol class="steps">
<li>${step1}</li><li>${step2}</li><li>${step3}</li><li>${step4}</li><li>${step5}</li>
</ol>
<p>${write}</p>
<p class="rule">${en ? "Do not invent scores, prices, or tiers." : "点数、価格、段階は作らない。"} ${deepNames()}</p>
<h2>/v1</h2>
<dl class="facts">
<dt>${en ? "Home" : "ホーム"}</dt><dd><code>/v1/digest.json</code> · <code>/v1/radar.json</code></dd>
<dt>${en ? "Catalog" : "カタログ"}</dt><dd><code>/v1/games/index.json</code></dd>
<dt>${en ? "Watchlist" : "ウォッチリスト"}</dt><dd><code>/v1/watchlist.json</code> · <code>/v1/games/index.json</code> · <code>/v1/guides/index.json</code></dd>
<dt>${en ? "Following" : "フォロー"}</dt><dd><code>localStorage</code>. <code>GET /v1/personal</code>, <code>/v1/personal.atom</code>, MCP <code>personal_digest</code>.</dd>
<dt>${en ? "Game" : "ゲーム"}</dt><dd><code>/v1/games/{id}.json</code> · <code>/v1/digest.json</code></dd>
<dt>${en ? "Character" : "キャラ"}</dt><dd><code>/v1/guides/{game}/characters/{id}.json</code></dd>
<dt>${en ? "Claims" : "照合"}</dt><dd><code>GET /v1/claims.json</code>. <code>POST /v1/claims</code></dd>
<dt>${en ? "For AI" : "AI 向け"}</dt><dd><code>/.well-known/mcp.json</code> · <a href="${dev}"><code>/developers/</code></a> · <code>/openapi.json</code> · <code>/llms.txt</code></dd>
<dt>${en ? "Sketches" : "下絵"}</dt><dd><a href="${sketches}"><code>/sketches/</code></a></dd>
</dl>`;
}

export function renderClaims(mirror = {}) {
  const claims = Array.isArray(mirror && mirror.claims) ? mirror.claims : [];
  const error = mirror && mirror.error ? renderError(mirror.error) : "";
  const rows = claims
    .map((claim) => {
      const items = normalizeSources(claim && claim.sources);
      const sourceHtml = items.length
        ? `<ul class="sources">${items.map((item) => `<li>${link(item.url, item.label || item.url)}</li>`).join("")}</ul>`
        : `<p class="gap">${esc(sourceGap())}</p>`;
      const bits = [
        claim && claim.submitted_at,
        claim && claim.as_of ? `as_of ${claim.as_of}` : "",
        claim && claim.submitter,
        claim && claim.game_id,
        claim && claim.character_id,
      ].filter(Boolean);
      return `<article class="card"><h2>${esc((claim && claim.statement) || "")}</h2>${
        bits.length ? `<p class="meta">${esc(bits.join(" · "))}</p>` : ""
      }${sourceHtml}</article>`;
    })
    .join("");
  const count = mirror && mirror.count != null ? mirror.count : claims.length;
  const empty = error ? "" : `<p>${esc(tx("还没有已接受的核对。", "No accepted claims yet.", "まだ受け付けた照合はありません。"))}</p>`;
  return `<h1>${esc(tx("核对墙", "Claims", "照合"))}</h1>
<p class="lede">${esc(tx("只列出带 https 出处、已进入镜像的断言。这不是论坛，也不是已发布的角色卡。", "Only statements that have an https source and are already in the mirror. Not a forum, and not a published character card.", "https の出典があり、ミラーに入った陳述だけ。掲示板でも、公開済みのキャラカードでもない。"))}</p>
<aside class="notice">
<p>${tx(
    "<strong>公开投稿已开通，不需要密钥。</strong> <code>POST /v1/claims</code> 要求 <code>sources[]</code> 为可核对的 https，缺则拒绝。每条都有 <code>as_of</code>（不填则记上海当日，格式不对则拒绝），并要有 <code>game_id</code>。读取 <a href=\"/v1/claims.json\"><code>/v1/claims.json</code></a>。",
    "<strong>Public submit is open and needs no key.</strong> <code>POST /v1/claims</code> requires https <code>sources[]</code>. Each row has <code>as_of</code> and <code>game_id</code>. Read <a href=\"/v1/claims.json\"><code>/v1/claims.json</code></a>.",
    "<strong>公開投稿は鍵なし。</strong> <code>POST /v1/claims</code> は https の <code>sources[]</code> が必要。各行に <code>as_of</code> と <code>game_id</code>。読むのは <a href=\"/v1/claims.json\"><code>/v1/claims.json</code></a>。"
  )}</p>
<p>${esc(tx(
    "没有审核队列。未经人工核对并经现有导出管线发布之前，这些陈述都不可信，不能当作目录或角色卡里的已发布事实。",
    "There is no review queue. Until a person checks a statement and it is published through the existing export, it is untrusted and is not a catalog or character-card fact.",
    "審査キューはない。人が確認し、既存の書き出しで公開するまで、これらの陳述は信頼できず、目録やキャラカードの事実ではない。"
  ))}</p>
<p>${esc(tx(
    "MCP 只读已发布数据。新写走这个投稿口或现有导出管线，不另开私写。",
    "MCP only reads published data. New writing uses this submit path or the existing export. There is no private write channel.",
    "MCP は公開データだけを読む。新しい記述はこの投稿口か既存の書き出し。非公開の書き込みはない。"
  ))}</p>
</aside>
<p class="meta">${esc(tx(`${count} 条`, `${count} rows`, `${count} 件`))} · ${esc((mirror && mirror.timezone) || "Asia/Shanghai")}</p>
${error}
${rows || empty}`;
}
