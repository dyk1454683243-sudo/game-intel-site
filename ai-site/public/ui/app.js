import {
  aliasPartNames,
  aliasesByCharacterId,
  isDeep,
  mergeAliasDocs,
  newsForGame,
  renderCatalog,
  renderCharacter,
  renderClaims,
  renderError,
  renderForAi,
  renderFrame,
  renderGame,
  renderHome,
  renderMe,
  renderWatchlist,
  safeId,
  shanghaiToday,
} from "./render.js";
import {
  assemblePersonal,
  importFollowText,
  parseFollows,
  toggleFollow,
} from "./personal.js";
import {
  displayCharacterName,
  displayGameName,
  getLang,
  localizePath,
  setLang,
  tx,
} from "./i18n.js";
import { renderHeadTags, seoModel } from "./seo.js";

const app = document.getElementById("app");
const view = (document.body && document.body.dataset.view) || "home";
setLang(document.documentElement.lang || (document.body && document.body.dataset.lang) || "zh-CN");
const FOLLOW_KEY = "game-intel.follows.v1";
function followError(code) {
  const table = {
    bad_follow: tx(
      "订阅里有无法识别的 id。只接受小写字母、数字、下划线和连字符。",
      "A follow id is not recognized. Use lowercase letters, digits, underscores, and hyphens.",
      "購読に読めない id がある。小文字、数字、アンダースコア、ハイフンだけ。"
    ),
    bad_code: tx("订阅码无法解析。", "The share code could not be read.", "購読コードを読めない。"),
    too_many_games: tx("关注的游戏太多（最多 24 部）。", "Too many games (24 max).", "ゲームが多すぎる（最大 24）。"),
    too_many_chars: tx("关注的角色太多（最多 48 名）。", "Too many characters (48 max).", "キャラが多すぎる（最大 48）。"),
    empty: tx("先贴上订阅码、链接，或游戏 id。", "Paste a share code, a link, or a game id.", "購読コード、リンク、またはゲーム id を貼る。"),
  };
  return table[code] || tx("没能更新关注。", "Could not update follows.", "フォローを更新できなかった。");
}
const cache = {};
const published = {};
let keepFocus = null;
let meNote = "";

function params() {
  return new URLSearchParams(location.search);
}

function readOpts(search) {
  const q = search.get("q") || "";
  return {
    q,
    platform: search.get("platform") || "",
    tag: search.get("tag") || "",
    kind: search.get("kind") || "all",
  };
}

async function getJson(path) {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const error = new Error(tx(
      `无法读取 ${path}（${res.status}）`,
      `Could not read ${path} (${res.status})`,
      `${path} を読めない（${res.status}）`
    ));
    error.path = path;
    throw error;
  }
  return res.json();
}

function currentPath() {
  return `${location.pathname}${location.search}`;
}

function applySeo(model) {
  if (!model) return;
  document.title = model.title;
  document.documentElement.lang = model.htmlLang;
  const head = document.head;
  for (const sel of [
    'meta[name="description"]',
    'meta[name="robots"]',
    'meta[name="google-site-verification"]',
    'link[rel="canonical"]',
    'link[rel="alternate"][hreflang]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]',
    'script[type="application/ld+json"]',
  ]) {
    for (const node of [...head.querySelectorAll(sel)]) node.remove();
  }
  const holder = document.createElement("template");
  holder.innerHTML = renderHeadTags(model);
  for (const node of [...holder.content.children]) {
    if (node.tagName === "TITLE") continue;
    head.appendChild(node);
  }
}

function pageSeo(title, description, crumbs, videoGame) {
  const url = new URL(location.href);
  return seoModel({
    lang: getLang(),
    title,
    description,
    pathname: url.pathname,
    search: url.search,
    crumbs,
    videoGame,
  });
}

function crumbHome() {
  return { name: tx("首页", "Home", "ホーム"), path: localizePath("/") };
}

