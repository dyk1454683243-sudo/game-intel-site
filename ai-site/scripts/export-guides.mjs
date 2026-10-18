#!/usr/bin/env node
/**
 * Export data/guides → ai-site/public (JSON for AI + simple HTML for humans).
 * Dual publish from one source of truth.
 */
import "./require-node22.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpSources } from "../../mcp-server/scripts/guide-conclusion.mjs";
import { portraitTarget } from "../public/ui/portrait.js";
import { teamLines } from "../public/ui/render.js";
import { displayCharacterName, displayGameName, getLang, localizePath, tx, withLang } from "../public/ui/i18n.js";
import { staticDocument } from "../public/ui/seo.js";
import { buildLocalizedSite } from "./site-seo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const GUIDES = path.join(DATA, "guides");
const OUT_V1 = path.join(SITE, "public", "v1", "guides");
const OUT_PUBLIC = path.join(SITE, "public");
const OUT_HTML = path.join(OUT_PUBLIC, "guides");
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
  "reverse-1999": { name: "Reverse: 1999", name_zh: "重返未来：1999" },
  "arknights-endfield": { name: "Arknights: Endfield", name_zh: "明日方舟：终末地" },
  "limbus-company": { name: "Limbus Company", name_zh: "边狱公司" },
  "zenless-zone-zero": { name: "Zenless Zone Zero", name_zh: "绝区零" },
  "wuthering-waves": { name: "Wuthering Waves", name_zh: "鸣潮" },
};

/** Games whose non-stub cards must carry a conclusion (`summary`) row. */
const CONCLUSION_GAMES = new Set(["hw", "nikke", "bd2", "reverse-1999", "arknights-endfield", "limbus-company", "zenless-zone-zero", "wuthering-waves"]);

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

function htmlPage(pathname, title, description, crumbs, body) {
  return staticDocument({
    lang: getLang(),
    title,
    description,
    pathname,
    crumbs,
    body,
  });
}

function guideDir(lang, game) {
  if (lang === "zh-CN") return game ? path.join(OUT_HTML, game) : OUT_HTML;
  const prefix = lang === "ja" ? "ja" : "en";
  return game ? path.join(OUT_PUBLIC, prefix, "guides", game) : path.join(OUT_PUBLIC, prefix, "guides");
}


function validatePortrait(c) {
  const errors = [];
  if (c.portrait == null || c.portrait === "") {
    if (c.portrait_source != null || c.portrait_via != null) {
      errors.push("portrait citation set without a portrait url");
    }
    return errors;
  }
  if (!portraitTarget(c.portrait)) errors.push("portrait url is not an allowed public image");
  if (typeof c.portrait_source !== "string" || !/^https:\/\/\S+$/.test(c.portrait_source)) {
    errors.push("portrait_source must be an https URL");
  }
  if (typeof c.portrait_via !== "string" || !c.portrait_via.trim()) {
    errors.push("portrait_via must name the field the URL came from");
  }
  return errors;
}

function validateCard(game, c) {
  const errors = [...validatePortrait(c)];
  if (isStub(c)) return errors;
  const srcs = httpSources(c);
  if (!srcs.length) errors.push("non-stub card missing https sources");
  if (typeof c.as_of !== "string" || !c.as_of.trim()) errors.push("non-stub card missing as_of");
  if (!CONCLUSION_GAMES.has(game)) return errors;
  const s = c.summary;
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    errors.push("missing summary conclusion");
    return errors;
  }
  const ss = Array.isArray(s.sources) ? s.sources.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)) : [];
  if (!ss.length) errors.push("summary.sources missing https URLs");
  if (s.stub === true) {
    if (!String(s.caveat || s.skip || "").trim()) errors.push("stub conclusion needs caveat");
  } else if (!String(s.tier || "").trim() && !String(s.pull || "").trim()) {
    errors.push("non-stub conclusion needs tier or pull from a real source");
  }
  return errors;
}

