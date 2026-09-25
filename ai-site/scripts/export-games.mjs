#!/usr/bin/env node
/**
 * Export data/games → ai-site/public (JSON for AI + simple HTML for humans).
 * Also builds /v1/feed.json from real digest/radar items (never invents headlines).
 * Dual publish from one source of truth — separate from character guides.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111}
    a{color:#06c} code{background:#f4f4f4;padding:.1em .35em;border-radius:4px}
    .stub{color:#a60}.rich{color:#070} ul{padding-left:1.2rem}
    .meta{color:#666;font-size:.9rem} table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #ddd;padding:.4rem .55rem;text-align:left}
    .tag{display:inline-block;background:#eef2f7;border-radius:4px;padding:.05em .4em;margin:0 .2em .2em 0;font-size:.85rem}
    .wl{font-weight:600}
  </style>
</head>
<body>
${body}
<hr/>
<p class="meta">game-intel games · Asia/Shanghai · dual-publish from <code>data/games/</code></p>
</body>
</html>
`;
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

function writeHomePages(games, feed, asOf) {
  const wl = games.filter((g) => g.watchlist);
  const rest = games.filter((g) => !g.watchlist);
  const feedLi = (feed.items || [])
    .slice(0, 12)
    .map((it) => {
      const gid = it.game_id ? ` <code>${esc(it.game_id)}</code>` : "";
      const src = it.source ? ` · ${esc(it.source)}` : "";
      return `<li><a href="${esc(it.url)}" rel="noopener">${esc(it.title)}</a>${gid}<span class="meta">${src}</span></li>`;
    })
    .join("\n");

  const gameLi = (list) =>
    list
      .map((g) => {
        const zh = g.name_zh ? ` · ${esc(g.name_zh)}` : "";
        const badge = g.watchlist ? ' <span class="tag wl">watchlist</span>' : "";
        const stub = g.stub ? ' <span class="stub">stub</span>' : ' <span class="rich">guides</span>';
        return `<li><a href="/games/${esc(g.id)}.html"><strong>${esc(g.name)}</strong></a>${zh}${badge}${stub}</li>`;
      })
      .join("\n");

  const body = `<h1>game-intel · 泛游戏目录</h1>
<p class="meta">as_of ${esc(asOf)} Asia/Shanghai · ${games.length} games · feed ${feed.meta.count} items</p>
<p>AI JSON：
  <a href="/v1/games/index.json"><code>/v1/games/index.json</code></a> ·
  <a href="/v1/feed.json"><code>/v1/feed.json</code></a> ·
  <a href="/v1/guides/index.json"><code>/v1/guides/index.json</code></a>
</p>

<h2>情报 Feed</h2>
${feedLi ? `<ul>${feedLi}</ul>` : "<p class=\"meta\">暂无真实条目（未编造标题）</p>"}
<p class="meta">完整 JSON：<a href="/v1/feed.json"><code>/v1/feed.json</code></a></p>

<h2>每日 Watchlist</h2>
<ul>${gameLi(wl)}</ul>

<h2>目录 · Steam / Indie / AAA stubs</h2>
<ul>${gameLi(rest)}</ul>

<h2>角色攻略 Guides</h2>
<p><a href="/guides/index.html">攻略索引</a>（HW / NIKKE / BD2 等）— 与游戏目录分离，同源 dual-publish。</p>

<p class="meta">规则：不编造评分/在线人数/Metacritic；stub 仅身份+真实链接。</p>`;

  fs.writeFileSync(
    path.join(OUT_PUBLIC, "index.html"),
    htmlPage("game-intel · 泛游戏目录", body),
    "utf8"
  );

  // Also keep a markdown overview for agents
  const md = `# game-intel · 泛游戏目录 / Game Catalog

**中文：** 泛游戏站 first cut — 游戏实体目录 + 情报 feed + 既有角色攻略。时区 Asia/Shanghai。
**EN:** Game entity catalog + cross-platform feed + existing character guides. Dual-publish (human HTML + AI JSON).

## Endpoints

| Path | Description |
|------|-------------|
| \`/v1/games/index.json\` | Game catalog index (${games.length}+) |
| \`/v1/games/{id}.json\` | Single game entity |
| \`/v1/feed.json\` | Recent intel items (real only) |
| \`/games/index.html\` | Human game directory |
| \`/games/{id}.html\` | Game detail |
| \`/v1/guides/index.json\` | Character guide coverage |
| \`/guides/*.html\` | Human Chinese guide pages |
| \`/v1/watchlist.json\` | Dai daily watchlist |
| \`/v1/digest.json\` | Per-game digest |
| \`/v1/calendar.json\` / \`calendar-hw.json\` | Calendar |
| \`/v1/radar.json\` | New-game radar |
| \`/schema/*.schema.json\` | JSON Schema draft-07 |
| \`/llms.txt\` | Agent discovery map |

## Rules

- Never invent Metacritic / prices / player counts.
- \`stub: true\` = identity + real links only.
- Watchlist games first on human pages.
- Guides remain under \`/guides/*\` and \`/v1/guides/*\` (unchanged contract).
`;
  fs.writeFileSync(path.join(OUT_PUBLIC, "index.md"), md, "utf8");

  const llms = `# game-intel AI site (game catalog + guides + live intel)

Machine-readable endpoints. Timezone: Asia/Shanghai.
Game entities dual-published from plugin \`data/games/\`.
Guide cards dual-published from \`data/guides/\`.
\`v1/digest|radar|calendar-hw\` from best-effort MCP/CLI export.

## Endpoints

- /v1/games/index.json — game catalog index
- /v1/games/{id}.json — single game entity
- /v1/feed.json — cross-platform recent intel (real items only)
- /games/index.html — human Chinese game directory
- /games/{id}.html — game detail
- /v1/watchlist.json — watched games
- /v1/digest.json — per-game digest headlines
- /v1/calendar.json — upcoming events calendar
- /v1/calendar-hw.json — HW calendar (live export)
- /v1/radar.json — new-game radar
- /v1/guides/index.json — guide coverage per watchlist game
- /v1/guides/{game}/index.json — character list for a game
- /v1/guides/{game}/aliases.json
- /v1/guides/{game}/characters/{id}.json
- /guides/index.html — human Chinese guide index
- /schema/game.schema.json
- /schema/games-index.schema.json
- /schema/feed.schema.json
- /schema/watchlist.schema.json
- /schema/digest.schema.json
- /schema/calendar.schema.json
- /schema/guides-index.schema.json
- /schema/character-card.schema.json
- /schema/aliases.schema.json
- /index.md — overview
- /llms.txt — this file

## Notes

- Content-Type: application/json for /v1/* and /schema/*
- No authentication
- Prefer JSON Schema draft-07 under /schema/
- Re-export: \`npm run export-guides && npm run export-games\`
- Never invent skill names/numbers or Metacritic/prices; stubs have \`"stub": true\`
`;
  fs.writeFileSync(path.join(OUT_PUBLIC, "llms.txt"), llms, "utf8");
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
    const guides =
      card.guides_path
        ? `<p>攻略：<a href="${esc(card.guides_path)}">${esc(card.guides_path)}</a></p>`
        : "";
    const body = `<p><a href="./index.html">← 游戏目录</a></p>
<h1>${esc(card.name_zh || card.name)} <code>${esc(card.id)}</code></h1>
<p class="meta">${esc(card.name)}${card.watchlist ? " · <strong>watchlist</strong>" : ""}</p>
<p class="${card.stub ? "stub" : "rich"}">${card.stub ? "stub — 仅身份与真实链接，无编造评分" : "非 stub — 有攻略覆盖"}</p>
<p>平台：${platforms || "—"}</p>
<p>标签：${tags || "—"}</p>
${card.steam_appid != null ? `<p>Steam AppID：<code>${esc(card.steam_appid)}</code></p>` : ""}
${guides}
<h2>来源</h2>
${sources ? `<ul>${sources}</ul>` : "<p class=\"meta\">no sources</p>"}
${card.note ? `<p class="meta">${esc(card.note)}</p>` : ""}
<p class="meta">JSON: <a href="/v1/games/${esc(card.id)}.json"><code>/v1/games/${esc(card.id)}.json</code></a></p>`;
    fs.writeFileSync(
      path.join(OUT_HTML, `${card.id}.html`),
      htmlPage(`${card.name_zh || card.name} · game-intel`, body),
      "utf8"
    );

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
    note: "Game entity catalog (separate from character guides). stub:true = identity+links only; never invent Metacritic/prices/player counts.",
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
  fs.writeFileSync(
    path.join(OUT_HTML, "index.html"),
    htmlPage(
      "game-intel 游戏目录",
      `<h1>游戏目录 Games</h1>
<p class="meta">as_of ${esc(asOf)} · ${summaries.length} games · watchlist ${index.watchlist_count} · stub ${index.stub_count}</p>
<p>AI index: <a href="/v1/games/index.json"><code>/v1/games/index.json</code></a> · Feed: <a href="/v1/feed.json"><code>/v1/feed.json</code></a></p>
<p><a href="/">← 首页</a> · <a href="/guides/index.html">攻略 Guides</a></p>
<table><thead><tr><th>id</th><th>name</th><th>中文</th><th>status</th><th>watchlist</th></tr></thead><tbody>
${rows}
</tbody></table>`
    ),
    "utf8"
  );

  const feed = buildFeed(games, asOf);
  writeJson(FEED_OUT, feed);

  writeHomePages(games, feed, asOf);

  // Keep root ai-site copies in sync for editors
  for (const f of ["index.html", "index.md", "llms.txt"]) {
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

main();