function paint(html, seo) {
  const prev = keepFocus;
  keepFocus = null;
  const path = currentPath();
  app.innerHTML = renderFrame(view, html, { path });
  if (seo && typeof seo === "object") applySeo(seo);
  else if (typeof seo === "string" && seo) document.title = seo;
  syncFollowButtons();
  const shareUrl = document.getElementById("share-url");
  if (shareUrl && shareUrl.value.startsWith("/")) {
    shareUrl.value = new URL(shareUrl.value, location.origin).href;
  }
  if (!prev || !prev.id) return;
  const el = document.getElementById(prev.id);
  if (!el) return;
  el.focus();
  if (typeof prev.start === "number" && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(prev.start, prev.end ?? prev.start);
    } catch {
      /* select elements have no caret */
    }
  }
}

function loadFollows() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLLOW_KEY) || "null");
    const parsed = parseFollows(raw && typeof raw === "object" ? raw : {});
    return parsed.ok ? parsed.follows : { games: [], chars: [] };
  } catch {
    return { games: [], chars: [] };
  }
}

function saveFollows(follows) {
  try {
    localStorage.setItem(
      FOLLOW_KEY,
      JSON.stringify({ v: 1, games: follows.games, chars: follows.chars })
    );
  } catch {
    meNote = tx("这台浏览器拒绝写入本地名单。", "This browser refused to store the list.", "このブラウザはリストの保存を拒んだ。");
  }
}

function syncFollowButtons() {
  const follows = loadFollows();
  for (const button of document.querySelectorAll("[data-follow-kind]")) {
    const kind = button.dataset.followKind;
    const on =
      kind === "game"
        ? follows.games.includes(button.dataset.game)
        : follows.chars.some((row) => row.game === button.dataset.game && row.id === button.dataset.id);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    if (button.closest("#main") && view === "me") continue;
    button.textContent = kind === "game"
      ? (on ? tx("已关注这部游戏", "Following this game", "このゲームをフォロー中") : tx("关注这部游戏", "Follow this game", "このゲームをフォロー"))
      : on
        ? tx("已关注这个角色", "Following this character", "このキャラをフォロー中")
        : tx("关注这个角色", "Follow this character", "このキャラをフォロー");
  }
}

async function readPublished(pathname) {
  if (Object.prototype.hasOwnProperty.call(published, pathname)) return published[pathname];
  try {
    published[pathname] = await getJson(pathname);
  } catch {
    published[pathname] = null;
  }
  return published[pathname];
}

function rememberFocus(target) {
  if (!target || !target.id) return;
  keepFocus = {
    id: target.id,
    start: target.selectionStart,
    end: target.selectionEnd,
  };
}

function writeSearch(search) {
  const qs = search.toString();
  const next = qs ? `${location.pathname}?${qs}` : location.pathname;
  history.replaceState(null, "", next);
}

async function loadAliases(game) {
  try {
    const doc = await getJson(`/v1/guides/${game}/aliases.json`);
    const parts = aliasPartNames(doc);
    const hasRows = doc.aliases && Object.keys(doc.aliases).length > 0;
    if (hasRows || !parts.length) return aliasesByCharacterId(doc);
    const docs = await Promise.all(parts.map((name) => getJson(`/v1/guides/${game}/${name}`)));
    return aliasesByCharacterId(mergeAliasDocs([doc, ...docs]));
  } catch {
    return {};
  }
}

async function showHome() {
  let digest = null;
  let radar = null;
  let digestError = "";
  let radarError = "";
  try {
    digest = await getJson("/v1/digest.json");
  } catch (error) {
    digestError = error.message;
  }
  try {
    radar = await getJson("/v1/radar.json");
  } catch (error) {
    radarError = error.message;
  }
  if (!digest && !radar) {
    paint(renderError(digestError || radarError || tx("无法读取摘要与雷达", "Could not read the brief or radar", "摘要とレーダーを読めない")));
    return;
  }
  paint(renderHome({ digest, radar, digestError, radarError, today: shanghaiToday() }), pageSeo(
    tx("首页 · game-intel", "Home · game-intel", "ホーム · game-intel"),
    tx(
      "今日情报摘要。人从观察名单继续，AI 读同一份已发布的 /v1 JSON。",
      "Today's intel brief. People continue from the watchlist. AI reads the same published /v1 JSON.",
      "今日の情報摘要。人はウォッチリストへ。AI は同じ公開 /v1 JSON を読む。"
    ),
    [crumbHome()]
  ));
}

