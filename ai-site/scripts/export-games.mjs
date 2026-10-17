#!/usr/bin/env node
/**
 * Export data/games → ai-site/public (JSON for AI + simple HTML for humans).
 * Also builds /v1/feed.json from real digest/radar items (never invents headlines).
 * Dual publish from one source of truth — separate from character guides.
 */
import "./require-node22.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "../src/openapi.js";
import { displayGameName, getLang, localizePath, tx, withLang } from "../public/ui/i18n.js";
import { staticDocument } from "../public/ui/seo.js";
import { buildLocalizedSite } from "./site-seo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const GAMES_DIR = path.join(DATA, "games");
const OUT_V1 = path.join(SITE, "public", "v1", "games");
const OUT_HTML = path.join(SITE, "public", "games");
const OUT_SCHEMA = path.join(SITE, "public", "schema");
const OUT_PUBLIC = path.join(SITE, "public");
const SCHEMA_SRC = path.join(SITE, "schema");
const FEED_OUT = path.join(SITE, "public", "v1", "feed.json");
const ALIAS_SRC = path.join(DATA, "catalog-aliases.json");
const ALIAS_OUT = path.join(SITE, "public", "v1", "catalog-aliases.json");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function shanghaiIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
}

function htmlPage(pathname, title, description, crumbs, body, videoGame) {
  return staticDocument({
    lang: getLang(),
    title,
    description,
    pathname,
    crumbs,
    body,
    videoGame,
  });
}

function gamesDir(lang) {
  if (lang === "zh-CN") return OUT_HTML;
  return path.join(OUT_PUBLIC, lang === "ja" ? "ja" : "en", "games");
}

function loadGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs
    .readdirSync(GAMES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => {
      const g = readJson(path.join(GAMES_DIR, f));
      return { ...g, id: g.id || f.replace(/\.json$/, "") };
    })
    .sort((a, b) => {
      const aw = a.watchlist ? 0 : 1;
      const bw = b.watchlist ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return String(a.id).localeCompare(String(b.id));
    });
}

function buildFeed(games, asOf) {
  const items = [];
  const seen = new Set();
  const push = (it) => {
    const url = String(it.url || "").trim();
    const title = String(it.title || "").trim();
    if (!url || !title) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      title,
      url,
      game_id: it.game_id ?? null,
      platform: it.platform || it.source || "unknown",
      published_at: it.published_at ?? it.date ?? it.updated ?? null,
      source: it.source || "unknown",
    });
  };

  const digestPath = path.join(SITE, "public", "v1", "digest.json");
  if (fs.existsSync(digestPath)) {
    try {
      const dig = readJson(digestPath);
      for (const d of dig.digests || []) {
        const gid = d.game || d.alias || null;
        for (const it of d.items || []) {
          push({
            title: it.title,
            url: it.url,
            game_id: gid,
            platform: it.source || "digest",
            published_at: it.updated || it.date || null,
            source: it.source || "digest",
          });
        }
      }
    } catch (e) {
      console.error(`[export-games] digest feed parse: ${e.message}`);
    }
  }

  const radarPath = path.join(SITE, "public", "v1", "radar.json");
  if (fs.existsSync(radarPath)) {
    try {
      const rad = readJson(radarPath);
      for (const it of rad.items || []) {
        // Best-effort game_id from title keywords vs watchlist names
        let game_id = null;
        const t = String(it.title || "");
        for (const g of games) {
          if (!g.watchlist) continue;
          const keys = [g.name, g.name_zh, g.id].filter(Boolean);
          if (keys.some((k) => t.includes(k))) {
            game_id = g.id;
            break;
          }
        }
        push({
          title: it.title,
          url: it.url,
          game_id,
          platform: it.source || "radar",
          published_at: it.date || null,
          source: it.source || "radar",
        });
      }
    } catch (e) {
      console.error(`[export-games] radar feed parse: ${e.message}`);
    }
  }

  // Cap feed size; keep newest-ish first when dates exist
  items.sort((a, b) => {
    const da = a.published_at ? Date.parse(a.published_at) : 0;
    const db = b.published_at ? Date.parse(b.published_at) : 0;
    return (db || 0) - (da || 0);
  });
  const capped = items.slice(0, 40);

  return {
    meta: {
      as_of: asOf,
      timezone: "Asia/Shanghai",
      generated_at: shanghaiIso(),
      source: "digest+radar (real items only; never invented)",
      count: capped.length,
      note: "Sparse is OK. Empty items[] is valid if no real intel available.",
    },
    items: capped,
  };
}

