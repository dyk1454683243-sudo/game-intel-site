#!/usr/bin/env node
/**
 * Fill teams / skill_prio from sentences GameKee or Nikke.gg already publish.
 * Does not invent partners, grades, or skill levels. Does not touch summary.stub or portraits.
 *
 * Usage:
 *   node mcp-server/scripts/fill-team-build.mjs [--write] [--only hw|nikke|bd2]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { matchCostumeReview } from "./watchlist-parse.mjs";
import {
  HW_MODE_KEYS,
  HW_TITLE_ALIAS,
  acceptProse,
  bd2Lines,
  cardsMentioned,
  clip,
  costumeInTitle,
  matchCardByTitle,
  nodeText,
  normName,
  noteClauses,
  notesFromGuide,
  parseCharacterFolds,
  parseContentNodes,
  parseModeTable,
  pushUnique,
  sectionParagraphs,
  sectionTeamLines,
  skillPrioFromNikke,
  teamSentences,
} from "./team-build-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const GK = "https://www.gamekee.com";
const CACHE = "/tmp/gk/fill-cache";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const DELAY_MS = 180;

const HW_STRENGTH = 665170;
const HW_SKIP_CONTENT = new Set([641248]);
const BD2_BEGINNER = 593518;
const NIKKE_TEAMS = 682131;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function curl(url, headers = []) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    "35",
    "-A",
    UA,
    "-H",
    "Accept: application/json,text/plain,*/*",
    "-H",
    `Referer: ${GK}/`,
    ...headers.flatMap((header) => ["-H", header]),
    url,
  ];
  const result = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`curl_${result.status}`);
  return result.stdout || "";
}

function curlJson(url, headers = []) {
  const body = curl(url, headers);
  if (body.startsWith("<!DOCTYPE") || body.startsWith("<html")) throw new Error("html_blocked");
  return JSON.parse(body);
}

function loadCards(game) {
  const dir = path.join(DATA, "guides", game, "characters");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const cardPath = path.join(dir, file);
      return { file, path: cardPath, card: JSON.parse(fs.readFileSync(cardPath, "utf8")) };
    });
}

function ensureTeams(card) {
  if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
  return card.teams;
}

function resetFilledTeams(card) {
  const prev = ensureTeams(card);
  const next = {};
  if (prev.dopamine_auto) next.dopamine_auto = prev.dopamine_auto;
  card.teams = next;
}

function addSource(card, url) {
  if (!url) return;
  if (!Array.isArray(card.sources)) card.sources = [];
  if (!card.sources.includes(url)) card.sources.push(url);
}

function addComp(card, line) {
  const text = String(line || "").trim();
  if (!text) return false;
  const teams = ensureTeams(card);
  const comp = Array.isArray(teams.comp) ? [...teams.comp] : [];
  const before = comp.length;
  pushUnique(comp, text, 3);
  if (comp.length === before) return false;
  teams.comp = comp;
  return true;
}

function addSkill(card, line) {
  const text = String(line || "").trim();
  if (!text) return false;
  const list = Array.isArray(card.skill_prio) ? [...card.skill_prio] : [];
  const before = list.length;
  pushUnique(list, text, list.length + 1);
  if (list.length === before) return false;
  if (list.length > 12) return false;
  card.skill_prio = list;
  return true;
}

async function cachedContent(contentId, alias) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${alias}-${contentId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const detail = curlJson(`${GK}/v1/content/detail/${contentId}`, [`game-alias: ${alias}`]);
  if (detail.code !== 0 || !detail.data) throw new Error(detail.msg || "detail_fail");
  let cdn = detail.data.content_cdn || "";
  if (!cdn) throw new Error("no_cdn");
  if (cdn.startsWith("//")) cdn = `https:${cdn}`;
  const body = curl(cdn);
  const parsed = JSON.parse(body);
  const packed = {
    title: detail.data.title || "",
    summary: detail.data.summary || "",
    content: parsed.content,
  };
  fs.writeFileSync(file, JSON.stringify(packed));
  await sleep(DELAY_MS);
  return packed;
}

function paragraphsOf(packed) {
  const nodes = parseContentNodes(packed.content);
  return nodes.map(nodeText).filter(Boolean);
}