async function showCatalog() {
  cache.catalog = await getJson("/v1/games/index.json");
  paint(renderCatalog(cache.catalog, readOpts(params())), pageSeo(
    tx("目录 · game-intel", "Catalog · game-intel", "カタログ · game-intel"),
    tx(
      "游戏目录。stub 身份卡只展示名称、平台、标签、出处和 steam_appid。",
      "Game catalog. Stub identity cards show the stored name, platforms, tags, sources, and steam_appid.",
      "ゲーム目録。stub の身元カードは名前、プラットフォーム、タグ、出典、steam_appid だけ。"
    ),
    [crumbHome(), { name: tx("目录", "Catalog", "カタログ"), path: localizePath("/catalog/") }]
  ));
}

async function showWatchlist() {
  const [watchlist, catalog, guides] = await Promise.all([
    getJson("/v1/watchlist.json"),
    getJson("/v1/games/index.json"),
    getJson("/v1/guides/index.json"),
  ]);
  paint(renderWatchlist({ watchlist, catalog, guides }), pageSeo(
    tx("观察名单 · game-intel", "Watchlist · game-intel", "ウォッチリスト · game-intel"),
    tx(
      "观察名单上的游戏。已深耕的有角色图鉴，其余只保留身份。",
      "Games on the watchlist. Guides exist only where they were already published. The rest stay identity-only.",
      "ウォッチリストのゲーム。深掘りがあるものだけ役割図鑑。ほかは身元だけ。"
    ),
    [crumbHome(), { name: tx("观察名单", "Watchlist", "ウォッチリスト"), path: localizePath("/watchlist/") }]
  ));
}

async function showGame() {
  const id = safeId(params().get("id"));
  if (!id) {
    paint(renderError(tx("缺少或无效的游戏 id", "Missing or invalid game id", "ゲーム id がないか無効")), pageSeo(
      tx("游戏 · game-intel", "Game · game-intel", "ゲーム · game-intel"),
      tx("缺少游戏 id。", "Missing game id.", "ゲーム id がない。"),
      [crumbHome(), { name: tx("游戏", "Game", "ゲーム"), path: localizePath("/game/") }]
    ));
    return;
  }
  const game = await getJson(`/v1/games/${encodeURIComponent(id)}.json`);
  cache.game = game;
  cache.guideIndex = null;
  cache.aliasesById = {};
  cache.guideError = "";
  cache.news = [];
  cache.newsError = "";
  cache.banners = null;
  cache.codes = null;
  const jobs = [];
  if (isDeep(id)) {
    jobs.push(
      Promise.all([
        getJson(`/v1/guides/${encodeURIComponent(id)}/banners.json`).catch(() => null),
        getJson(`/v1/guides/${encodeURIComponent(id)}/codes.json`).catch(() => null),
      ]).then(([banners, codes]) => {
        cache.banners = banners;
        cache.codes = codes;
      })
    );
    jobs.push(
      Promise.all([
        getJson(`/v1/guides/${encodeURIComponent(id)}/index.json`),
        loadAliases(id),
      ])
        .then(([guideIndex, aliasesById]) => {
          cache.guideIndex = guideIndex;
          cache.aliasesById = aliasesById;
        })
        .catch((error) => {
          cache.guideError = error.message;
        })
    );
  }
  jobs.push(
    getJson("/v1/digest.json")
      .then((digest) => {
        cache.news = newsForGame(digest, id);
      })
      .catch((error) => {
        cache.newsError = error.message;
      })
  );
  await Promise.all(jobs);
  const titleName = displayGameName(game) || id;
  paint(renderGame(game, gameExtras(params().get("q") || "")), pageSeo(
    `${titleName} · game-intel`,
    tx(
      `${titleName} 的身份卡。平台、标签和出处来自已发布 JSON，不编造评分或价格。`,
      `${titleName}: identity card. Platforms, tags, and sources come from published JSON. No invented scores or prices.`,
      `${titleName} の身元カード。プラットフォーム、タグ、出典は公開 JSON。点数や価格は作らない。`
    ),
    [
      crumbHome(),
      { name: tx("目录", "Catalog", "カタログ"), path: localizePath("/catalog/") },
      { name: titleName, path: currentPath() },
    ],
    game
  ));
}

