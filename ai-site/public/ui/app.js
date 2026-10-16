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

const app = document.getElementById("app");
const view = (document.body && document.body.dataset.view) || "home";
const FOLLOW_KEY = "game-intel.follows.v1";
const FOLLOW_ERRORS = {
  bad_follow: "订阅里有无法识别的 id。只接受小写字母、数字、下划线和连字符。",
  bad_code: "订阅码无法解析。",
  too_many_games: "关注的游戏太多（最多 24 部）。",
  too_many_chars: "关注的角色太多（最多 48 名）。",
  empty: "先贴上订阅码、链接，或游戏 id。",
};
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
    const error = new Error(`无法读取 ${path}（${res.status}）`);
    error.path = path;
    throw error;
  }
  return res.json();
}

function paint(html, title) {
  const prev = keepFocus;
  keepFocus = null;
  app.innerHTML = renderFrame(view, html);
  if (title) document.title = title;
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
    meNote = "这台浏览器拒绝写入本地名单。";
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
    button.textContent = kind === "game" ? (on ? "已关注这部游戏" : "关注这部游戏") : on ? "已关注这个角色" : "关注这个角色";
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
    paint(renderError(digestError || radarError || "无法读取摘要与雷达"));
    return;
  }
  paint(renderHome({ digest, radar, digestError, radarError, today: shanghaiToday() }), "首页 · game-intel");
}

async function showCatalog() {
  cache.catalog = await getJson("/v1/games/index.json");
  paint(renderCatalog(cache.catalog, readOpts(params())), "目录 · game-intel");
}

async function showWatchlist() {
  const [watchlist, catalog, guides] = await Promise.all([
    getJson("/v1/watchlist.json"),
    getJson("/v1/games/index.json"),
    getJson("/v1/guides/index.json"),
  ]);
  paint(renderWatchlist({ watchlist, catalog, guides }), "观察名单 · game-intel");
}

async function showGame() {
  const id = safeId(params().get("id"));
  if (!id) {
    paint(renderError("缺少或无效的游戏 id"), "游戏 · game-intel");
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
  const title = `${game.name_zh || game.name || id} · game-intel`;
  paint(renderGame(game, gameExtras(params().get("q") || "")), title);
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
    paint(renderError("缺少或无效的角色地址"), "角色 · game-intel");
    return;
  }
  if (!isDeep(game)) {
    paint(renderCharacter(game, null, { id }), "尚无深耕 · game-intel");
    return;
  }
  const card = await getJson(
    `/v1/guides/${encodeURIComponent(game)}/characters/${encodeURIComponent(id)}.json`
  );
  paint(renderCharacter(game, card), `${card.name_zh || card.name || id} · game-intel`);
}

function showForAi() {
  paint(renderForAi(), "给 AI · game-intel");
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
      paint(renderError(FOLLOW_ERRORS[parsed.error] || "订阅无法导入"), "我的关注 · game-intel");
      return;
    }
    follows = parsed.follows;
    saveFollows(follows);
    imported = true;
    history.replaceState(null, "", "/me/");
  }
  const doc = await assemblePersonal(follows, readPublished, shanghaiToday());
  const note = meNote;
  meNote = "";
  paint(renderMe(doc, { imported, note }), "我的关注 · game-intel");
}

async function showClaims() {
  try {
    const mirror = await getJson("/v1/claims.json");
    paint(renderClaims(mirror), "核对墙 · game-intel");
  } catch (error) {
    paint(renderClaims({ claims: [], error: error.message }), "核对墙 · game-intel");
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
    paint(renderCatalog(cache.catalog, readOpts(search)), "目录 · game-intel");
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
    setFollowStatus(error.message || "没能更新关注。");
  }
}

async function followClick(button) {
  const action = button.dataset.followAction;
  if (action === "copy-url" || action === "copy-code") {
    const el = document.getElementById(action === "copy-url" ? "share-url" : "share-code");
    const value = el ? el.value : "";
    if (!value || value === "/me/") {
      setFollowStatus("名单是空的。先关注一部游戏或一个角色。");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setFollowStatus("已复制。打开链接的人会导入这份名单，服务端不保存。");
    } catch {
      if (el) {
        el.focus();
        el.select();
      }
      setFollowStatus("无法自动复制，内容已选中。");
    }
    return;
  }
  if (action === "clear") {
    saveFollows({ games: [], chars: [] });
    meNote = "已清空这台浏览器里的关注。";
    await showMe();
    return;
  }
  const kind = button.dataset.followKind;
  if (!kind) return;
  const toggled = toggleFollow(loadFollows(), kind, button.dataset.game, button.dataset.id);
  if (!toggled.ok) {
    setFollowStatus(FOLLOW_ERRORS[toggled.error] || "没能更新关注。");
    return;
  }
  saveFollows(toggled.follows);
  if (view === "me") {
    meNote = kind === "game" ? "已更新关注的游戏。" : "已更新关注的角色。";
    await showMe();
    return;
  }
  syncFollowButtons();
}

async function onFollowImport(form) {
  const raw = String(new FormData(form).get("code") || "");
  const parsed = importFollowText(raw);
  if (!parsed.ok) {
    setFollowStatus(FOLLOW_ERRORS[parsed.error] || "没能导入。");
    return;
  }
  saveFollows(parsed.follows);
  meNote = "已导入。名单只保存在这台浏览器。";
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