function entryList(alias) {
  const file = path.join(CACHE, `entries-${alias}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const json = curlJson(`${GK}/v1/entry/list?page_no=1&limit=2000`, [`game-alias: ${alias}`]);
  const rows = Array.isArray(json.data) ? json.data : [];
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

async function applyHw(rows) {
  const cards = rows.map((row) => row.card);
  for (const card of cards) resetFilledTeams(card);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const touched = new Set();
  const mark = (card) => touched.add(card.id);

  const strength = await cachedContent(HW_STRENGTH, "hw");
  const strengthNodes = parseContentNodes(strength.content);
  const strengthUrl = `${GK}/hw/${HW_STRENGTH}.html`;
  for (const row of parseModeTable(strengthNodes)) {
    const id = matchCardByTitle(row.name, cards, HW_TITLE_ALIAS);
    const card = id && byId.get(id);
    if (!card) continue;
    const teams = ensureTeams(card);
    let changed = false;
    for (const key of HW_MODE_KEYS) {
      if (!row.fit[key] || teams[key]) continue;
      teams[key] = row.fit[key];
      changed = true;
    }
    if (changed) {
      addSource(card, strengthUrl);
      mark(card);
    }
  }
  for (const block of parseCharacterFolds(strengthNodes)) {
    const id = matchCardByTitle(block.name, cards, HW_TITLE_ALIAS);
    const card = id && byId.get(id);
    if (!card) continue;
    let added = 0;
    for (const line of block.lines) {
      for (const text of teamSentences(line)) {
        if (addComp(card, text)) added++;
        if (added >= 2) break;
      }
      if (added >= 2) break;
    }
    if (added) {
      addSource(card, strengthUrl);
      mark(card);
    }
  }

  const reviews = entryList("hw").filter(
    (row) => row?.content_id && /测评/.test(String(row.name || "")) && !HW_SKIP_CONTENT.has(Number(row.content_id))
  );
  const seen = new Set();
  const unmatched = [];
  for (const review of reviews) {
    if (seen.has(review.content_id)) continue;
    seen.add(review.content_id);
    const id = matchCardByTitle(review.name, cards, HW_TITLE_ALIAS);
    if (!id || !byId.has(id)) {
      unmatched.push(review.name);
      continue;
    }
    const card = byId.get(id);
    let packed;
    try {
      packed = await cachedContent(review.content_id, "hw");
    } catch (err) {
      console.error(`hw ${review.content_id}: ${err.message}`);
      continue;
    }
    const blob = `${packed.title || ""} ${packed.summary || ""}`;
    if (/请不要参考|暂不参考/.test(blob)) continue;
    const nodes = parseContentNodes(packed.content);
    const url = `${GK}/hw/${review.content_id}.html`;
    const teamLines = sectionTeamLines(sectionParagraphs(nodes, /配队/), cards, card.id);
    const skill = acceptProse(sectionParagraphs(nodes, /技能升级|加点/).filter(Boolean).join("。"), {
      max: 200,
      kind: "skill",
    });
    let changed = false;
    for (const line of teamLines) {
      if (addComp(card, line)) changed = true;
    }
    if (skill && addSkill(card, skill)) changed = true;
    if (changed) {
      addSource(card, url);
      mark(card);
    }
  }

  for (const card of cards) {
    let added = false;
    for (const line of noteClauses(card.note)) {
      if (addComp(card, line)) added = true;
    }
    if (added) mark(card);
  }

  return { touched: [...touched], unmatched };
}

async function applyBd2(rows) {
  const cards = rows.map((row) => row.card);
  for (const card of cards) resetFilledTeams(card);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const touched = new Set();
  const unmatched = [];
  const reviews = entryList("zsca2").filter((row) => row?.content_id && /测评/.test(String(row.name || "")));
  const seen = new Set();
  for (const review of reviews) {
    if (seen.has(review.content_id)) continue;
    seen.add(review.content_id);
    const title = String(review.name || "");
    const id = matchCostumeReview(title, "", cards);
    if (!id || !byId.has(id)) {
      if (!/三四星|全角色|怎么抽/.test(title)) unmatched.push(title);
      continue;
    }
    const card = byId.get(id);
    let packed;
    try {
      packed = await cachedContent(review.content_id, "zsca2");
    } catch (err) {
      console.error(`bd2 ${review.content_id}: ${err.message}`);
      continue;
    }
    const { skill, team } = bd2Lines(paragraphsOf(packed));
    if (!skill.length && !team.length) continue;
    const costume = costumeInTitle(card, `${title} ${packed.title || ""}`);
    const url = `${GK}/zsca2/${review.content_id}.html`;
    let changed = false;
    for (const line of skill) {
      const text = costume && !line.includes(costume) ? `${costume}：${line}` : line;
      if (addSkill(card, text)) changed = true;
    }
    if (team.length) {
      const teams = ensureTeams(card);
      const text = [...team].sort((a, b) => a.length - b.length)[0];
      if (costume) {
        if (!teams[costume]) {
          teams[costume] = text;
          changed = true;
        }
      } else if (addComp(card, text)) changed = true;
    }
    if (changed) {
      addSource(card, url);
      touched.add(card.id);
    }
  }

  try {
    const packed = await cachedContent(BD2_BEGINNER, "zsca2");
    const url = `${GK}/zsca2/${BD2_BEGINNER}.html`;
    for (const paragraph of paragraphsOf(packed)) {
      const text = acceptProse(paragraph, { max: 160, kind: "team" });
      if (!text || !/魔法队|物理队|厄尔比斯/.test(text)) continue;
      for (const hit of cardsMentioned(text, cards)) {
        const card = byId.get(hit.id);
        if (!card) continue;
        if (!normName(text).includes(normName(hit.key))) continue;
        if (addComp(card, text)) {
          addSource(card, url);
          touched.add(card.id);
        }
      }
    }
  } catch (err) {
    console.error(`bd2 beginner: ${err.message}`);
  }
  return { touched: [...touched], unmatched: unmatched.slice(0, 20) };
}

async function applyNikke(rows) {
  const cards = rows.map((row) => row.card);
  for (const card of cards) resetFilledTeams(card);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const touched = new Set();
  const unmatched = [];

  try {
    const packed = await cachedContent(NIKKE_TEAMS, "nikke");
    const url = `${GK}/nikke/${NIKKE_TEAMS}.html`;
    const notes = notesFromGuide(paragraphsOf(packed), cards);
    for (const [id, lines] of notes) {
      const card = byId.get(id);
      if (!card) continue;
      let changed = false;
      for (const line of lines) {
        if (addComp(card, line)) changed = true;
      }
      if (changed) {
        addSource(card, url);
        touched.add(id);
      }
    }
  } catch (err) {
    console.error(`nikke teams guide: ${err.message}`);
  }

  const reviews = entryList("nikke").filter(
    (row) => row?.content_id && /测评/.test(String(row.name || "")) && !/全pve|游戏测评/.test(String(row.name || ""))
  );
  const seen = new Set();
  for (const review of reviews) {
    if (seen.has(review.content_id)) continue;
    seen.add(review.content_id);
    const id = matchCardByTitle(review.name, cards, {});
    if (!id || !byId.has(id)) {
      unmatched.push(review.name);
      continue;
    }
    const card = byId.get(id);
    let packed;
    try {
      packed = await cachedContent(review.content_id, "nikke");
    } catch (err) {
      console.error(`nikke ${review.content_id}: ${err.message}`);
      continue;
    }
    const nodes = parseContentNodes(packed.content);
    const url = `${GK}/nikke/${review.content_id}.html`;
    const teamLines = sectionTeamLines(sectionParagraphs(nodes, /配队|阵容/), cards, card.id);
    const skill = acceptProse(sectionParagraphs(nodes, /技能升级|加点|练度/).join(" "), {
      max: 180,
      kind: "skill",
    });
    let changed = false;
    for (const line of teamLines) {
      if (addComp(card, line)) changed = true;
    }
    if ((!card.skill_prio || !card.skill_prio.length) && skill && addSkill(card, skill)) changed = true;
    if (!teamLines.length) {
      const extra = paragraphsOf(packed).flatMap((line) => teamSentences(line)).slice(0, 1);
      for (const line of extra) {
        if (addComp(card, line)) changed = true;
      }
    }
    if (changed) {
      addSource(card, url);
      touched.add(card.id);
    }
  }
  return { touched: [...touched], unmatched };
}

async function fillNikkeSkill(rows) {
  const filled = [];
  const missed = [];
  for (const { card } of rows) {
    if (Array.isArray(card.skill_prio) && card.skill_prio.length) continue;
    const raw = String(card.ratings?.slug || card.prydwen_slug || card.id || "");
    const base = raw.split("?")[0];
    if (!base || base.includes("/")) {
      missed.push(card.id);
      continue;
    }
    const treasure = /treasure=true/.test(raw) || /-treasure$/.test(card.id);
    const api = treasure
      ? `https://api.dotgg.gg/nikke/character/${encodeURIComponent(base.replace(/-treasure$/, ""))}?treasure=true`
      : `https://api.dotgg.gg/nikke/character/${encodeURIComponent(base)}`;
    try {
      const detail = curlJson(api);
      const lines = skillPrioFromNikke(detail.skillprio);
      if (!lines.length) {
        missed.push(card.id);
      } else {
        card.skill_prio = lines;
        const page = treasure
          ? `https://nikke.gg/characters/${base.replace(/-treasure$/, "")}/?treasure=true`
          : `https://nikke.gg/characters/${base}/`;
        addSource(card, page);
        filled.push(card.id);
      }
    } catch (err) {
      missed.push(card.id);
      console.error(`nikke skill ${card.id}: ${err.message}`);
    }
    await sleep(120);
  }
  return { filled, missed };
}