function gameExtras(q) {
  return {
    guideIndex: cache.guideIndex,
    guideError: cache.guideError,
    aliasesById: cache.aliasesById,
    news: cache.news,
    newsError: cache.newsError,
    banners: cache.banners,
    codes: cache.codes,
    q,
  };
}

async function showCharacter() {
  const game = safeId(params().get("game"));
  const id = safeId(params().get("id"));
  if (!game || !id) {
    paint(renderError(tx("缺少或无效的角色地址", "Missing or invalid character address", "キャラのアドレスがないか無効")), pageSeo(
      tx("角色 · game-intel", "Character · game-intel", "キャラクター · game-intel"),
      tx("缺少角色地址。", "Missing character address.", "キャラのアドレスがない。"),
      [crumbHome(), { name: tx("角色", "Character", "キャラクター"), path: localizePath("/character/") }]
    ));
    return;
  }
  if (!isDeep(game)) {
    paint(renderCharacter(game, null, { id }), pageSeo(
      tx("尚无深耕 · game-intel", "No guides yet · game-intel", "深掘りなし · game-intel"),
      tx("这个游戏还没有角色深耕。", "This game has no character guides yet.", "このゲームに役割ガイドはまだない。"),
      [crumbHome(), { name: tx("观察名单", "Watchlist", "ウォッチリスト"), path: localizePath("/watchlist/") }]
    ));
    return;
  }
  const card = await getJson(
    `/v1/guides/${encodeURIComponent(game)}/characters/${encodeURIComponent(id)}.json`
  );
  const titleName = displayCharacterName(card) || id;
  paint(renderCharacter(game, card), pageSeo(
    `${titleName} · game-intel`,
    tx(
      `${titleName} 的角色卡。技能、结论和配队保持已发布原文，不另译成新的事实。`,
      `${titleName}. Skills, conclusions, and teams stay in the published language.`,
      `${titleName}。スキル、結論、編成は公開された原文のまま。`
    ),
    [
      crumbHome(),
      { name: tx("观察名单", "Watchlist", "ウォッチリスト"), path: localizePath("/watchlist/") },
      { name: displayGameName({ id: game, name: game }) || game, path: localizePath(`/game/?id=${encodeURIComponent(game)}`) },
      { name: titleName, path: currentPath() },
    ]
  ));
}

function showForAi() {
  paint(renderForAi(), pageSeo(
    tx("给 AI · game-intel", "For AI · game-intel", "AI 向け · game-intel"),
    tx(
      "人和 AI 读同一份已发布数据。MCP、OpenAPI、llms.txt。",
      "People and AI read the same published data. MCP, OpenAPI, and llms.txt.",
      "人と AI は同じ公開データを読む。MCP、OpenAPI、llms.txt。"
    ),
    [crumbHome(), { name: tx("给 AI", "For AI", "AI 向け"), path: localizePath("/for-ai/") }]
  ));
}