export function publishHumanHome(publicDir) {
  const shellPath = path.join(publicDir, "ui", "home.html");
  if (!fs.existsSync(shellPath)) {
    throw new Error(`[export-games] missing human UI shell ${shellPath}`);
  }
  const html = fs.readFileSync(shellPath, "utf8");
  if (!html.includes('data-view="home"') || !html.includes("/ui/app.js")) {
    throw new Error(`[export-games] human UI shell is not the home page: ${shellPath}`);
  }
  fs.writeFileSync(path.join(publicDir, "index.html"), html, "utf8");
  return html;
}

function writeHomePages(games, feed, asOf) {
  publishHumanHome(OUT_PUBLIC);

  // Also keep a markdown overview for agents. Home HTML is the human UI shell.
  const md = `# game-intel · 泛游戏目录 / Game Catalog

**中文：** 泛游戏站 first cut — 游戏实体目录 + 情报 feed + 既有角色攻略。时区 Asia/Shanghai。
**EN:** Game entity catalog + cross-platform feed + existing character guides. Dual-publish (human HTML + AI JSON).

## Endpoints

| Path | Description |
|------|-------------|
| \`/v1/games/index.json\` | Game catalog index (${games.length}+) |
| \`/v1/games/{id}.json\` | Single game entity |
| \`/v1/catalog-aliases.json\` | Catalog nickname → id |
| \`/v1/feed.json\` | Recent intel items (real only) |
| \`/\` | Human UI home: digest + radar from live /v1 JSON |
| \`/catalog/\` | Human catalog search |
| \`/watchlist/\` | Human watchlist |
| \`/game/?id=\` | Identity card. Non-deep games show 尚无深耕 |
| \`/character/?game=&id=\` | Deep character card (hw, nikke, bd2, reverse-1999, arknights-endfield, limbus-company, zenless-zone-zero, wuthering-waves) |
| \`/developers/\` | Public API notes (中文 + English), curl, and MCP client config |
| \`/me/\` | Personal follows. List stays in the browser |
| \`/v1/personal\` | Stateless filter. Query games and chars. Stores nothing |
| \`/v1/personal.atom\` | Atom for the same filter |
| \`/games/index.html\` | Static game directory |
| \`/games/{id}.html\` | Static game detail |
| \`/v1/guides/index.json\` | Character guide coverage |
| \`/guides/*.html\` | Human Chinese guide pages |
| \`/v1/watchlist.json\` | Dai daily watchlist |
| \`/v1/digest.json\` | Per-game digest |
| \`/v1/calendar.json\` / \`calendar-hw.json\` | Calendar |
| \`/v1/radar.json\` | New-game radar |
| \`/schema/*.schema.json\` | JSON Schema draft-07 |
| \`/v1/openapi.json\` | OpenAPI 3.1 (same document as \`/openapi.json\`) |
| \`/llms.txt\` | Agent discovery map |
| \`/.well-known/mcp.json\` | MCP discovery (AI Catalog alias) |
| \`/mcp\` | Read-only remote MCP (streamable HTTP) |
| \`/v1/claims.json\` | Public claims mirror |

## Rules

- Never invent Metacritic / prices / player counts.
- \`stub: true\` on a non-watchlist row = name / platforms / tags / sources / steam_appid only. Character cards are watchlist-only.
- Source priority: official > review sites > forums. If unverified, say 未见可靠出处.
- Watchlist games first on human pages.
- Human UI reads \`/v1\` in the browser. Full character cards are the eight deep games. Other games stay identity-only and show 尚无深耕. Developer notes: \`/developers/\`.
- Guides remain under \`/guides/*\` and \`/v1/guides/*\` (unchanged contract).
- Non-stub character cards require \`sources\` + \`as_of\`. HW/NIKKE/BD2 also require \`summary\` (conclusion). \`summary.stub: true\` means the conclusion is incomplete.
- POST \`/v1/claims\` is public (no API key). Every claim needs statement text, an https source, and \`game_id\`. GET \`/v1/claims.json\` lists those rows; they are untrusted until reviewed.

Catalog export as_of ${asOf}. Feed items: ${feed.meta.count}.
`;
  fs.writeFileSync(path.join(OUT_PUBLIC, "index.md"), md, "utf8");

  // ai-site/llms.txt is the source of published /llms.txt (fields, examples, cadence).
  const llmsSrc = path.join(SITE, "llms.txt");
  if (!fs.existsSync(llmsSrc)) {
    console.error("[export-games] missing source", llmsSrc);
    process.exit(1);
  }
  fs.copyFileSync(llmsSrc, path.join(OUT_PUBLIC, "llms.txt"));
  const spec = openApiDocument();
  writeJson(path.join(OUT_PUBLIC, "openapi.json"), spec);
  writeJson(path.join(OUT_PUBLIC, "v1", "openapi.json"), spec);
}

