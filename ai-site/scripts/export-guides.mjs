#!/usr/bin/env node
/**
 * Export data/guides → ai-site/public (JSON for AI + simple HTML for humans).
 * Dual publish from one source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const GUIDES = path.join(DATA, "guides");
const OUT_V1 = path.join(SITE, "public", "v1", "guides");
const OUT_HTML = path.join(SITE, "public", "guides");
const OUT_SCHEMA = path.join(SITE, "public", "schema");
const SCHEMA_SRC = path.join(SITE, "schema");

const WATCH = {
  hw: { name: "Horizon Walker", name_zh: "地平线行者" },
  nikke: { name: "NIKKE", name_zh: "胜利女神：NIKKE" },
  bd2: { name: "Brown Dust 2", name_zh: "棕色尘埃2" },
  star: { name: "Azure Star Origin", name_zh: "蓝色星原：旅谣" },
  asora: { name: "Astrae Oratio", name_zh: "阿索拉：星之祈愿" },
  miraesi: { name: "Invisible Future", name_zh: "미래시" },
  lo2: { name: "Last Origin 2", name_zh: "Last Origin 2" },
};

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
function isStub(c) {
  if (!c) return true;
  if (c.stub === true) return true;
  if (c.stub === false) return false;
  return !(Array.isArray(c.skills) && c.skills.length > 0);
}
function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function listGames() {
  if (!fs.existsSync(GUIDES)) return Object.keys(WATCH);
  const dirs = fs
    .readdirSync(GUIDES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return [...new Set([...Object.keys(WATCH), ...dirs])].sort();
}

function loadChars(game) {
  const dir = path.join(GUIDES, game, "characters");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const card = readJson(path.join(dir, f));
      return { ...card, id: card.id || f.replace(/\.json$/, "") };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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
    .conclusion{background:#f7fafc;border:1px solid #c8d6e5;border-radius:8px;padding:.75rem 1rem;margin:1rem 0}
    .conclusion h2{font-size:1rem;margin:0 0 .5rem;color:#234}
    .conclusion dl{margin:0;display:grid;grid-template-columns:5.5em 1fr;gap:.35rem .75rem}
    .conclusion dt{font-weight:600;color:#456}
    .conclusion dd{margin:0}
    .conclusion .srcs{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.35rem .75rem}
    .conclusion .srcs a{font-size:.85rem}
  </style>
</head>
<body>
${body}
<hr/>
<p class="meta">game-intel guides · Asia/Shanghai · dual-publish from <code>data/guides/</code></p>
</body>
</html>
`;
}


function conclusionBar(c) {
  const s = c && c.summary && typeof c.summary === "object" ? c.summary : null;
  if (!s) return "";
  const tier = s.tier || c.role || "";
  const pull = s.pull || "";
  const skip = s.skip || s.caveat || "";
  const srcs = Array.isArray(s.sources) && s.sources.length
    ? s.sources
    : Array.isArray(c.sources)
      ? c.sources
      : [];
  if (!tier && !pull && !skip && !srcs.length) return "";
  const rows = [];
  if (tier) rows.push(`<dt>强度</dt><dd>${esc(tier)}</dd>`);
  if (pull) rows.push(`<dt>抽不抽</dt><dd>${esc(pull)}</dd>`);
  if (skip) rows.push(`<dt>别追什么</dt><dd>${esc(skip)}</dd>`);
  if (srcs.length) {
    const links = srcs
      .map((u, i) => `<li><a href="${esc(u)}" rel="noopener">出处${i + 1}</a></li>`)
      .join("");
    rows.push(`<dt>出处</dt><dd><ul class="srcs">${links}</ul></dd>`);
  }
  return `<section class="conclusion" aria-label="结论">
<h2>结论</h2>
<dl>
${rows.join("\n")}
</dl>
</section>`;
}

function exportGame(game, asOf) {
  const meta = WATCH[game] || { name: game, name_zh: game };
  const chars = loadChars(game);
  const gameOut = path.join(OUT_V1, game);
  mkdirp(path.join(gameOut, "characters"));
  mkdirp(path.join(OUT_HTML, game));

  // aliases
  const aliasesPath = path.join(GUIDES, game, "aliases.json");
  let aliases = { _meta: { game, as_of: asOf }, aliases: {} };
  if (fs.existsSync(aliasesPath)) aliases = readJson(aliasesPath);
  writeJson(path.join(gameOut, "aliases.json"), aliases);

  // dopamine / modes
  const dopaSrc = path.join(GUIDES, game, "dopamine-auto.json");
  if (fs.existsSync(dopaSrc)) {
    const dopa = readJson(dopaSrc);
    writeJson(path.join(gameOut, "dopamine-auto.json"), dopa);
    mkdirp(path.join(gameOut, "modes"));
    writeJson(path.join(gameOut, "modes", "dopamine-auto.json"), dopa);
  }
  const modesDir = path.join(GUIDES, game, "modes");
  if (fs.existsSync(modesDir)) {
    mkdirp(path.join(gameOut, "modes"));
    for (const f of fs.readdirSync(modesDir).filter((x) => x.endsWith(".json"))) {
      writeJson(path.join(gameOut, "modes", f), readJson(path.join(modesDir, f)));
    }
  }

  let rich = 0;
  let stub = 0;
  const indexChars = [];
  for (const c of chars) {
    const stubFlag = isStub(c);
    if (stubFlag) stub++;
    else rich++;
    writeJson(path.join(gameOut, "characters", `${c.id}.json`), c);
    indexChars.push({
      id: c.id,
      name: c.name,
      name_zh: c.name_zh || c.name,
      stub: stubFlag,
      sources: c.sources || [],
    });
  }

  const gameIndex = {
    game,
    name: meta.name,
    name_zh: meta.name_zh,
    as_of: asOf,
    timezone: "Asia/Shanghai",
    character_count: chars.length,
    rich_count: rich,
    stub_count: stub,
    characters: indexChars,
  };
  writeJson(path.join(gameOut, "index.json"), gameIndex);

  // Human HTML list
  const rows = indexChars
    .map((c) => {
      const cls = c.stub ? "stub" : "rich";
      const label = c.stub ? "stub" : "rich";
      const href = `${esc(c.id)}.html`;
      return `<tr><td><a href="${href}">${esc(c.id)}</a></td><td>${esc(c.name)}</td><td class="${cls}">${label}</td></tr>`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(OUT_HTML, game, "index.html"),
    htmlPage(
      `${meta.name_zh} 攻略索引`,
      `<h1>${esc(meta.name_zh)} <span class="meta">(${esc(meta.name)})</span></h1>
<p class="meta">as_of ${esc(asOf)} · ${chars.length} characters · rich ${rich} / stub ${stub}</p>
<p>AI JSON: <a href="/v1/guides/${esc(game)}/index.json"><code>/v1/guides/${esc(game)}/index.json</code></a></p>
<table><thead><tr><th>id</th><th>name</th><th>status</th></tr></thead><tbody>
${rows || "<tr><td colspan=3>no cards yet — fill when verified</td></tr>"}
</tbody></table>`
    ),
    "utf8"
  );

  // Sample / all character HTML (keep light)
  for (const c of chars) {
    const skills = (c.skills || [])
      .map(
        (s) =>
          `<li><strong>${esc(s.name)}</strong>${s.type ? ` <code>${esc(s.type)}</code>` : ""}${s.summary ? ` — ${esc(s.summary)}` : ""}</li>`
      )
      .join("\n");
    const sources = (c.sources || [])
      .map((u) => `<li><a href="${esc(u)}">${esc(u)}</a></li>`)
      .join("\n");
    const body = `<p><a href="./index.html">← ${esc(meta.name_zh)}</a></p>
<h1>${esc(c.name)} <code>${esc(c.id)}</code></h1>
<p class="${isStub(c) ? "stub" : "rich"}">${isStub(c) ? "stub card — skills not verified yet" : "verified card"}</p>
${conclusionBar(c)}
${c.role ? `<p>定位：${esc(c.role)}</p>` : ""}
${c.note ? `<p class="meta">${esc(c.note)}</p>` : ""}
<h2>技能</h2>
${skills ? `<ul>${skills}</ul>` : "<p class=\"stub\">（无 — 勿编造）</p>"}
${c.skill_prio?.length ? `<h2>加点优先级</h2><ol>${c.skill_prio.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
${c.stigmata ? `<h2>圣痕</h2><pre>${esc(JSON.stringify(c.stigmata, null, 2))}</pre>` : ""}
<h2>来源</h2>
${sources ? `<ul>${sources}</ul>` : "<p class=\"meta\">no sources yet</p>"}
<p class="meta">JSON: <a href="/v1/guides/${esc(game)}/characters/${esc(c.id)}.json"><code>/v1/guides/${esc(game)}/characters/${esc(c.id)}.json</code></a></p>`;
    fs.writeFileSync(
      path.join(OUT_HTML, game, `${c.id}.html`),
      htmlPage(`${c.name} · ${meta.name_zh}`, body),
      "utf8"
    );
  }

  return gameIndex;
}

function main() {
  const asOf = shanghaiDate();
  rmrf(OUT_V1);
  rmrf(OUT_HTML);
  mkdirp(OUT_V1);
  mkdirp(OUT_HTML);
  mkdirp(OUT_SCHEMA);

  // copy schemas
  if (fs.existsSync(SCHEMA_SRC)) {
    for (const f of fs.readdirSync(SCHEMA_SRC).filter((x) => x.endsWith(".json"))) {
      fs.copyFileSync(path.join(SCHEMA_SRC, f), path.join(OUT_SCHEMA, f));
    }
  }

  const games = listGames();
  const summaries = [];
  for (const g of games) {
    summaries.push(exportGame(g, asOf));
  }

  const index = {
    as_of: asOf,
    timezone: "Asia/Shanghai",
    note: "Every watchlist game gets guides/{game}; human HTML + AI JSON from the same export. Never invent skill names/numbers; stub:true until GameKee/Bahamut verified.",
    games: summaries.map((s) => ({
      id: s.game,
      name: s.name,
      name_zh: s.name_zh,
      character_count: s.character_count,
      rich_count: s.rich_count,
      stub_count: s.stub_count,
      path: `guides/${s.game}`,
    })),
  };
  writeJson(path.join(OUT_V1, "index.json"), index);
  writeJson(path.join(GUIDES, "index.json"), index);

  fs.writeFileSync(
    path.join(OUT_HTML, "index.html"),
    htmlPage(
      "game-intel 攻略索引",
      `<h1>攻略 Guides</h1>
<p class="meta">as_of ${esc(asOf)} Asia/Shanghai</p>
<p>AI index: <a href="/v1/guides/index.json"><code>/v1/guides/index.json</code></a></p>
<ul>
${summaries
  .map(
    (s) =>
      `<li><a href="./${esc(s.game)}/index.html"><strong>${esc(s.name_zh)}</strong></a> (${esc(s.game)}) — ${s.character_count} chars (rich ${s.rich_count} / stub ${s.stub_count})</li>`
  )
  .join("\n")}
</ul>
<p>规则：每个 watchlist 游戏最终都要有 <code>data/guides/{game}/</code>；人读 HTML 与 AI JSON 同源导出；未核实技能一律 <code>stub:true</code>。</p>`
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        as_of: asOf,
        games: summaries.map((s) => ({
          id: s.game,
          chars: s.character_count,
          rich: s.rich_count,
          stub: s.stub_count,
        })),
        out_v1: OUT_V1,
        out_html: OUT_HTML,
      },
      null,
      2
    )
  );
}

main();
