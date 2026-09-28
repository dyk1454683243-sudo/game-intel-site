/**
 * Pure HTML renderers for the human UI. No DOM, no invented tiers or pull advice.
 * Non-deep games stay identity-only. Deep character cards are hw / nikke / bd2.
 */

export const DEEP_GAMES = Object.freeze(["hw", "nikke", "bd2"]);

export const WATCH_ORDER = Object.freeze([
  { id: "hw", name: "Horizon Walker", name_zh: "地平线行者" },
  { id: "nikke", name: "NIKKE", name_zh: "胜利女神：NIKKE" },
  { id: "bd2", name: "Brown Dust 2", name_zh: "棕色尘埃2" },
  { id: "star", name: "Azure Star Origin", name_zh: "蓝色星原：旅谣" },
  { id: "asora", name: "Astrae Oratio", name_zh: "阿索拉：星之祈愿" },
  { id: "miraesi", name: "Invisible Future", name_zh: "미래시" },
  { id: "lo2", name: "Last Origin 2", name_zh: "Last Origin 2" },
]);

const NAV = [
  ["home", "/", "首页"],
  ["catalog", "/catalog/", "目录"],
  ["watchlist", "/watchlist/", "关注"],
];

const GAP = "未见可靠出处";

export function isDeep(id) {
  return DEEP_GAMES.includes(String(id || ""));
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
  return `/game/?id=${encodeURIComponent(id)}`;
}

