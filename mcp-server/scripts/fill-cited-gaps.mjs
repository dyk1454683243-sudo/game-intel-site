#!/usr/bin/env node
/**
 * Fill empty teams and rating stubs from pages that already name the roster
 * or the grade. Does not clear existing teams or non-stub conclusions.
 *
 *   node mcp-server/scripts/fill-cited-gaps.mjs
 *   node mcp-server/scripts/fill-cited-gaps.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acceptRoster, formatRosterLine, indexBySlug, teamsEmpty } from "./cited-teams.mjs";
import {
  parseLimbusTeamBoxes,
  parseNikkeTeams,
  parseUpdated,
  parseWuwaRatings,
  parseWuwaTeams,
  parseZzzRatings,
  wuwaTierLine,
  zzzTierLine,
} from "./cited-gap-parse.mjs";
import { conclusionFromCard } from "./guide-conclusion.mjs";
import { fetchWiki } from "./enrich-bd2-cards.js";
import { matchCostumeReview, bd2AtlasCostumeGrades } from "./watchlist-parse.mjs";
import {
  HW_MODE_KEYS,
  HW_TITLE_ALIAS,
  cardsMentioned,
  matchCardByTitle,
  nodeText,
  normName,
  parseCharacterFolds,
  parseContentNodes,
  parseModeTable,
  sectionParagraphs,
  sectionTeamLines,
  teamSentences,
} from "./team-build-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const CACHE = "/tmp/cited-gaps";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const GK = "https://www.gamekee.com";
const HW_SKIP = new Set([641248, 668272]);

function curl(url, headers = []) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-L", "--max-time", "45", "-A", UA, ...headers.flatMap((header) => ["-H", header]), url];
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(Buffer.concat(err).toString("utf8") || `curl_${code}`));
      else resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

async function pool(items, limit, fn) {
  const ret = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      ret[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return ret;
}

function loadCards(game) {
  const dir = path.join(DATA, "guides", game, "characters");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const cardPath = path.join(dir, file);
      return { path: cardPath, card: JSON.parse(fs.readFileSync(cardPath, "utf8")) };
    });
}

function displayName(card) {
  return String(card?.name || card?.name_zh || "").trim();
}

function ownersOf(cards) {
  const owners = new Map();
  for (const card of cards) {
    const name = displayName(card);
    if (!name) continue;
    if (!owners.has(name)) owners.set(name, new Set());
    owners.get(name).add(card.id);
  }
  return owners;
}

function shanghaiDate(unixSeconds) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(unixSeconds) * 1000));
}

function addSource(card, url) {
  if (!url) return;
  if (!Array.isArray(card.sources)) card.sources = [];
  if (!card.sources.includes(url)) card.sources.push(url);
  if (card.summary && Array.isArray(card.summary.sources) && !card.summary.sources.includes(url)) {
    card.summary.sources.push(url);
  }
}

function lineFor(roster, cards, owners) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const names = [];
  for (const id of roster.members) {
    const card = byId.get(id);
    const name = card && displayName(card);
    const set = name ? owners.get(name) : null;
    if (!card || !name || !set || set.size !== 1) return "";
    names.push(name);
  }
  return formatRosterLine(roster, names);
}

function applyRosters(cards, rosters, { limit = 2 } = {}) {
  const owners = ownersOf(cards);
  const touched = [];
  for (const card of cards) {
    if (!teamsEmpty(card)) continue;
    const ranked = rosters
      .filter((roster) => Array.isArray(roster.members) && roster.members.includes(card.id))
      .map((roster) => ({ ...roster, score: (roster.score || 0) + (roster.owner === card.id ? 1000 : 0) }))
      .sort((a, b) => b.score - a.score || String(a.source).localeCompare(String(b.source)));
    const chosen = [];
    const seen = new Set();
    for (const roster of ranked) {
      const key = [...roster.members].sort().join("|");
      if (seen.has(key)) continue;
      const line = lineFor(roster, cards, owners);
      if (!line) continue;
      seen.add(key);
      chosen.push({ roster, line });
      if (chosen.length >= limit) break;
    }
    if (!chosen.length) continue;
    if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
    card.teams.comp = chosen.map((row) => row.line);
    for (const row of chosen) addSource(card, row.roster.source);
    touched.push(card.id);
  }
  return touched;
}

async function jina(url, cacheName, { needUpdated = true } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, cacheName);
  const usable = (body) => {
    if (!body || body.length < 8000) return false;
    if (body.includes("Just a moment")) return false;
    if (needUpdated && !body.includes("Last updated")) return false;
    return true;
  };
  if (fs.existsSync(file)) {
    const cached = fs.readFileSync(file, "utf8");
    if (usable(cached)) return cached;
  }
  let body = "";
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      body = await curl(`https://r.jina.ai/${url}`, ["X-Return-Format: html", "X-Target-Selector: body", "Accept: text/html"]);
      last = body;
      if (usable(body)) break;
    } catch (err) {
      last = String(err.message || err);
    }
  }
  if (body) fs.writeFileSync(file, body);
  return usable(body) ? body : "";
}

function teamScore(header, primaryOnly) {
  let score = 80;
  if (/best/i.test(header)) score = 300;
  else if (/alternative|quickswap|premium/i.test(header)) score = 200;
  else if (/budget|f2p|low cost|free/i.test(header)) score = 150;
  if (!primaryOnly) score += 15;
  return score;
}

function wwRoster(card, team, asOf) {
  return {
    owner: card.id,
    members: null,
    slugs: team.slugs,
    label: team.primaryOnly ? `Prydwen · ${team.header} 主位` : `Prydwen · ${team.header}`,
    source: `https://www.prydwen.gg/wuthering-waves/characters/${card.prydwen_slug || card.id}`,
    asOf,
    score: teamScore(team.header, team.primaryOnly),
  };
}

function ratingRows(parsed) {
  return parsed.rows.map((row) => {
    const next = {
      role: parsed.value && !/value/i.test(row.role) ? `${row.role} Value` : row.role,
    };
    if (row.tower) next.tower = row.tower;
    if (row.whimpering) next.whimpering = row.whimpering;
    if (parsed.value) next.value = true;
    return next;
  });
}

function fillWwRating(card, html) {
  if (!card.summary || card.summary.stub !== true) return false;
  const parsed = parseWuwaRatings(html);
  const line = wuwaTierLine(parsed);
  const asOf = parseUpdated(html);
  if (!line || !asOf) return false;
  const url = `https://www.prydwen.gg/wuthering-waves/characters/${card.prydwen_slug || card.id}`;
  card.summary.tier = line;
  card.summary.stub = false;
  card.summary.caveat = parsed.value
    ? "主梯度在抓到的页面里没有单独的 T 级，这一行只摘同页 Value 梯度，并标明 Value。不把它当成主梯度。不编造抽卡结论。"
    : "强度摘自该角色 Prydwen 页 Ratings（编辑向，非官方）。页面没写出的那一栏不补。不编造抽卡结论。";
  if (!Array.isArray(card.summary.sources)) card.summary.sources = [];
  if (!card.summary.sources.includes(url)) card.summary.sources.unshift(url);
  card.ratings = { checked: true, as_of: asOf, url, rows: ratingRows(parsed) };
  addSource(card, url);
  return true;
}

function fillZzzRating(card, html) {
  if (card.summary && card.summary.stub !== true) return false;
  const rows = parseZzzRatings(html);
  const line = zzzTierLine(rows);
  const asOf = parseUpdated(html);
  if (!line || !asOf) return false;
  const url = `https://www.prydwen.gg/zenless/characters/${card.prydwen_slug || card.id}`;
  if (!card.summary || typeof card.summary !== "object") {
    card.summary = { sources: [url], position: [card.rarity, card.element, card.role, card.faction].filter(Boolean).join(" / ") };
  }
  card.summary.tier = line;
  card.summary.stub = false;
  card.summary.caveat =
    "强度摘自该角色 Prydwen 页 Ratings（编辑向，非官方）。只收录页面写明的栏目，不把 Endgame Modes 拆成别的模式，也不编造抽卡结论。";
  if (!Array.isArray(card.summary.sources)) card.summary.sources = [];
  if (!card.summary.sources.includes(url)) card.summary.sources.unshift(url);
  card.ratings = {
    checked: true,
    as_of: asOf,
    url,
    rows: rows.map((row) => ({ role: row.role, modes: row.modes })),
  };
  addSource(card, url);
  return true;
}

async function gamekeeDetail(alias, contentId) {
  const file = path.join(CACHE, `gk-${alias}-${contentId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const body = await curl(`${GK}/v1/content/detail/${contentId}`, [
    "Accept: application/json",
    `game-alias: ${alias}`,
    `Referer: ${GK}/`,
  ]);
  const detail = JSON.parse(body);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(detail));
  return detail;
}

function detailNodes(detail) {
  const data = detail?.data || {};
  let nodes = data.content_json;
  if (typeof nodes === "string" && nodes.trim()) nodes = JSON.parse(nodes);
  if (Array.isArray(nodes) && nodes.length) return nodes;
  return [];
}

async function detailParagraphs(alias, contentId) {
  const detail = await gamekeeDetail(alias, contentId);
  let nodes = detailNodes(detail);
  if (!nodes.length && detail?.data?.content_cdn) {
    let cdn = detail.data.content_cdn;
    if (cdn.startsWith("//")) cdn = `https:${cdn}`;
    const packed = JSON.parse(await curl(cdn, [`Referer: ${GK}/`]));
    nodes = parseContentNodes(packed.content);
  }
  return {
    detail,
    paragraphs: nodes.map(nodeText).filter(Boolean),
    nodes,
    asOf: detail?.data?.updated_at ? shanghaiDate(detail.data.updated_at) : "",
  };
}

function cite(line, url, asOf) {
  const text = String(line || "").trim();
  if (!text || !/^https?:\/\//.test(url) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "";
  if (text.includes(url)) return text;
  return `${text}（${url} ，as_of ${asOf}）`;
}

function explicitTrios(paragraphs) {
  const out = [];
  for (const raw of paragraphs) {
    const line = String(raw || "").replace(/\s+/g, " ").trim();
    if (!line.includes("+") || !/[配队：:]/.test(line)) continue;
    const splitAt = line.includes("：") ? line.indexOf("：") : line.indexOf(":");
    const prefix = line.slice(0, splitAt).replace(/\s+/g, "").slice(0, 12);
    const body = line.slice(splitAt + 1);
    if (/\/|或|任意|替换/.test(body)) continue;
    const names = body
      .split("+")
      .map((part) => part.replace(/（[^）]*）/g, "").trim())
      .filter(Boolean);
    if (names.length !== 3 || names.some((name) => name.length < 2 || name.length > 16)) continue;
    out.push({ prefix: prefix || "配队", names });
  }
  return out;
}

function matchExact(token, cards) {
  const key = normName(token);
  if (!key) return null;
  const hits = cards.filter((card) =>
    [card.name, card.name_zh, ...(card.aliases || [])].some((name) => name && normName(name) === key)
  );
  const ids = [...new Set(hits.map((card) => card.id))];
  return ids.length === 1 ? ids[0] : null;
}

async function main() {
  const write = process.argv.includes("--write");
  fs.mkdirSync(CACHE, { recursive: true });
  const report = { write };

  const wwRows = loadCards("wuthering-waves");
  const wwCards = wwRows.map((row) => row.card);
  const wwIndex = indexBySlug(wwCards);
  const wwBefore = new Map(wwCards.filter((card) => card.summary && card.summary.stub !== true).map((card) => [card.id, card.summary.tier || ""]));
  let wwDone = 0;
  const wwHtml = new Map();
  await pool(wwCards, 6, async (card) => {
    const slug = card.prydwen_slug || card.id;
    const html = await jina(`https://www.prydwen.gg/wuthering-waves/characters/${slug}`, `ww-${slug}.html`);
    wwHtml.set(card.id, html);
    wwDone += 1;
    if (wwDone % 15 === 0) console.error(`wuwa pages ${wwDone}/${wwCards.length}`);
  });
  const wwRosters = [];
  let wwRatingFilled = [];
  const wwMismatch = [];
  for (const card of wwCards) {
    const html = wwHtml.get(card.id) || "";
    if (!html) continue;
    if (card.summary && card.summary.stub !== true) {
      const line = wuwaTierLine(parseWuwaRatings(html));
      if (line && wwBefore.get(card.id) && line !== wwBefore.get(card.id)) {
        wwMismatch.push({ id: card.id, card: wwBefore.get(card.id), page: line });
      }
    } else if (fillWwRating(card, html)) wwRatingFilled.push(card.id);
    const asOf = parseUpdated(html);
    if (!asOf) continue;
    for (const team of parseWuwaTeams(html)) {
      const members = acceptRoster(team.slugs, wwIndex, { size: 3 });
      if (!members || !members.includes(card.id)) continue;
      const roster = wwRoster(card, team, asOf);
      roster.members = members;
      wwRosters.push(roster);
    }
  }
  const wwTeamFilled = applyRosters(wwCards, wwRosters);

  const packed = await detailParagraphs("mc", 623202);
  const gkRosters = [];
  for (const trio of explicitTrios(packed.paragraphs)) {
    const members = trio.names.map((name) => matchExact(name, wwCards));
    if (members.some((id) => !id) || new Set(members).size !== 3) continue;
    gkRosters.push({
      owner: "",
      members,
      label: `GameKee · ${trio.prefix}`,
      source: `${GK}/mc/623202.html`,
      asOf: packed.asOf,
      score: 40,
    });
  }
  const wwGkFilled = applyRosters(wwCards, gkRosters);

  const zzzRows = loadCards("zenless-zone-zero");
  const zzzCards = zzzRows.map((row) => row.card);
  let zzzDone = 0;
  const zzzFilled = [];
  const zzzMiss = [];
  await pool(
    zzzCards.filter((card) => !card.summary || card.summary.stub === true),
    6,
    async (card) => {
      const slug = card.prydwen_slug || card.id;
      const html = await jina(`https://www.prydwen.gg/zenless/characters/${slug}`, `zzz-${slug}.html`);
      if (html && fillZzzRating(card, html)) zzzFilled.push(card.id);
      else {
        zzzMiss.push(card.id);
        const checked = html ? parseUpdated(html) : "";
        if (html && checked && card.summary?.stub === true && !zzzTierLine(parseZzzRatings(html))) {
          const note = `${checked} 复核该角色 Prydwen 页，Ratings 没有写出 T 档。`;
          if (!String(card.summary.caveat || "").includes(note)) {
            card.summary.caveat = `${String(card.summary.caveat || "").trim()} ${note}不编造。`.trim();
          }
        }
      }
      zzzDone += 1;
      if (zzzDone % 15 === 0) console.error(`zzz pages ${zzzDone}`);
    }
  );

  const nikkeRows = loadCards("nikke");
  const nikkeCards = nikkeRows.map((row) => row.card);
  const nikkeIndex = indexBySlug(nikkeCards);
  const nikkeEmpty = nikkeCards.filter((card) => teamsEmpty(card) && card.prydwen_slug);
  const nikkeRosters = [];
  const nikkeChecked = shanghaiDate(Date.now() / 1000);
  let nkDone = 0;
  await pool(nikkeEmpty, 6, async (card) => {
    const html = await jina(`https://www.prydwen.gg/nikke/characters/${card.prydwen_slug}`, `nikke-${card.prydwen_slug}.html`, {
      needUpdated: false,
    });
    const asOf = html ? parseUpdated(html) || nikkeChecked : "";
    if (html && asOf) {
      for (const team of parseNikkeTeams(html)) {
        const members = acceptRoster(team.slugs, nikkeIndex, { size: 5 });
        if (!members) continue;
        nikkeRosters.push({
          owner: card.id,
          members,
          label: ["Prydwen", team.mode, team.element, team.title].filter(Boolean).join(" · "),
          source: `https://www.prydwen.gg/nikke/characters/${card.prydwen_slug}`,
          asOf,
          score: /boss/i.test(team.mode) ? 200 : 120,
        });
      }
    }
    nkDone += 1;
    if (nkDone % 15 === 0) console.error(`nikke pages ${nkDone}/${nikkeEmpty.length}`);
  });
  const nikkeFilled = applyRosters(nikkeCards, nikkeRosters);

  const limbusHtml = await jina("https://www.prydwen.gg/limbus-company/team-database/", "limbus-teams.html", { needUpdated: false });
  const limbusRows = loadCards("limbus-company");
  const limbusCards = limbusRows.map((row) => row.card);
  const limbusBySlug = new Map(limbusCards.filter((card) => card.prydwen_slug).map((card) => [card.prydwen_slug, card.id]));
  const limbusRosters = [];
  const limbusTeams = limbusHtml ? parseLimbusTeamBoxes(limbusHtml) : [];
  const limbusAsOf = parseUpdated(limbusHtml);
  limbusTeams.forEach((team, index) => {
    const members = [];
    for (const slug of team.slugs) {
      const id = limbusBySlug.get(slug);
      if (!id || members.includes(id)) return;
      members.push(id);
    }
    if (!limbusAsOf) return;
    limbusRosters.push({
      owner: "",
      members,
      label: `Prydwen · ${team.title}`,
      source: "https://www.prydwen.gg/limbus-company/team-database/",
      asOf: limbusAsOf,
      score: 500 - index,
    });
  });
  const limbusFilled = applyRosters(limbusCards, limbusRosters, { limit: 2 });

  const hwRows = loadCards("hw");
  const hwCards = hwRows.map((row) => row.card);
  const hwById = new Map(hwCards.map((card) => [card.id, card]));
  const hwStrength = await detailParagraphs("hw", 665170);
  const hwUrl = `${GK}/hw/665170.html`;
  const hwModeFilled = [];
  for (const row of parseModeTable(hwStrength.nodes)) {
    const id = matchCardByTitle(row.name, hwCards, HW_TITLE_ALIAS);
    const card = id && hwById.get(id);
    if (!card || !teamsEmpty(card)) continue;
    card.teams = {};
    let changed = false;
    for (const key of HW_MODE_KEYS) {
      if (row.fit[key] === "√" || row.fit[key] === "×") {
        card.teams[key] = row.fit[key];
        changed = true;
      }
    }
    if (!changed) continue;
    addSource(card, hwUrl);
    hwModeFilled.push(card.id);
  }
  const hwComp = [];
  for (const block of parseCharacterFolds(hwStrength.nodes)) {
    const id = matchCardByTitle(block.name, hwCards, HW_TITLE_ALIAS);
    const card = id && hwById.get(id);
    if (!card || (card.teams && Array.isArray(card.teams.comp) && card.teams.comp.length)) continue;
    const lines = [];
    for (const text of block.lines.flatMap((line) => teamSentences(line))) {
      const ids = [...new Set(cardsMentioned(text, hwCards).map((hit) => hit.id))];
      if (!ids.includes(card.id) || ids.length < 2) continue;
      const cited = cite(text, hwUrl, hwStrength.asOf);
      if (cited) lines.push(cited);
      if (lines.length >= 2) break;
    }
    if (!lines.length) continue;
    if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
    card.teams.comp = lines;
    addSource(card, hwUrl);
    hwComp.push(card.id);
  }
  const hwEntries = JSON.parse(
    fs.existsSync(path.join(CACHE, "entries-hw.json"))
      ? fs.readFileSync(path.join(CACHE, "entries-hw.json"), "utf8")
      : await curl(`${GK}/v1/entry/list?page_no=1&limit=2000`, ["Accept: application/json", "game-alias: hw", `Referer: ${GK}/`])
  );
  if (!fs.existsSync(path.join(CACHE, "entries-hw.json"))) {
    const raw = typeof hwEntries === "string" ? hwEntries : JSON.stringify(hwEntries);
    fs.writeFileSync(path.join(CACHE, "entries-hw.json"), typeof hwEntries === "string" ? hwEntries : JSON.stringify(JSON.parse(raw).data || hwEntries));
  }
  const hwEntryRows = Array.isArray(hwEntries) ? hwEntries : hwEntries.data || JSON.parse(fs.readFileSync(path.join(CACHE, "entries-hw.json"), "utf8"));
  const hwReviewFilled = [];
  for (const review of hwEntryRows.filter((row) => row?.content_id && /测评/.test(String(row.name || "")) && !HW_SKIP.has(Number(row.content_id)))) {
    const id = matchCardByTitle(review.name, hwCards, HW_TITLE_ALIAS);
    const card = id && hwById.get(id);
    if (!card || (Array.isArray(card.teams?.comp) && card.teams.comp.length)) continue;
    let packedReview;
    try {
      packedReview = await detailParagraphs("hw", review.content_id);
    } catch {
      continue;
    }
    const blob = `${packedReview.detail?.data?.title || ""} ${packedReview.detail?.data?.summary || ""}`;
    if (/请不要参考|暂不参考/.test(blob)) continue;
    const url = `${GK}/hw/${review.content_id}.html`;
    const lines = sectionTeamLines(sectionParagraphs(packedReview.nodes, /配队/), hwCards, card.id)
      .map((line) => cite(line, url, packedReview.asOf))
      .filter(Boolean)
      .slice(0, 2);
    if (!lines.length) continue;
    if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
    card.teams.comp = lines;
    addSource(card, url);
    hwReviewFilled.push(card.id);
  }

  const bd2Rows = loadCards("bd2");
  const bd2Cards = bd2Rows.map((row) => row.card);
  const bd2ById = new Map(bd2Cards.map((card) => [card.id, card]));
  const bd2EntryBody = fs.existsSync(path.join(CACHE, "entries-zsca2.json"))
    ? fs.readFileSync(path.join(CACHE, "entries-zsca2.json"), "utf8")
    : await curl(`${GK}/v1/entry/list?page_no=1&limit=2000`, ["Accept: application/json", "game-alias: zsca2", `Referer: ${GK}/`]);
  if (!fs.existsSync(path.join(CACHE, "entries-zsca2.json"))) {
    const parsed = JSON.parse(bd2EntryBody);
    fs.writeFileSync(path.join(CACHE, "entries-zsca2.json"), JSON.stringify(parsed.data || []));
  }
  const bd2Entries = JSON.parse(fs.readFileSync(path.join(CACHE, "entries-zsca2.json"), "utf8"));
  const bd2TeamFilled = [];
  const seenReview = new Set();
  for (const review of bd2Entries.filter((row) => row?.content_id && /测评/.test(String(row.name || "")))) {
    if (seenReview.has(review.content_id)) continue;
    seenReview.add(review.content_id);
    const id = matchCostumeReview(String(review.name || ""), "", bd2Cards);
    const card = id && bd2ById.get(id);
    if (!card || !teamsEmpty(card)) continue;
    let packedReview;
    try {
      packedReview = await detailParagraphs("zsca2", review.content_id);
    } catch {
      continue;
    }
    const url = `${GK}/zsca2/${review.content_id}.html`;
    const lines = [];
    for (const paragraph of packedReview.paragraphs) {
      for (const sentence of teamSentences(paragraph)) {
        const ids = [...new Set(cardsMentioned(sentence, bd2Cards).map((hit) => hit.id))];
        if (!ids.includes(card.id) || ids.length < 2) continue;
        const cited = cite(sentence, url, packedReview.asOf);
        if (cited) lines.push(cited);
      }
    }
    const unique = [...new Set(lines)].slice(0, 2);
    if (!unique.length) continue;
    card.teams = { comp: unique };
    addSource(card, url);
    bd2TeamFilled.push(card.id);
  }
  const bd2RatingFilled = [];
  for (const card of bd2Cards) {
    if (Array.isArray(card.costume_ratings) && card.costume_ratings.length) continue;
    if (!card.gamekee_content_id) continue;
    const caveat = String(card.summary?.caveat || "");
    const wantsAtlas = card.summary?.stub === true || /单元格为空|没有书面 T 档/.test(caveat);
    if (!wantsAtlas && Array.isArray(card.costume_ratings)) continue;
    let grades = [];
    try {
      const wiki = fetchWiki(card.gamekee_content_id);
      grades = Array.isArray(wiki.costume_grades) ? wiki.costume_grades : bd2AtlasCostumeGrades(wiki.styleData);
    } catch {
      continue;
    }
    if (!grades.length) continue;
    const source = `${GK}/zsca2/${card.gamekee_content_id}.html`;
    card.costume_ratings = grades.map((item) => ({
      label: item.label,
      tier: item.tier,
      source,
      kind: "atlas",
      content_id: Number(card.gamekee_content_id),
      ...(item.pull ? { pull: item.pull } : {}),
    }));
    if (wantsAtlas) {
      const rebuilt = conclusionFromCard({ ...card, summary: { ...(card.summary || {}), stub: true } });
      if (rebuilt && rebuilt.tier && rebuilt.stub === false) card.summary = rebuilt;
    }
    addSource(card, source);
    bd2RatingFilled.push(card.id);
  }

  function ids(cards, pred) {
    return cards.filter(pred).map((card) => card.id);
  }
  report.wuthering_waves = {
    pages: [...wwHtml.values()].filter(Boolean).length,
    rating_filled: wwRatingFilled,
    team_filled: [...new Set([...wwTeamFilled, ...wwGkFilled])],
    gamekee_fallback: wwGkFilled,
    prydwen_rosters: wwRosters.length,
    gamekee_rosters: gkRosters.length,
    rating_mismatch_kept: wwMismatch.slice(0, 12),
    still_empty: ids(wwCards, teamsEmpty),
    still_rating_stub: ids(wwCards, (card) => card.summary?.stub === true),
  };
  report.zenless = {
    rating_filled: zzzFilled,
    still_rating_stub: ids(zzzCards, (card) => !card.summary || card.summary.stub === true),
    missed_pages: zzzMiss.filter((id) => !zzzFilled.includes(id)),
  };
  report.nikke = {
    pages: nikkeEmpty.length,
    rosters: nikkeRosters.length,
    team_filled: nikkeFilled,
    still_empty: ids(nikkeCards, teamsEmpty),
    no_slug: ids(nikkeCards, (card) => teamsEmpty(card) && !card.prydwen_slug),
  };
  report.limbus = {
    html_bytes: limbusHtml.length,
    parsed_teams: limbusTeams.length,
    team_filled: limbusFilled,
    still_empty: ids(limbusCards, teamsEmpty).length,
  };
  report.hw = {
    mode_filled: hwModeFilled,
    comp_filled: [...new Set([...hwComp, ...hwReviewFilled])],
    still_empty: ids(hwCards, teamsEmpty),
    still_rating_stub: ids(hwCards, (card) => card.summary?.stub === true),
  };
  report.bd2 = {
    team_filled: bd2TeamFilled,
    rating_filled: bd2RatingFilled,
    still_empty: ids(bd2Cards, teamsEmpty),
    still_without_costume_ratings: ids(bd2Cards, (card) => !Array.isArray(card.costume_ratings) || !card.costume_ratings.length),
  };
  report.muyingying = "no_card";

  const groups = [
    ["wuthering-waves", wwRows],
    ["zenless-zone-zero", zzzRows],
    ["nikke", nikkeRows],
    ["limbus-company", limbusRows],
    ["hw", hwRows],
    ["bd2", bd2Rows],
  ];
  let written = 0;
  for (const [, rows] of groups) {
    for (const row of rows) {
      const before = fs.readFileSync(row.path, "utf8");
      const next = `${JSON.stringify(row.card, null, 2)}\n`;
      if (next === before) continue;
      written += 1;
      if (write) fs.writeFileSync(row.path, next);
    }
  }
  report.written = written;
  console.log(JSON.stringify(report, null, 2));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