function aliasLang(text) {
  const s = String(text || "");
  if (/[\uac00-\ud7a3]/.test(s)) return "ko";
  if (/[\u3040-\u30ff]/.test(s)) return "ja";
  if (/[\u4e00-\u9fff]/.test(s)) return "zh";
  return "en";
}

function buildCatalogAliases(games, asOf) {
  const ids = new Set(games.map((g) => g.id));
  const aliases = {};
  const add = (key, entry) => {
    const k = String(key || "").replace(/\s+/g, " ").trim();
    if (!k || !entry || !entry.id) return;
    if (!ids.has(entry.id)) {
      console.error(`[export-games] catalog alias ${JSON.stringify(k)} unknown id ${entry.id}`);
      process.exit(1);
    }
    const prev = aliases[k];
    if (prev && prev.id !== entry.id) {
      console.error(
        `[export-games] catalog alias conflict ${JSON.stringify(k)} -> ${prev.id} vs ${entry.id}`
      );
      process.exit(1);
    }
    if (!prev) {
      const row = { id: entry.id };
      if (entry.name) row.name = entry.name;
      if (entry.lang) row.lang = entry.lang;
      aliases[k] = row;
    }
  };

  if (fs.existsSync(ALIAS_SRC)) {
    const src = readJson(ALIAS_SRC);
    for (const [key, entry] of Object.entries(src.aliases || {})) {
      add(key, entry);
    }
  }

  for (const g of games) {
    add(g.name, { id: g.id, name: g.name, lang: aliasLang(g.name) });
    if (g.name_zh) add(g.name_zh, { id: g.id, name: g.name, lang: aliasLang(g.name_zh) });
  }

  const keys = Object.keys(aliases).sort((a, b) => a.localeCompare(b, "en"));
  const out = {};
  for (const k of keys) out[k] = aliases[k];
  return {
    as_of: asOf,
    timezone: "Asia/Shanghai",
    note: "Nickname → catalog id. Resolve: look up the alias key, read id, then GET /v1/games/{id}.json. Character nicknames stay on /v1/guides/{game}/aliases.json. Not a second catalog.",
    count: keys.length,
    aliases: out,
  };
}