export function characterHref(game, id) {
  return `/character/?game=${encodeURIComponent(game)}&id=${encodeURIComponent(id)}`;
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
    const hay = [card.id, card.name, card.name_zh, ...extra].join("\n").toLowerCase();
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

function link(href, label) {
  const safe = safeHttpUrl(href) || (String(href || "").startsWith("/") ? String(href) : "");
  if (!safe) return esc(label || href || "");
  return `<a href="${esc(safe)}"${safe.startsWith("/") ? "" : ' rel="noopener noreferrer"'}>${esc(label || safe)}</a>`;
}

function chips(values) {
  const list = (values || []).filter((value) => value != null && String(value).trim() !== "");
  if (!list.length) return `<span class="meta">无</span>`;
  return list.map((value) => `<span class="tag">${esc(value)}</span>`).join("");
}

function flag(text, kind) {
  return `<span class="flag ${kind}">${esc(text)}</span>`;
}

function renderNav(active) {
  const links = NAV.map(([id, href, label]) => {
    const current = id === active ? ' aria-current="page"' : "";
    return `<a href="${href}"${current}>${label}</a>`;
  }).join("");
  return `<header class="top"><a class="brand" href="/">game-intel</a><nav aria-label="主导航">${links}</nav></header>`;
}

function renderFooter() {
  return `<footer class="site-foot"><p>目录宽、深耕窄、出处硬</p><p>无登录。CDK 不在本站。</p></footer>`;
}

export function renderFrame(active, body) {
  return `<a class="skip" href="#main">跳到内容</a>${renderNav(active)}<main id="main">${body}</main>${renderFooter()}`;
}

export function renderError(message) {
  return `<p class="error">${esc(message || "加载失败")}</p>`;
}

function freshnessNote(meta, today) {
  if (!meta || typeof meta !== "object") return "";
  const bits = [];
  if (meta.fixture === true) bits.push("fixture：示例数据，不是实时情报");
  const day = shanghaiDayFromStamp(meta.generated_at);
  if (day && today && day !== today) {
    bits.push(`generated_at ${meta.generated_at} 不是上海当日 ${today}`);
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
  return `<p class="meta">JSON：${link(href, label || href)}</p>`;
}

export function renderHome({ digest, radar, digestError = "", radarError = "", today } = {}) {
  const day = today || shanghaiToday();
  const digestBlock = digestError
    ? renderError(digestError)
    : renderDigest(digest, day);
  const radarBlock = radarError ? renderError(radarError) : renderRadar(radar, day);
  return `<h1>今日情报</h1>
<p class="lede">摘要与雷达都读已发布的 <code>/v1</code> JSON，不另写情报。</p>
<section aria-labelledby="digest-h">${digestBlock}</section>
<section aria-labelledby="radar-h">${radarBlock}</section>`;
}

function renderDigest(digest, today) {
  const head = `<h2 id="digest-h">今日摘要</h2>${freshnessNote(digest && digest.meta, today)}${metaLine(digest && digest.meta)}`;
  const rows = (digest && digest.digests) || [];
  if (!rows.length) {
    return `${head}<p class="meta">今日摘要暂无条目。</p>${jsonLink("/v1/digest.json", "/v1/digest.json")}`;
  }
  const ordered = [...rows].sort((a, b) => watchRank(a.game) - watchRank(b.game) || String(a.game).localeCompare(String(b.game)));
  const blocks = ordered
    .map((row) => {
      const id = safeId(row.game);
      const name = row.name || (watchMeta(row.game) || {}).name_zh || row.game || "未命名";
      const title = id ? link(gameHref(id), name) : esc(name);
      const items = Array.isArray(row.items) ? row.items : [];
      const shown = items.slice(0, 8);
      const list = shown.map(headlineItem).filter(Boolean).join("");
      const more =
        items.length > shown.length
          ? `<p class="meta">其余 ${items.length - shown.length} 条见 /v1/digest.json</p>`
          : "";
      const count = Number.isFinite(row.count) ? row.count : items.length;
      return `<article class="card"><h3>${title} <span class="meta">${esc(id || row.game || "")} · ${esc(count)} 条</span></h3>${
        list ? `<ul class="headlines">${list}</ul>` : `<p class="meta">暂无条目。</p>`
      }${more}</article>`;
    })
    .join("");
  return `${head}${blocks}${jsonLink("/v1/digest.json", "/v1/digest.json")}`;
}

function renderRadar(radar, today) {
  const head = `<h2 id="radar-h">雷达</h2><p class="rule">雷达不是第二份目录，只列出 JSON 里已有的标题与出处。</p>${freshnessNote(radar && radar.meta, today)}${metaLine(radar && radar.meta)}`;
  const keywords = (radar && radar.keywords) || [];
  const keywordLine = keywords.length ? `<p>关键词：${chips(keywords)}</p>` : "";
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
    return `${head}${keywordLine}${channelLine}<p class="meta">雷达暂无条目。</p>${jsonLink("/v1/radar.json", "/v1/radar.json")}`;
  }
  const shown = items.slice(0, 20);
  const list = shown.map(headlineItem).filter(Boolean).join("");
  const more =
    items.length > shown.length ? `<p class="meta">其余 ${items.length - shown.length} 条见 /v1/radar.json</p>` : "";
  return `${head}${keywordLine}${channelLine}<ul class="headlines">${list}</ul>${more}${jsonLink("/v1/radar.json", "/v1/radar.json")}`;
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

export function renderCatalog(index, opts = {}) {
  const games = (index && index.games) || [];
  const filtered = filterGames(games, opts);
  const platforms = sortedUnique(games, "platforms");
  const tags = sortedUnique(games, "tags");
  const kind = opts.kind || "all";
  const rows = filtered
    .map((game) => {
      const zh = game.name_zh || game.name || game.id;
      const sub = [game.name && game.name !== zh ? game.name : "", game.id].filter(Boolean).join(" · ");
      const marks = [];
      if (game.watchlist) marks.push(flag("关注", "wl"));
      if (game.stub === true) marks.push(flag("stub", "stub"));
      marks.push(isDeep(game.id) ? flag("已深耕", "deep") : flag("尚无深耕", "gap"));
      return `<li><a class="row" href="${esc(gameHref(game.id))}"><span class="row-title">${esc(zh)}</span><span class="row-sub">${esc(sub)}</span><span class="row-tags">${chips(game.platforms)} ${chips(game.tags)}</span><span class="row-flags">${marks.join(" ")}</span></a></li>`;
    })
    .join("");
  return `<h1>游戏目录</h1>
<p class="lede">共 ${esc(index && index.count != null ? index.count : games.length)} 部。身份卡展示名称、平台、标签、出处和 steam_appid。</p>
<p class="meta">${index && index.as_of ? `as_of ${esc(index.as_of)}` : ""} ${index && index.timezone ? esc(index.timezone) : ""}</p>
<form id="filters" role="search">
<label>搜索 <input id="q" name="q" type="search" value="${esc(opts.q || "")}" placeholder="名称、id、标签" autocomplete="off"/></label>
<label>范围 <select id="kind" name="kind">${option("all", "全部", kind)}${option("watchlist", "关注", kind)}${option("stub", "仅身份", kind)}${option("deep", "已深耕", kind)}</select></label>
<label>平台 <select id="platform" name="platform">${option("", "全部平台", opts.platform)}${platforms.map((value) => option(value, value, opts.platform)).join("")}</select></label>
<label>标签 <select id="tag" name="tag">${option("", "全部标签", opts.tag)}${tags.map((value) => option(value, value, opts.tag)).join("")}</select></label>
</form>
<p class="meta">显示 ${filtered.length} 部</p>
${rows ? `<ul class="rows">${rows}</ul>` : `<p class="meta">没有匹配的游戏。</p>`}
${jsonLink("/v1/games/index.json", "/v1/games/index.json")}`;
}

function identityFacts(game) {
  const zh = game.name_zh || game.name || game.id;
  const en = game.name && game.name !== zh ? game.name : "";
  const steam = game.steam_appid == null || game.steam_appid === "" ? "无" : game.steam_appid;
  const marks = [];
  if (game.watchlist) marks.push(flag("关注", "wl"));
  if (game.stub === true) marks.push(flag("stub", "stub"));
  if (!isDeep(game.id)) marks.push(flag("尚无深耕", "gap"));
  else marks.push(flag("已深耕", "deep"));
  return `<p class="crumbs">${link("/catalog/", "目录")}${game.watchlist ? ` / ${link("/watchlist/", "关注")}` : ""} / ${esc(zh)}</p>
<h1>${esc(zh)} <code>${esc(game.id || "")}</code></h1>
<p class="flags">${marks.join(" ")}</p>
${en ? `<p class="meta">${esc(en)}</p>` : ""}
<dl class="facts">
<dt>平台</dt><dd>${chips(game.platforms)}</dd>
<dt>标签</dt><dd>${chips(game.tags)}</dd>
<dt>steam_appid</dt><dd><code>${esc(steam)}</code></dd>
${game.as_of ? `<dt>as_of</dt><dd>${esc(game.as_of)}${game.timezone ? ` ${esc(game.timezone)}` : ""}</dd>` : ""}
</dl>
<h2>出处</h2>
${renderSourceList(game.sources)}
${game.note ? `<p class="meta">备注：${esc(game.note)}</p>` : ""}
${gapBanner(game)}`;
}

function renderSourceList(sources) {
  const items = normalizeSources(sources);
  if (!items.length) return `<p class="gap">出处：${GAP}</p>`;
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
  return `<aside class="gap-banner"><strong>${GAP}</strong><ul>${sentences.map((sentence) => `<li>${esc(sentence)}</li>`).join("")}</ul></aside>`;
}

export function renderGame(game, extras = {}) {
  if (!game || !game.id) return renderError("未找到该游戏");
  const deep = isDeep(game.id);
  const guideIndex = extras.guideIndex;
  const guideError = extras.guideError || "";
  const q = extras.q || "";
  const aliasesById = extras.aliasesById || null;
  let deepBlock = "";
  if (!deep) {
    deepBlock = `<p class="rule">尚无深耕。这里只保留身份和出处。</p>`;
  } else if (guideError) {
    deepBlock = `<h2>角色</h2>${renderError(guideError)}`;
  } else {
    const chars = (guideIndex && guideIndex.characters) || [];
    const filtered = filterCharacters(chars, q, aliasesById);
    const count = guideIndex && guideIndex.character_count != null ? guideIndex.character_count : chars.length;
    const rows = filtered
      .map((card) => {
        const name = card.name_zh || card.name || card.id;
        const stub = card.stub === true ? ` ${flag("stub", "stub")}` : "";
        return `<li><a href="${esc(characterHref(game.id, card.id))}">${esc(name)}</a> <code>${esc(card.id)}</code>${stub}</li>`;
      })
      .join("");
    deepBlock = `<h2>角色</h2>
<p class="rule">角色卡只来自 <code>/v1/guides/${esc(game.id)}/</code>。强度、服装、技能和出处在角色页。</p>
<form id="filters" role="search"><label>搜索角色 <input id="q" name="q" type="search" value="${esc(q)}" placeholder="角色名、别名或 id" autocomplete="off"/></label></form>
<p class="meta">${esc(count)} 名，显示 ${filtered.length} 名</p>
${rows ? `<ul class="char-list">${rows}</ul>` : `<p class="meta">深耕目录为空</p>`}`;
  }
  return `${identityFacts(game)}${deepBlock}${jsonLink(`/v1/games/${encodeURIComponent(game.id)}.json`, `/v1/games/${game.id}.json`)}`;
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
      const marks = [flag("关注", "wl")];
      if (fromCatalog && fromCatalog.stub === true) marks.push(flag("stub", "stub"));
      if (!fromWatch) marks.push(flag("关注列表 JSON 未收录", "gap"));
      if (!fromCatalog) marks.push(flag("目录索引未收录", "gap"));
      marks.push(deep ? flag("已深耕", "deep") : flag("尚无深耕", "gap"));
      const count = guide && guide.character_count != null ? guide.character_count : null;
      const steam = (fromCatalog && fromCatalog.steam_appid) || (fromWatch && fromWatch.steam_appid);
      const empty = !deep && (count == null || count === 0);
      return `<article class="card"><h2>${link(gameHref(id), nameZh)}</h2>
<p class="meta">${esc(name && name !== nameZh ? `${name} · ${id}` : id)}</p>
<p class="flags">${marks.join(" ")}</p>
${fromCatalog ? `<p>平台 ${chips(fromCatalog.platforms)}</p><p>标签 ${chips(fromCatalog.tags)}</p>` : ""}
${steam != null && steam !== "" ? `<p class="meta">steam_appid <code>${esc(steam)}</code></p>` : ""}
${deep ? `<p><a href="${esc(gameHref(id))}">角色列表${count != null ? ` · ${esc(count)}` : ""}</a></p>` : `<p class="rule">尚无深耕。${empty ? "深耕目录为空。" : ""}</p>`}
</article>`;
    })
    .join("");
  const meta = watchlist && watchlist.meta;
  return `<h1>关注</h1>
<p class="lede">地平线行者、NIKKE、棕色尘埃2有角色深耕。星原、阿索拉、미래시、LO2 保留空目录。</p>
${freshnessNote(meta, shanghaiToday())}
${metaLine(meta)}
<div class="stack">${cards}</div>
${jsonLink("/v1/watchlist.json", "/v1/watchlist.json")}`;
}