function coverage(rows) {
  let teams = 0;
  let prio = 0;
  const emptyTeams = [];
  const emptyPrio = [];
  for (const { card } of rows) {
    const keys = card.teams && typeof card.teams === "object" ? Object.keys(card.teams) : [];
    if (keys.length) teams++;
    else emptyTeams.push(card.id);
    if (Array.isArray(card.skill_prio) && card.skill_prio.length) prio++;
    else emptyPrio.push(card.id);
  }
  return {
    total: rows.length,
    teams,
    empty_teams: rows.length - teams,
    skill_prio: prio,
    empty_skill_prio: rows.length - prio,
    empty_team_ids: emptyTeams,
    empty_prio_ids: emptyPrio,
  };
}

function snapshot(game) {
  const rows = loadCards(game);
  const before = new Map(rows.map((row) => [row.path, JSON.stringify(row.card)]));
  return { rows, before };
}

function writeChanged(rows, before, write) {
  let written = 0;
  for (const row of rows) {
    const next = JSON.stringify(row.card, null, 2) + "\n";
    if (next === before.get(row.path) + "\n" || next.trim() === before.get(row.path)) continue;
    if (JSON.stringify(row.card) === before.get(row.path)) continue;
    written++;
    if (write) fs.writeFileSync(row.path, JSON.stringify(row.card, null, 2) + "\n");
  }
  return written;
}