async function showMe() {
  const search = params();
  let follows = loadFollows();
  let imported = false;
  const incoming = ["games", "chars", "code"].some((key) => String(search.get(key) || "").trim());
  if (incoming) {
    const parsed = parseFollows({
      games: search.get("games") || "",
      chars: search.get("chars") || "",
      code: search.get("code") || "",
    });
    if (!parsed.ok) {
      paint(renderError(followError(parsed.error)), pageSeo(
        tx("我的关注 · game-intel", "Following · game-intel", "フォロー · game-intel"),
        tx("关注名单留在这台浏览器。", "The follow list stays in this browser.", "フォローはこのブラウザに残る。"),
        [crumbHome(), { name: tx("我的关注", "Following", "フォロー"), path: localizePath("/me/") }]
      ));
      return;
    }
    follows = parsed.follows;
    saveFollows(follows);
    imported = true;
    history.replaceState(null, "", localizePath("/me/"));
  }
  const doc = await assemblePersonal(follows, readPublished, shanghaiToday());
  const note = meNote;
  meNote = "";
  paint(renderMe(doc, { imported, note }), pageSeo(
    tx("我的关注 · game-intel", "Following · game-intel", "フォロー · game-intel"),
    tx(
      "按这台浏览器里的关注列表过滤已发布的 feed、digest、卡池和兑换码。名单不上传。",
      "Filters published feed, digest, banners, and codes by the follow list in this browser. The list is not uploaded.",
      "このブラウザのフォローで、公開済みの feed、digest、ガチャ、コードを絞る。リストは送らない。"
    ),
    [crumbHome(), { name: tx("我的关注", "Following", "フォロー"), path: localizePath("/me/") }]
  ));
}

async function showClaims() {
  try {
    const mirror = await getJson("/v1/claims.json");
    paint(renderClaims(mirror), pageSeo(
      tx("核对墙 · game-intel", "Claims · game-intel", "照合 · game-intel"),
      tx(
        "带 https 出处的投稿镜像。未经人工核对之前不可信。",
        "Mirror of submissions that include an https source. Untrusted until a person checks them.",
        "https 出典つき投稿のミラー。人が確認するまで信頼できない。"
      ),
      [crumbHome(), { name: tx("核对墙", "Claims", "照合"), path: localizePath("/claims/") }]
    ));
  } catch (error) {
    paint(renderClaims({ claims: [], error: error.message }), pageSeo(
      tx("核对墙 · game-intel", "Claims · game-intel", "照合 · game-intel"),
      tx("核对墙暂时读不到镜像。", "The claims mirror could not be read.", "照合ミラーを読めない。"),
      [crumbHome(), { name: tx("核对墙", "Claims", "照合"), path: localizePath("/claims/") }]
    ));
  }
}

function onFilter(event) {
  const target = event.target;
  if (!target || !target.closest || !target.closest("#filters")) return;
  if (event.type === "change" && target.tagName !== "SELECT") return;
  if (event.type === "input" && target.tagName === "SELECT") return;
  const form = target.form || target.closest("form");
  if (!form) return;
  rememberFocus(target);
  if (view === "catalog" && cache.catalog) {
    const search = new URLSearchParams();
    const data = new FormData(form);
    for (const key of ["q", "platform", "tag", "kind"]) {
      const value = String(data.get(key) || "").trim();
      if (!value || (key === "kind" && value === "all")) continue;
      search.set(key, value);
    }
    writeSearch(search);
    paint(renderCatalog(cache.catalog, readOpts(search)), pageSeo(
      tx("目录 · game-intel", "Catalog · game-intel", "カタログ · game-intel"),
      tx("游戏目录。", "Game catalog.", "ゲーム目録。"),
      [crumbHome(), { name: tx("目录", "Catalog", "カタログ"), path: currentPath() }]
    ));
  }
  if (view === "game" && cache.game) {
    const search = new URLSearchParams();
    const id = safeId(params().get("id")) || safeId(cache.game.id);
    if (id) search.set("id", id);
    const q = String(new FormData(form).get("q") || "").trim();
    if (q) search.set("q", q);
    writeSearch(search);
    paint(renderGame(cache.game, gameExtras(q)), document.title);
  }
}