function ratingLines(ratings) {
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return [];
  const keys = [
    ["combined", "综合"],
    ["story", "故事"],
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
  if (card.rarity) bits.push(`稀有度 ${card.rarity}`);
  if (card.element) bits.push(`属性 ${card.element}`);
  if (card.attack_type) bits.push(`攻击 ${card.attack_type}`);
  if (card.burst) bits.push(`爆裂 ${card.burst}`);
  if (card.manufacturer) bits.push(`制造商 ${card.manufacturer}`);
  if (card.role && !(summary && summary.position) && card.role !== (summary && summary.tier)) {
    bits.push(`定位 ${card.role}`);
  }
  return bits;
}

function renderStrength(card) {
  const summary = card.summary && typeof card.summary === "object" ? card.summary : null;
  const grades = ratingLines(card.ratings);
  const parts = [];
  if (summary && summary.stub === true) parts.push(`<p class="flags">${flag("summary.stub", "stub")}</p>`);
  if (summary && summary.tier) parts.push(`<p><span class="k">强度</span> ${esc(summary.tier)}</p>`);
  else if (grades.length) parts.push(`<p><span class="k">强度</span> ${esc(grades.join(" / "))}</p>`);
  else parts.push(`<p class="gap"><span class="k">强度</span> ${GAP}</p>`);
  if (grades.length && summary && summary.tier) {
    parts.push(`<p><span class="k">分项</span> ${esc(grades.join(" / "))}</p>`);
  }
  if (card.ratings && safeHttpUrl(card.ratings.url) && grades.length) {
    parts.push(`<p class="meta">梯度出处 ${link(card.ratings.url, card.ratings.url)}</p>`);
  }
  if (summary && summary.position) parts.push(`<p><span class="k">定位</span> ${esc(summary.position)}</p>`);
  const profile = profileBits(card, summary);
  if (profile.length) parts.push(`<p><span class="k">档案</span> ${esc(profile.join(" · "))}</p>`);
  if (summary && summary.pull) parts.push(`<p><span class="k">抽取建议</span> ${esc(summary.pull)}</p>`);
  else if (!hasCostumePull(card)) parts.push(`<p class="gap"><span class="k">抽取建议</span> ${GAP}</p>`);
  if (summary && summary.skip) parts.push(`<p><span class="k">不追</span> ${esc(summary.skip)}</p>`);
  if (summary && summary.caveat) parts.push(`<p class="caveat">${esc(summary.caveat)}</p>`);
  return parts.join("");
}

function renderCostumes(card) {
  const costumes = Array.isArray(card.costumes) ? card.costumes : [];
  const ratings = Array.isArray(card.costume_ratings) ? card.costume_ratings : [];
  if (!costumes.length && !ratings.length) return `<p class="gap">${GAP}</p>`;
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
    if (costume && costume.skill) bits.push(`<span class="meta">技能 ${esc(costume.skill)}</span>`);
    if (rating && rating.tier) bits.push(flag(rating.tier, "deep"));
    if (rating && rating.pull) bits.push(`<span>抽取建议：${esc(rating.pull)}</span>`);
    if (rating && safeHttpUrl(rating.source)) bits.push(link(rating.source, "出处"));
    rows.push(`<li>${bits.join(" ")}</li>`);
  };
  for (const costume of costumes) {
    const name = costume && (costume.name || costume.label);
    push(name, costume, name ? byLabel.get(name) : null);
  }
  for (const rating of ratings) push(rating && rating.label, null, rating);
  return rows.length ? `<ul class="costumes">${rows.join("")}</ul>` : `<p class="gap">${GAP}</p>`;
}