function conclusionBar(c) {
  const s = c && c.summary && typeof c.summary === "object" ? c.summary : null;
  if (!s) return "";
  const tier = s.tier || "";
  const position = s.position || "";
  const pull = s.pull || "";
  const skip = s.skip || "";
  const caveat = s.caveat || "";
  const srcs = Array.isArray(s.sources) && s.sources.length ? s.sources : httpSources(c);
  if (!tier && !position && !pull && !skip && !caveat && !srcs.length) return "";
  const rows = [];
  if (s.stub === true) rows.push(`<dt>${esc(tx("完整度", "Completeness", "完全さ"))}</dt><dd class="stub">${esc(tx("结论不完整（stub）", "Conclusion incomplete (stub)", "結論は未完（stub）"))}</dd>`);
  if (tier) rows.push(`<dt>${esc(tx("强度", "Strength", "強度"))}</dt><dd>${esc(tier)}</dd>`);
  if (position) rows.push(`<dt>${esc(tx("定位", "Position", "役割"))}</dt><dd>${esc(position)}</dd>`);
  if (pull) rows.push(`<dt>${esc(tx("抽不抽", "Pull note", "引くかどうか"))}</dt><dd>${esc(pull)}</dd>`);
  if (skip) rows.push(`<dt>${esc(tx("别追什么", "Skip", "追わない"))}</dt><dd>${esc(skip)}</dd>`);
  if (caveat) rows.push(`<dt>${esc(tx("说明", "Note", "説明"))}</dt><dd>${esc(caveat)}</dd>`);
  if (srcs.length) {
    const links = srcs
      .map((u, i) => `<li><a href="${esc(u)}" rel="noopener">${esc(tx(`出处${i + 1}`, `Source ${i + 1}`, `出典${i + 1}`))}</a></li>`)
      .join("");
    rows.push(`<dt>${esc(tx("出处", "Sources", "出典"))}</dt><dd><ul class="srcs">${links}</ul></dd>`);
  }
  return `<section class="conclusion" aria-label="${esc(tx("结论", "Conclusion", "結論"))}">
<h2>${esc(tx("结论", "Conclusion", "結論"))}</h2>
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
  const partNames = new Set(
    [...(aliases._parts || []), ...(aliases._meta?.parts || [])].filter((x) => typeof x === "string")
  );
  for (const f of fs.existsSync(path.join(GUIDES, game))
    ? fs.readdirSync(path.join(GUIDES, game)).filter((x) => /^aliases\.p\d+\.json$/.test(x))
    : []) {
    partNames.add(f);
  }
  for (const part of partNames) {
    const src = path.join(GUIDES, game, part);
    if (!fs.existsSync(src) || !part.endsWith(".json") || part.includes("/") || part.includes("..")) continue;
    fs.copyFileSync(src, path.join(gameOut, path.basename(part)));
  }

  // dopamine / modes
  const dopaSrc = path.join(GUIDES, game, "dopamine-auto.json");
  if (fs.existsSync(dopaSrc)) {
    const dopa = readJson(dopaSrc);
    writeJson(path.join(gameOut, "dopamine-auto.json"), dopa);
    mkdirp(path.join(gameOut, "modes"));
    writeJson(path.join(gameOut, "modes", "dopamine-auto.json"), dopa);
  }
  for (const extra of ["banners.json", "codes.json"]) {
    const extraSrc = path.join(GUIDES, game, extra);
    if (fs.existsSync(extraSrc)) writeJson(path.join(gameOut, extra), readJson(extraSrc));
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
  let conclusionStub = 0;
  const indexChars = [];
  const problems = [];
  for (const c of chars) {
    const stubFlag = isStub(c);
    if (stubFlag) stub++;
    else rich++;
    const errs = validateCard(game, c);
    if (errs.length) problems.push({ id: c.id, errs });
    if (!stubFlag && c.summary?.stub === true) conclusionStub++;
    writeJson(path.join(gameOut, "characters", `${c.id}.json`), c);
    const indexRow = {
      id: c.id,
      name: c.name,
      name_zh: c.name_zh || c.name,
      stub: stubFlag,
      sources: c.sources || [],
    };
    if (CONCLUSION_GAMES.has(game)) {
      indexRow.portrait = typeof c.portrait === "string" && c.portrait ? c.portrait : null;
    }
    if (c.sinner && typeof c.sinner === "object" && c.sinner.id) {
      indexRow.sinner = {
        id: c.sinner.id,
        name_en: c.sinner.name_en || "",
        name_zh: c.sinner.name_zh || "",
        order: Number(c.sinner.order) || 0,
      };
    }
    if (c.rarity) indexRow.rarity = c.rarity;
    indexChars.push(indexRow);
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
    conclusion_stub_count: conclusionStub,
  };
  const guideLinks = {};
  for (const name of ["banners", "codes"]) {
    if (fs.existsSync(path.join(GUIDES, game, `${name}.json`))) {
      guideLinks[name] = `/v1/guides/${game}/${name}.json`;
    }
  }
  if (Object.keys(guideLinks).length) gameIndex.links = guideLinks;
  gameIndex.characters = indexChars;
  if (problems.length) {
    const err = new Error(
      `[export-guides] ${game}: ${problems.length} card(s) failed sources/as_of/conclusion checks`
    );
    err.problems = problems.slice(0, 20);
    throw err;
  }
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
  writeGuideIndex(game, meta, asOf, chars, rich, stub, rows);

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
    writeCharacterPage(game, meta, c, skills, sources);
  }

  return gameIndex;
}

function homeCrumb() {
  return { name: tx("首页", "Home", "ホーム"), path: localizePath("/") };
}

function guideCrumb() {
  return { name: tx("攻略", "Guides", "ガイド"), path: localizePath("/guides/") };
}

function gameCrumb(game, meta) {
  const name = getLang() === "zh-CN" ? meta.name_zh : displayGameName({ id: game, name: meta.name, name_zh: meta.name_zh });
  return { name, path: localizePath(`/guides/${game}/`) };
}

function writeGuideIndex(game, meta, asOf, chars, rich, stub, rows) {
  const langs = ["zh-CN", "en", "ja"];
  for (const lang of langs) {
    withLang(lang, () => {
      const pathname = localizePath(`/guides/${game}/`);
      const titleName = lang === "zh-CN" ? meta.name_zh : displayGameName({ id: game, name: meta.name, name_zh: meta.name_zh });
      const title = tx(`${meta.name_zh} 攻略索引`, `${meta.name} guides`, `${meta.name} ガイド`);
      const description = tx(
        `${meta.name_zh} 的角色索引。技能和结论保持已发布原文。`,
        `Character index for ${meta.name}. Skills and conclusions stay in the published language.`,
        `${meta.name} のキャラ索引。スキルと結論は公開された原文のまま。`
      );
      const body = `<p><a href="${esc(localizePath("/"))}">${esc(tx("首页", "Home", "ホーム"))}</a> · <a href="${esc(localizePath("/watchlist/"))}">${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</a></p>
<h1>${esc(titleName)} <span class="meta">(${esc(meta.name)})</span></h1>
<p class="meta">as_of ${esc(asOf)} · ${chars.length} characters · rich ${rich} / stub ${stub}</p>
<p>AI JSON: <a href="/v1/guides/${esc(game)}/index.json"><code>/v1/guides/${esc(game)}/index.json</code></a>${["banners.json", "codes.json"]
        .filter((name) => fs.existsSync(path.join(GUIDES, game, name)))
        .map((name) => ` · <a href="/v1/guides/${esc(game)}/${name}"><code>${name}</code></a>`)
        .join("")}</p>
<table><thead><tr><th>id</th><th>name</th><th>status</th></tr></thead><tbody>
${rows || "<tr><td colspan=3>no cards yet — fill when verified</td></tr>"}
</tbody></table>`;
      const dir = guideDir(lang, game);
      mkdirp(dir);
      fs.writeFileSync(
        path.join(dir, "index.html"),
        htmlPage(pathname, title, description, [homeCrumb(), guideCrumb(), gameCrumb(game, meta)], body),
        "utf8"
      );
    });
  }
}

function writeCharacterPage(game, meta, c, skills, sources) {
  for (const lang of ["zh-CN", "en", "ja"]) {
    withLang(lang, () => {
      const shown = lang === "zh-CN" ? c.name : displayCharacterName(c) || c.name;
      const gameLabel = lang === "zh-CN" ? meta.name_zh : displayGameName({ id: game, name: meta.name, name_zh: meta.name_zh });
      const pathname = localizePath(`/guides/${game}/${c.id}.html`);
      const title = `${shown} · ${gameLabel}`;
      const description = tx(
        `${shown}（${gameLabel}）。技能、结论和配队保持已发布原文。`,
        `${shown} (${gameLabel}). Skills, conclusions, and teams stay in the published language.`,
        `${shown}（${gameLabel}）。スキル、結論、編成は公開された原文のまま。`
      );
      const body = `<p><a href="${esc(localizePath("/"))}">${esc(tx("首页", "Home", "ホーム"))}</a> · <a href="${esc(localizePath("/watchlist/"))}">${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</a> · <a href="${esc(localizePath(`/character/?game=${encodeURIComponent(game)}&id=${encodeURIComponent(c.id)}`))}">${esc(tx("人类界面", "Human page", "人のページ"))}</a> · <a href="${esc(localizePath(`/compare/?add=${encodeURIComponent(`${game}:${c.id}`)}`))}">${esc(tx("加入对比", "Add to compare", "比較に入れる"))}</a> · <a href="./index.html">← ${esc(gameLabel)}</a></p>
<h1>${esc(shown)} <code>${esc(c.id)}</code></h1>
<p class="${isStub(c) ? "stub" : "rich"}">${esc(isStub(c) ? tx("stub card — skills not verified yet", "stub card — skills not verified yet", "stub。スキルは未確認") : tx("verified card", "verified card", "確認済みのカード"))}</p>
${conclusionBar(c)}
${c.role ? `<p>${esc(tx("定位：", "Role: ", "役割："))}${esc(c.role)}</p>` : ""}
${c.note ? `<p class="meta">${esc(c.note)}</p>` : ""}
<h2>${esc(tx("技能", "Skills", "スキル"))}</h2>
${skills ? `<ul>${skills}</ul>` : `<p class="stub">${esc(tx("（无 — 勿编造）", "(none — do not invent)", "（なし。作らない）"))}</p>`}
${c.skill_prio?.length ? `<h2>${esc(tx("加点优先级", "Skill priority", "スキル優先度"))}</h2><ol>${c.skill_prio.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
${teamLines(c).length ? `<h2>${esc(tx("配队", "Teams", "編成"))}</h2><ul>${teamLines(c).map((row) => `<li><strong>${esc(row.label)}</strong> ${esc(row.text)}</li>`).join("")}</ul>` : ""}
${c.stigmata ? `<h2>${esc(tx("圣痕", "Stigmata", "聖痕"))}</h2><pre>${esc(JSON.stringify(c.stigmata, null, 2))}</pre>` : ""}
<h2>${esc(tx("来源", "Sources", "出典"))}</h2>
${sources ? `<ul>${sources}</ul>` : `<p class="meta">${esc(tx("no sources yet", "no sources yet", "出典はまだない"))}</p>`}
<p class="meta">JSON: <a href="/v1/guides/${esc(game)}/characters/${esc(c.id)}.json"><code>/v1/guides/${esc(game)}/characters/${esc(c.id)}.json</code></a></p>`;
      const dir = guideDir(lang, game);
      mkdirp(dir);
      fs.writeFileSync(
        path.join(dir, `${c.id}.html`),
        htmlPage(pathname, title, description, [homeCrumb(), guideCrumb(), gameCrumb(game, meta), { name: shown, path: pathname }], body),
        "utf8"
      );
    });
  }
}