function sample(rows, ids) {
  const byId = new Map(rows.map((row) => [row.card.id, row.card]));
  const out = {};
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) continue;
    out[id] = { teams: card.teams, skill_tail: (card.skill_prio || []).slice(-2), sources: (card.sources || []).slice(-2) };
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? String(args[onlyIdx + 1] || "") : "";
  const games = ["hw", "nikke", "bd2"].filter((game) => !only || game === only);
  const report = { write };

  for (const game of games) {
    const { rows, before } = snapshot(game);
    report[game] = { before: coverage(rows) };
    if (game === "hw") Object.assign(report.hw, await applyHw(rows));
    if (game === "bd2") Object.assign(report.bd2, await applyBd2(rows));
    if (game === "nikke") {
      Object.assign(report.nikke, await applyNikke(rows));
      report.nikke.skill = await fillNikkeSkill(rows);
    }
    report[game].written = writeChanged(rows, before, write);
    report[game].after = coverage(rows);
    report[game].lines = rows
      .map(({ card }) => {
        const teams = card.teams && typeof card.teams === "object" ? card.teams : {};
        const extra = Object.entries(teams).filter(([key]) => key !== "dopamine_auto");
        if (!extra.length) return null;
        return { id: card.id, teams: Object.fromEntries(extra), skill: (card.skill_prio || []).slice(-1) };
      })
      .filter(Boolean);
    report[game].sample = sample(rows, [
      "garud",
      "na_li",
      "luo_yi_si",
      "mi_la",
      "alan",
      "sylvia",
      "lai_wei_ya",
      "scarlet",
      "liter",
      "li-ta",
      "aigis",
    ]);
  }
  console.log(JSON.stringify(report, null, 2));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