function renderSkills(card) {
  const skills = Array.isArray(card.skills) ? card.skills : [];
  if (!skills.length) return `<p class="gap">技能：${GAP}</p>`;
  const items = skills
    .map((skill) => {
      const name = skill && skill.name ? skill.name : "未命名";
      const bits = [];
      if (skill && skill.type) bits.push(`<code>${esc(skill.type)}</code>`);
      if (skill && skill.costume) bits.push(`<span class="tag">${esc(skill.costume)}</span>`);
      const summary =
        skill && skill.summary
          ? `<p>${esc(skill.summary)}</p>`
          : `<p class="gap">摘要：${GAP}</p>`;
      return `<li><strong>${esc(name)}</strong> ${bits.join(" ")}${summary}</li>`;
    })
    .join("");
  let extra = "";
  if (Array.isArray(card.skill_prio) && card.skill_prio.length) {
    extra += `<h3>加点</h3><ol>${card.skill_prio.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>`;
  }
  const talent = card.talent && typeof card.talent === "object" ? card.talent : null;
  const talentName = talent && talent.name;
  const already = skills.some((skill) => skill && skill.name === talentName);
  if (talentName && !already) {
    extra += `<h3>天赋</h3><p><strong>${esc(talentName)}</strong></p>${
      talent.summary ? `<p>${esc(talent.summary)}</p>` : `<p class="gap">摘要：${GAP}</p>`
    }`;
  }
  return `<ul class="skills">${items}</ul>${extra}`;
}