async function boot() {
  if (!app) return;
  try {
    if (view === "home") await showHome();
    else if (view === "catalog") await showCatalog();
    else if (view === "watchlist") await showWatchlist();
    else if (view === "game") await showGame();
    else if (view === "character") await showCharacter();
    else if (view === "me") await showMe();
    else if (view === "for-ai") showForAi();
    else if (view === "claims") await showClaims();
    else paint(renderError("未知页面"));
  } catch (error) {
    paint(renderError(error.message || String(error)));
  }
}

function setFollowStatus(message) {
  const el = document.getElementById("follow-status");
  if (el) {
    el.textContent = message;
    return;
  }
  let note = document.getElementById("follow-toast");
  if (!note) {
    note = document.createElement("p");
    note.id = "follow-toast";
    note.className = "meta";
    note.setAttribute("role", "status");
    const main = document.getElementById("main");
    if (main) main.prepend(note);
  }
  note.textContent = message;
}

async function onFollowClick(button) {
  try {
    await followClick(button);
  } catch (error) {
    setFollowStatus(error.message || tx("没能更新关注。", "Could not update follows.", "フォローを更新できなかった。"));
  }
}

async function followClick(button) {
  const action = button.dataset.followAction;
  if (action === "copy-url" || action === "copy-code") {
    const el = document.getElementById(action === "copy-url" ? "share-url" : "share-code");
    const value = el ? el.value : "";
    if (!value || value === "/me/") {
      setFollowStatus(tx("名单是空的。先关注一部游戏或一个角色。", "The list is empty. Follow a game or a character first.", "リストは空。先にゲームかキャラをフォロー。"));
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setFollowStatus(tx(
        "已复制。打开链接的人会导入这份名单，服务端不保存。",
        "Copied. Opening the link imports this list. The server does not store it.",
        "コピーした。リンクを開くとそのリストを読み込む。サーバーは保存しない。"
      ));
    } catch {
      if (el) {
        el.focus();
        el.select();
      }
      setFollowStatus(tx("无法自动复制，内容已选中。", "Could not copy automatically. The text is selected.", "自動コピーできない。テキストは選択済み。"));
    }
    return;
  }
  if (action === "clear") {
    saveFollows({ games: [], chars: [] });
    meNote = tx("已清空这台浏览器里的关注。", "Cleared the follows in this browser.", "このブラウザのフォローを消した。");
    await showMe();
    return;
  }
  const kind = button.dataset.followKind;
  if (!kind) return;
  const toggled = toggleFollow(loadFollows(), kind, button.dataset.game, button.dataset.id);
  if (!toggled.ok) {
    setFollowStatus(followError(toggled.error));
    return;
  }
  saveFollows(toggled.follows);
  if (view === "me") {
    meNote = kind === "game"
      ? tx("已更新关注的游戏。", "Updated the followed games.", "フォロー中のゲームを更新した。")
      : tx("已更新关注的角色。", "Updated the followed characters.", "フォロー中のキャラを更新した。");
    await showMe();
    return;
  }
  syncFollowButtons();
}

async function onFollowImport(form) {
  const raw = String(new FormData(form).get("code") || "");
  const parsed = importFollowText(raw);
  if (!parsed.ok) {
    setFollowStatus(followError(parsed.error));
    return;
  }
  saveFollows(parsed.follows);
  meNote = tx("已导入。名单只保存在这台浏览器。", "Imported. The list stays in this browser.", "読み込んだ。リストはこのブラウザだけ。");
  await showMe();
}

document.addEventListener("input", onFilter);
document.addEventListener("change", onFilter);
document.addEventListener("click", (event) => {
  const button = event.target && event.target.closest && event.target.closest("[data-follow-kind], [data-follow-action]");
  if (!button || button.type === "submit") return;
  event.preventDefault();
  onFollowClick(button);
});
document.addEventListener("submit", (event) => {
  if (!event.target) return;
  if (event.target.id === "filters" || event.target.id === "follow-import") event.preventDefault();
  if (event.target.id === "follow-import") onFollowImport(event.target);
});

boot();
