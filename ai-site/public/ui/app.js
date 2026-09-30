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
  renderWatchlist,
  safeId,
  shanghaiToday,
} from "./render.js";

const app = document.getElementById("app");
const view = (document.body && document.body.dataset.view) || "home";
const cache = {};
let keepFocus = null;

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
  const jobs = [];
  if (isDeep(id)) {
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
    paint(renderCharacter(game, null), "尚无深耕 · game-intel");
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
    else if (view === "for-ai") showForAi();
    else if (view === "claims") await showClaims();
    else paint(renderError("未知页面"));
  } catch (error) {
    paint(renderError(error.message || String(error)));
  }
}

document.addEventListener("input", onFilter);
document.addEventListener("change", onFilter);
document.addEventListener("submit", (event) => {
  if (event.target && event.target.id === "filters") event.preventDefault();
});

boot();