function renderStigmata(stigmata) {
  if (!stigmata || typeof stigmata !== "object" || Array.isArray(stigmata)) return "";
  const parts = [];
  if (stigmata.set_name) parts.push(`<p><span class="k">套装</span> ${esc(stigmata.set_name)}</p>`);
  if (stigmata.nickname) parts.push(`<p><span class="k">别名</span> ${esc(stigmata.nickname)}</p>`);
  if (stigmata.pieces != null && stigmata.pieces !== "") {
    parts.push(`<p><span class="k">件数</span> ${esc(stigmata.pieces)}</p>`);
  }
  if (Array.isArray(stigmata.notes) && stigmata.notes.length) {
    parts.push(`<ul>${stigmata.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>`);
  }
  if (!parts.length) return "";
  return `<section><h2>圣痕</h2>${parts.join("")}</section>`;
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

export function renderCharacter(gameId, card) {
  const id = safeId(gameId) || String(gameId || "");
  const known = watchMeta(id);
  const gameLabel = (known && known.name_zh) || id;
  if (!isDeep(id)) {
    return `<p class="crumbs">${link("/watchlist/", "关注")} / ${link(gameHref(id), gameLabel)}</p>
<h1>尚无深耕</h1>
<p class="rule">角色深耕只开放给地平线行者（hw）、胜利女神：NIKKE（nikke）、棕色尘埃2（bd2）。</p>
<p class="flags">${flag("尚无深耕", "gap")}</p>`;
  }
  if (!card || typeof card !== "object") return renderError("未找到角色卡");
  if (card.game && card.game !== id) {
    return `<h1>卡面不一致</h1><p class="gap">角色卡 game 为 ${esc(card.game)}，地址是 ${esc(id)}。不展示这份卡。</p>`;
  }
  const name = card.name_zh || card.name || card.id || "未命名";
  const en = card.name_en && card.name_en !== name ? card.name_en : "";
  const nick = Array.isArray(card.nicknames) && card.nicknames.length ? card.nicknames.join("、") : "";
  const marks = [];
  if (card.stub === true) marks.push(flag("stub", "stub"));
  const sources = collectCardSources(card);
  const weapon = typeof card.weapon === "string" && card.weapon.trim() ? card.weapon : "";
  return `<p class="crumbs">${link("/watchlist/", "关注")} / ${link(gameHref(id), gameLabel)} / ${esc(name)}</p>
<h1>${esc(name)} <code>${esc(card.id || "")}</code></h1>
${marks.length ? `<p class="flags">${marks.join(" ")}</p>` : ""}
<p class="meta">${esc([en, nick ? `别名 ${nick}` : "", card.as_of ? `as_of ${card.as_of}` : ""].filter(Boolean).join(" · "))}</p>
${card.verified ? `<p class="meta">核对：${esc(card.verified)}</p>` : ""}
${gapBanner(card)}
<section><h2>强度</h2>${renderStrength(card)}</section>
<section><h2>服装</h2>${renderCostumes(card)}</section>
<section><h2>技能</h2>${renderSkills(card)}</section>
${renderStigmata(card.stigmata)}
${weapon ? `<section><h2>武器</h2><p>${esc(weapon)}</p></section>` : ""}
<section><h2>出处</h2>${
    sources.length
      ? `<ul class="sources">${sources.map((item) => `<li>${link(item.url, item.label || item.url)}</li>`).join("")}</ul>`
      : `<p class="gap">出处：${GAP}</p>`
  }</section>
${card.id ? jsonLink(`/v1/guides/${encodeURIComponent(id)}/characters/${encodeURIComponent(card.id)}.json`, `/v1/guides/${id}/characters/${card.id}.json`) : ""}`;
}