function writeGuidesHome(summaries, asOf) {
  for (const lang of ["zh-CN", "en", "ja"]) {
    withLang(lang, () => {
      const pathname = localizePath("/guides/");
      const title = tx("game-intel 攻略索引", "game-intel guides", "game-intel ガイド");
      const description = tx(
        "角色攻略索引。技能和结论保持已发布原文。",
        "Character guide index. Skills and conclusions stay in the published language.",
        "キャラガイドの索引。スキルと結論は公開された原文のまま。"
      );
      const body = `<h1>${esc(tx("攻略 Guides", "Guides", "ガイド"))}</h1>
<p class="meta">as_of ${esc(asOf)} Asia/Shanghai</p>
<p>AI index: <a href="/v1/guides/index.json"><code>/v1/guides/index.json</code></a> · <a href="${esc(localizePath("/"))}">${esc(tx("人类首页", "Home", "ホーム"))}</a> · <a href="${esc(localizePath("/watchlist/"))}">${esc(tx("观察名单", "Watchlist", "ウォッチリスト"))}</a></p>
<ul>
${summaries
  .map((s) => {
    const label = lang === "zh-CN" ? s.name_zh : s.name;
    return `<li><a href="./${esc(s.game)}/index.html"><strong>${esc(label)}</strong></a> (${esc(s.game)}) — ${s.character_count} chars (rich ${s.rich_count} / stub ${s.stub_count})</li>`;
  })
  .join("\n")}
</ul>
<p>${esc(tx(
        "规则：每个 watchlist 游戏最终都要有 data/guides/{game}/；人读 HTML 与 AI JSON 同源导出；未核实技能一律 stub:true。",
        "Every watchlist game ends up with data/guides/{game}/. Human HTML and AI JSON come from the same export. Unverified skills stay stub:true.",
        "ウォッチリストの各ゲームは data/guides/{game}/ を持つ。人の HTML と AI JSON は同じ書き出し。未確認のスキルは stub:true。"
      ))}</p>`;
      const dir = guideDir(lang, "");
      mkdirp(dir);
      fs.writeFileSync(
        path.join(dir, "index.html"),
        htmlPage(pathname, title, description, [homeCrumb(), guideCrumb()], body),
        "utf8"
      );
    });
  }
}

function preflight() {
  const problems = [];
  for (const game of listGames()) {
    for (const c of loadChars(game)) {
      const errs = validateCard(game, c);
      if (errs.length) problems.push({ game, id: c.id, errs });
    }
  }
  if (!problems.length) return;
  console.error(
    JSON.stringify({ ok: false, check: "sources+as_of+conclusion", problems: problems.slice(0, 30), count: problems.length }, null, 2)
  );
  process.exit(1);
}

function main() {
  preflight();
  const asOf = shanghaiDate();
  rmrf(OUT_V1);
  rmrf(OUT_HTML);
  rmrf(path.join(OUT_PUBLIC, "en", "guides"));
  rmrf(path.join(OUT_PUBLIC, "ja", "guides"));
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

  writeGuidesHome(summaries, asOf);
  buildLocalizedSite(OUT_PUBLIC, SITE);

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
          conclusion_stub: s.conclusion_stub_count,
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