function main() {
  const asOf = shanghaiDate();
  const games = loadGames();
  if (!games.length) {
    console.error("[export-games] no games in", GAMES_DIR);
    process.exit(1);
  }

  rmrf(OUT_V1);
  rmrf(OUT_HTML);
  rmrf(path.join(OUT_PUBLIC, "en", "games"));
  rmrf(path.join(OUT_PUBLIC, "ja", "games"));
  mkdirp(OUT_V1);
  mkdirp(OUT_HTML);
  mkdirp(OUT_SCHEMA);

  // copy schemas (all, including new game/feed)
  if (fs.existsSync(SCHEMA_SRC)) {
    for (const f of fs.readdirSync(SCHEMA_SRC).filter((x) => x.endsWith(".json"))) {
      fs.copyFileSync(path.join(SCHEMA_SRC, f), path.join(OUT_SCHEMA, f));
    }
  }

  const summaries = [];
  for (const g of games) {
    // stamp as_of on export if missing
    const card = {
      ...g,
      as_of: g.as_of || asOf,
      timezone: "Asia/Shanghai",
      stub: g.stub !== false,
      watchlist: !!g.watchlist,
    };
    writeJson(path.join(OUT_V1, `${card.id}.json`), card);

    const platforms = (card.platforms || []).map((p) => `<span class="tag">${esc(p)}</span>`).join("");
    const tags = (card.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const sources = (card.sources || [])
      .map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label || s.url)}</a></li>`)
      .join("\n");
    for (const lang of ["zh-CN", "en", "ja"]) {
      withLang(lang, () => {
        const guideHref = card.guides_path ? localizePath(card.guides_path.endsWith("/") ? card.guides_path : `${card.guides_path}/`) : "";
        const guides = card.guides_path
          ? `<p>${esc(tx("攻略：", "Guides: ", "ガイド："))}<a href="${esc(guideHref || card.guides_path)}">${esc(card.guides_path)}</a></p>`
          : "";
        const shown = lang === "zh-CN" ? card.name_zh || card.name : displayGameName(card) || card.name;
        const pathname = localizePath(`/games/${card.id}.html`);
        const title = `${shown} · game-intel`;
        const description = tx(
          `${shown} 的静态身份页。平台、标签和出处来自已发布数据，不编造评分或价格。`,
          `${shown}: static identity page. Platforms, tags, and sources come from published data. No invented scores or prices.`,
          `${shown} の静的な身元ページ。プラットフォーム、タグ、出典は公開データ。点数や価格は作らない。`
        );
        const otherName = [card.name_zh, card.name]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .find((value) => value && value !== shown);
        const metaBits = [otherName ? esc(otherName) : "", card.watchlist ? "<strong>watchlist</strong>" : ""].filter(Boolean).join(" · ");
        const body = `<p><a href="${esc(localizePath("/"))}">${esc(tx("首页", "Home", "ホーム"))}</a> · <a href="${esc(localizePath("/catalog/"))}">${esc(tx("目录", "Catalog", "カタログ"))}</a> · <a href="${esc(localizePath("/watchlist/"))}">${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</a> · <a href="./index.html">${esc(tx("静态目录", "Static index", "静的索引"))}</a></p>
<h1>${esc(shown)} <code>${esc(card.id)}</code></h1>
${metaBits ? `<p class="meta">${metaBits}</p>` : ""}
<p class="${card.stub ? "stub" : "rich"}">${esc(card.stub ? tx("stub — 仅身份与真实链接，无编造评分", "stub — identity and real links only, no invented scores", "stub。身元と実在のリンクだけ。点数は作らない") : tx("非 stub — 有攻略覆盖", "Not a stub — guides exist", "stub ではない。ガイドがある"))}</p>
<p>${esc(tx("平台：", "Platforms: ", "プラットフォーム："))}${platforms || "—"}</p>
<p>${esc(tx("标签：", "Tags: ", "タグ："))}${tags || "—"}</p>
${card.steam_appid != null ? `<p>Steam AppID：<code>${esc(card.steam_appid)}</code></p>` : ""}
${guides}
<h2>${esc(tx("来源", "Sources", "出典"))}</h2>
${sources ? `<ul>${sources}</ul>` : "<p class=\"meta\">no sources</p>"}
${card.note ? `<p class="meta">${esc(card.note)}</p>` : ""}
<p class="meta">JSON: <a href="/v1/games/${esc(card.id)}.json"><code>/v1/games/${esc(card.id)}.json</code></a></p>`;
        const dir = gamesDir(lang);
        mkdirp(dir);
        fs.writeFileSync(
          path.join(dir, `${card.id}.html`),
          htmlPage(
            pathname,
            title,
            description,
            [
              { name: tx("首页", "Home", "ホーム"), path: localizePath("/") },
              { name: tx("游戏目录", "Games", "ゲーム"), path: localizePath("/games/") },
              { name: shown, path: pathname },
            ],
            body,
            card
          ),
          "utf8"
        );
      });
    }

    summaries.push({
      id: card.id,
      name: card.name,
      name_zh: card.name_zh || undefined,
      platforms: card.platforms || [],
      tags: card.tags || [],
      stub: card.stub,
      watchlist: card.watchlist,
      steam_appid: card.steam_appid ?? null,
      path: `games/${card.id}`,
    });
  }

  const index = {
    as_of: asOf,
    timezone: "Asia/Shanghai",
    note: "Game entity catalog (separate from character guides). stub:true = identity+links only (name, platforms, tags, sources, steam_appid); character cards only for watchlist games. Never invent Metacritic/prices/player counts. If unverified, say 未见可靠出处.",
    count: summaries.length,
    watchlist_count: summaries.filter((s) => s.watchlist).length,
    stub_count: summaries.filter((s) => s.stub).length,
    games: summaries,
  };
  writeJson(path.join(OUT_V1, "index.json"), index);
  writeJson(path.join(GAMES_DIR, "index.json"), index);

  // Human directory
  const rows = summaries
    .map((s) => {
      const cls = s.stub ? "stub" : "rich";
      const wl = s.watchlist ? "yes" : "";
      return `<tr class="${s.watchlist ? "wl" : ""}"><td><a href="${esc(s.id)}.html">${esc(s.id)}</a></td><td>${esc(s.name)}</td><td>${esc(s.name_zh || "")}</td><td class="${cls}">${s.stub ? "stub" : "guides"}</td><td>${wl}</td></tr>`;
    })
    .join("\n");
  for (const lang of ["zh-CN", "en", "ja"]) {
    withLang(lang, () => {
      const pathname = localizePath("/games/");
      const title = tx("game-intel 游戏目录", "game-intel games", "game-intel ゲーム");
      const description = tx(
        "静态游戏目录。身份和链接来自已发布数据。",
        "Static game directory. Identity and links come from published data.",
        "静的なゲーム目録。身元とリンクは公開データ。"
      );
      const body = `<h1>${esc(tx("游戏目录 Games", "Games", "ゲーム"))}</h1>
<p class="meta">as_of ${esc(asOf)} · ${summaries.length} games · watchlist ${index.watchlist_count} · stub ${index.stub_count}</p>
<p>AI index: <a href="/v1/games/index.json"><code>/v1/games/index.json</code></a> · Feed: <a href="/v1/feed.json"><code>/v1/feed.json</code></a></p>
<p><a href="${esc(localizePath("/"))}">${esc(tx("人类首页", "Home", "ホーム"))}</a> · <a href="${esc(localizePath("/catalog/"))}">${esc(tx("目录检索", "Catalog", "カタログ"))}</a> · <a href="${esc(localizePath("/watchlist/"))}">${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</a> · <a href="${esc(localizePath("/guides/index.html"))}">${esc(tx("攻略 Guides", "Guides", "ガイド"))}</a></p>
<table><thead><tr><th>id</th><th>name</th><th>${esc(tx("中文", "中文", "中文"))}</th><th>status</th><th>watchlist</th></tr></thead><tbody>
${rows}
</tbody></table>`;
      const dir = gamesDir(lang);
      mkdirp(dir);
      fs.writeFileSync(
        path.join(dir, "index.html"),
        htmlPage(
          pathname,
          title,
          description,
          [
            { name: tx("首页", "Home", "ホーム"), path: localizePath("/") },
            { name: tx("游戏目录", "Games", "ゲーム"), path: pathname },
          ],
          body
        ),
        "utf8"
      );
    });
  }

  const feed = buildFeed(games, asOf);
  writeJson(FEED_OUT, feed);
  const catalogAliases = buildCatalogAliases(games, asOf);
  writeJson(ALIAS_OUT, catalogAliases);

  writeHomePages(games, feed, asOf);
  buildLocalizedSite(OUT_PUBLIC, SITE);

  // Keep root ai-site copies in sync for editors
  for (const f of ["index.html", "index.md"]) {
    const src = path.join(OUT_PUBLIC, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(SITE, f));
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        as_of: asOf,
        count: summaries.length,
        watchlist: index.watchlist_count,
        stub: index.stub_count,
        feed_items: feed.meta.count,
        catalog_aliases: catalogAliases.count,
        ids: summaries.map((s) => s.id),
        out_v1: OUT_V1,
        out_html: OUT_HTML,
        feed: FEED_OUT,
      },
      null,
      2
    )
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
