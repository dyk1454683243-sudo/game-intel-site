#!/usr/bin/env node
/**
 * Deepen HW / NIKKE / BD2 cards from sources that already publish text.
 * Nikke.gg tier list + character API, GameKee 图鉴, GameKee 服装测评摘要.
 * BD2 atlas grades come only from a 服装梯度 cell that is a written T token.
 * Does not invent tiers, pull lines, or skill numbers.
 *
 * Usage: node mcp-server/scripts/deepen-watchlist.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { conclusionFromCard } from "./guide-conclusion.mjs";
import { fetchWiki as fetchBd2Wiki } from "./enrich-bd2-cards.js";
import { fetchCharacterWiki } from "./enrich-hw-cards.js";
import { fetchGameKeeWiki } from "./enrich-nikke-cards.js";
import {
  decodeBasicEntities,
  extractCostumePull,
  extractCostumeTier,
  isNikkeTier,
  matchCostumeReview,
  matchGradeSection,
  nikkeCharacterUrl,
  nikkeLocalId,
  parseNumberedGradeSections,
  renderNikkeSkill,
  stripMarkup,
} from "./watchlist-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const AS_OF = "2026-09-28";
const NIKKE_TIER_URL = "https://nikke.gg/tier-list/";
const NIKKE_API = "https://api.dotgg.gg/nikke";
const GK = "https://www.gamekee.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const SIN_BUNNY = {
  id: "sin-rapid-bunny",
  contentId: 722087,
  name: "森：疾速兔女郎",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function loadCards(game) {
  const dir = path.join(DATA, "guides", game, "characters");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const cardPath = path.join(dir, file);
      const raw = fs.readFileSync(cardPath, "utf8");
      return { file, path: cardPath, raw, card: JSON.parse(raw) };
    });
}

function thinSkill(skill) {
  const summary = String(skill?.summary || "").trim();
  if (!summary) return true;
  if (/^\d+$/.test(summary)) return true;
  return summary.length < 8;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function curlBody(url) {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-L",
      "--max-time",
      "30",
      "-A",
      UA,
      "-H",
      "Accept: application/json,text/plain,*/*",
      "-H",
      `Referer: ${GK}/`,
      url,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(`curl_${r.status}`);
  return r.stdout || "";
}

/** Full review text. The detail summary is often cut off before 综合评价. */
function articleText(detail) {
  const summary = stripMarkup(detail?.summary || "");
  const chunks = [];
  let cdn = String(detail?.content_cdn || "").trim();
  if (cdn.startsWith("//")) cdn = `https:${cdn}`;
  if (cdn) {
    try {
      chunks.push(stripMarkup(curlBody(cdn)));
    } catch {
      /* CDN miss; inline content may still have the grade */
    }
  }
  if (detail?.content) chunks.push(stripMarkup(String(detail.content)));
  chunks.push(summary);
  const graded = chunks.find((text) => /综合评价|服装评价/.test(text));
  if (graded) return graded;
  return chunks.sort((a, b) => b.length - a.length)[0] || "";
}

function pullNearGrade(text) {
  const clean = stripMarkup(text);
  const i = clean.search(/综合评价[:：]/);
  const window = i >= 0 ? clean.slice(i, i + 240) : clean.slice(0, 180);
  return extractCostumePull(window);
}

function applySummary(card) {
  const next = { ...card };
  delete next.summary;
  next.summary = conclusionFromCard(next);
  return next;
}

function payload(card) {
  return JSON.stringify(card, null, 2) + "\n";
}

function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function deepenNikke(dry) {
  const rows = loadCards("nikke");
  const byId = new Map(rows.map((row) => [row.card.id, row]));
  const ids = new Set(byId.keys());
  const tierList = await getJson(`${NIKKE_API}/tierlist`);
  if (!Array.isArray(tierList)) throw new Error("nikke_tierlist_not_array");

  const assigned = new Map();
  const dupes = [];
  for (const row of tierList) {
    if (!row || typeof row !== "object" || !row.url) continue;
    const id = nikkeLocalId(row.url, ids);
    if (!id) continue;
    if (assigned.has(id)) dupes.push(id);
    else assigned.set(id, row);
  }
  for (const id of dupes) assigned.delete(id);

  let rated = 0;
  let absent = 0;
  let skillsFilled = 0;
  const skillTargets = [];

  for (const { card } of rows) {
    const row = assigned.get(card.id) || null;
    const ratings = {
      checked: true,
      as_of: AS_OF,
      url: NIKKE_TIER_URL,
    };
    if (row && isNikkeTier(row.Combined)) {
      ratings.combined = String(row.Combined).trim();
      if (isNikkeTier(row.Story)) ratings.story = String(row.Story).trim();
      if (isNikkeTier(row.Boss)) ratings.boss = String(row.Boss).trim();
      if (isNikkeTier(row.PvP)) ratings.pvp = String(row.PvP).trim();
      ratings.req_invest = row.reqInvest === "TRUE";
      ratings.strong_early = row.strongEarly === "TRUE";
      ratings.slug = String(row.url);
      const page = nikkeCharacterUrl(row.url);
      if (page) ratings.character_url = page;
      rated++;
    } else {
      absent++;
    }
    card.ratings = ratings;

    if (row) {
      if (!card.rarity && row.rarity) card.rarity = String(row.rarity);
      if (!card.role && row.class) card.role = String(row.class);
      if (!card.element && row.element) card.element = String(row.element);
      if (!card.weapon && row.weapon) card.weapon = String(row.weapon);
      if (!card.manufacturer && row.manufacturer) card.manufacturer = String(row.manufacturer);
      if (!card.name_en && row.name) card.name_en = String(row.name);
      const sources = Array.isArray(card.sources) ? [...card.sources] : [];
      for (const url of [NIKKE_TIER_URL, ratings.character_url]) {
        if (url && !sources.includes(url)) sources.push(url);
      }
      card.sources = sources;
      if (!Array.isArray(card.skill_prio) || card.skill_prio.length === 0) {
        const lines = [];
        if (row.SkillPrioOrder) lines.push(`技能顺序 ${row.SkillPrioOrder}`);
        if (row.SkillPrioReq) lines.push(`推荐练度 ${row.SkillPrioReq}`);
        if (row.SkillPrioBudget) lines.push(`预算练度 ${row.SkillPrioBudget}`);
        if (lines.length) card.skill_prio = lines;
      }
      const tag = "Nikke.gg tier-list 2026-09";
      if (!String(card.verified || "").includes("Nikke.gg")) {
        card.verified = card.verified ? `${card.verified}；${tag}` : tag;
      }
    }

    if ((card.skills || []).some(thinSkill)) skillTargets.push(card);
  }

  for (const card of skillTargets) {
    const rawSlug = String(card.ratings?.slug || card.prydwen_slug || card.id);
    const baseSlug = rawSlug.split("?")[0];
    if (!baseSlug || baseSlug.includes("/")) continue;
    const apiUrl = /treasure=true/.test(rawSlug)
      ? `${NIKKE_API}/character/${encodeURIComponent(baseSlug)}?treasure=true`
      : `${NIKKE_API}/character/${encodeURIComponent(baseSlug)}`;
    try {
      const detail = await getJson(apiUrl);
      const apiSkills = Array.isArray(detail?.skills) ? detail.skills : [];
      const byName = new Map(
        apiSkills.map((skill) => [decodeBasicEntities(skill.name).toLowerCase(), skill])
      );
      let filled = 0;
      card.skills = (card.skills || []).map((skill) => {
        const name = decodeBasicEntities(skill.name);
        const next = name !== skill.name ? { ...skill, name } : { ...skill };
        if (!thinSkill(next)) return next;
        const api = byName.get(name.toLowerCase());
        if (!api) return next;
        const level = Array.isArray(api.levels) ? api.levels[0] : null;
        const summary = renderNikkeSkill(api.description, level);
        if (!summary) return next;
        filled++;
        return { ...next, summary: `Lv1: ${summary}` };
      });
      if (filled) {
        skillsFilled += filled;
        const page = /treasure=true/.test(rawSlug)
          ? `https://nikke.gg/characters/${baseSlug}/?treasure=true`
          : `https://nikke.gg/characters/${baseSlug}/`;
        if (!card.sources.includes(page)) card.sources.push(page);
      }
    } catch (err) {
      console.error(`nikke skill ${card.id}: ${err.message}`);
    }
    await sleep(120);
  }

  let bunny = null;
  try {
    const wiki = await fetchGameKeeWiki(SIN_BUNNY.contentId);
    const skills = (wiki.skills || []).map((skill) => {
      const item = { name: skill.name };
      if (skill.type) item.type = skill.type;
      if (skill.summary) item.summary = skill.summary;
      return item;
    });
    if (byId.has(SIN_BUNNY.id)) {
      const existing = byId.get(SIN_BUNNY.id).card;
      if (skills.length) existing.skills = skills;
      if (wiki.meta?.role && !existing.role) existing.role = wiki.meta.role;
      if (wiki.meta?.rarity && !existing.rarity) existing.rarity = wiki.meta.rarity;
      if (wiki.meta?.element && !existing.element) existing.element = wiki.meta.element;
      if (wiki.meta?.manufacturer && !existing.manufacturer) existing.manufacturer = wiki.meta.manufacturer;
      if (wiki.meta?.burst_name) existing.burst = wiki.meta.burst_name;
    } else if (skills.length || wiki.meta) {
      const card = {
        id: SIN_BUNNY.id,
        name: wiki.meta?.name_zh || SIN_BUNNY.name,
        name_zh: wiki.meta?.name_zh || SIN_BUNNY.name,
        name_en: null,
        aliases: [],
        nicknames: [],
        game: "nikke",
        role: wiki.meta?.role || null,
        skills,
        skill_prio: [],
        weapon: wiki.meta?.weapon || wiki.meta?.weapon_type || null,
        element: wiki.meta?.element || null,
        manufacturer: wiki.meta?.manufacturer || null,
        teams: {},
        sources: [`${GK}/nikke/${SIN_BUNNY.contentId}.html`, NIKKE_TIER_URL],
        stub: skills.length > 0 ? false : true,
        as_of: AS_OF,
        gamekee_content_id: SIN_BUNNY.contentId,
        gamekee_entry_id: wiki.entry_id ?? null,
        rarity: wiki.meta?.rarity || null,
        burst: wiki.meta?.burst_name || null,
        verified: `GameKee nikke/${SIN_BUNNY.contentId} 图鉴`,
        ratings: { checked: true, as_of: AS_OF, url: NIKKE_TIER_URL },
      };
      if (!skills.length) card.note = "GameKee 图鉴未解析出技能正文。技能未见可靠出处，不编造。";
      bunny = applySummary(card);
    }
  } catch (err) {
    console.error(`sin bunny: ${err.message}`);
  }

  let written = 0;
  for (const row of rows) {
    const next = applySummary({ ...row.card, as_of: AS_OF });
    const body = payload(next);
    if (body === row.raw) continue;
    written++;
    if (!dry) fs.writeFileSync(row.path, body);
  }
  if (bunny && !dry) {
    writeJson(path.join(DATA, "guides", "nikke", "characters", `${SIN_BUNNY.id}.json`), bunny);
    written++;
  } else if (bunny) {
    written++;
  }

  return {
    tier_rows: tierList.filter((row) => row && row.url).length,
    rated,
    absent,
    dupes,
    skills_filled: skillsFilled,
    bunny: bunny ? bunny.id : null,
    bunny_skills: bunny?.skills?.length || 0,
    written,
  };
}

async function deepenBd2Skills(dry) {
  const rows = loadCards("bd2").filter((row) => (row.card.skills || []).some(thinSkill));
  let filled = 0;
  let cards = 0;
  for (const row of rows) {
    const contentId = Number(row.card.gamekee_content_id);
    if (!contentId) continue;
    try {
      const wiki = fetchBd2Wiki(contentId);
      const fresh = new Map(
        (wiki.skills || [])
          .filter((skill) => skill.summary && !thinSkill(skill))
          .map((skill) => [`${skill.costume || ""}::${skill.name}`, skill.summary])
      );
      let touched = false;
      const skills = (row.card.skills || []).map((skill) => {
        if (!thinSkill(skill)) return skill;
        const summary = fresh.get(`${skill.costume || ""}::${skill.name}`);
        if (!summary) return skill;
        touched = true;
        filled++;
        return { ...skill, summary };
      });
      if (!touched) continue;
      cards++;
      const next = { ...row.card, skills, as_of: AS_OF };
      if (!dry && changed(row.card, next)) writeJson(row.path, next);
      else row.card.skills = skills;
    } catch (err) {
      console.error(`bd2 skill ${row.card.id}: ${err.message}`);
    }
    await sleep(250);
  }
  return { cards, filled };
}

async function deepenBd2Reviews(dry) {
  const list = await getJson(`${GK}/v1/entry/list?page_no=1&limit=2000`, {
    "game-alias": "zsca2",
  });
  // GameKee marks many still-readable 测评 entries is_del=1 after they leave the folder.
  // Keep them when content_id is present; drop the row only if the detail has no 综合评价.
  const reviews = [];
  const seenReview = new Set();
  for (const row of list.data || []) {
    if (!row?.content_id || !String(row.name || "").includes("测评")) continue;
    if (seenReview.has(row.content_id)) continue;
    seenReview.add(row.content_id);
    reviews.push(row);
  }
  const cards = loadCards("bd2");
  const cardList = cards.map((row) => row.card);
  const byId = new Map(cards.map((row) => [row.card.id, row]));
  const grouped = new Map();
  let skipped = 0;
  const skippedSample = [];

  const pushItem = (id, item) => {
    if (!id || !byId.has(id)) return;
    if (!grouped.has(id)) grouped.set(id, []);
    const bucket = grouped.get(id);
    if (!bucket.some((row) => row.source === item.source)) bucket.push(item);
  };

  for (const review of reviews) {
    let text = "";
    let title = String(review.name || "");
    let shortSummary = "";
    try {
      const detail = await getJson(`${GK}/v1/content/detail/${review.content_id}`, {
        "game-alias": "zsca2",
      });
      title = detail.data?.title || title;
      shortSummary = stripMarkup(detail.data?.summary || "");
      text = articleText(detail.data || {});
    } catch (err) {
      console.error(`bd2 review ${review.content_id}: ${err.message}`);
      await sleep(200);
      continue;
    }
    const source = `${GK}/zsca2/${review.content_id}.html`;
    if (/三四星/.test(title)) {
      const sections = parseNumberedGradeSections(text);
      if (!sections.length) {
        skipped++;
        skippedSample.push({ title, tier: null, id: null, summary: "no_numbered_grades" });
      }
      for (const section of sections) {
        const id = matchGradeSection(section.heading, section.body, cardList);
        if (!id) continue;
        pushItem(id, {
          label: section.heading,
          tier: section.tier,
          source,
          content_id: review.content_id,
        });
      }
      await sleep(80);
      continue;
    }
    const tier = extractCostumeTier(text);
    // Match on the title and the short summary only. The full article names other characters.
    const id = matchCostumeReview(title, shortSummary, cardList);
    if (!tier || !id || !byId.has(id)) {
      skipped++;
      if (skippedSample.length < 12) {
        skippedSample.push({
          title,
          tier: tier || null,
          id: id || null,
          summary: String(text).replace(/\s+/g, " ").slice(0, 80),
        });
      }
      await sleep(80);
      continue;
    }
    const pull = pullNearGrade(text);
    const item = {
      label:
        title
          .replace(/服装抽取建议|角色简评|抽取建议|测评/g, "")
          .replace(/[|｜]+/g, " ")
          .replace(/\s+/g, " ")
          .trim() || title,
      tier,
      source,
      content_id: review.content_id,
    };
    if (pull) item.pull = pull;
    pushItem(id, item);
    await sleep(80);
  }

  let written = 0;
  for (const [id, found] of grouped) {
    const row = byId.get(id);
    const existing = Array.isArray(row.card.costume_ratings) ? row.card.costume_ratings : [];
    const costume_ratings = [...existing];
    for (const item of found) {
      if (costume_ratings.some((prev) => prev.source === item.source)) continue;
      costume_ratings.push(item);
    }
    if (costume_ratings.length === existing.length) continue;
    const next = applySummary({
      ...row.card,
      costume_ratings,
      as_of: AS_OF,
    });
    if (!changed(row.card, next)) continue;
    written++;
    if (!dry) writeJson(row.path, next);
  }
  return {
    list_n: Array.isArray(list.data) ? list.data.length : 0,
    reviews: reviews.length,
    characters: grouped.size,
    skipped,
    skipped_sample: skippedSample,
    written,
  };
}

function cleanHwPull(text) {
  const v = String(text || "")
    .replace(/\*[a-z]+:([^*]*)\*/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!v || v.length < 4) return "";
  if (/^(暂无|无|没有|抽取建议|暂无建议)/.test(v)) return "";
  return v.length > 480 ? `${v.slice(0, 480).trim()}…` : v;
}

function cleanHwWeapon(name) {
  const v = String(name || "").replace(/\s+/g, " ").trim();
  if (!v || v.length < 2) return "";
  if (/^(暂无|无|没有|专武|图标|封面|技能)/.test(v)) return "";
  if (/暂无专武|没有专武|无专武/.test(v)) return "";
  return v;
}

function normSkillName(name) {
  return String(name || "")
    .replace(/\s+/g, "")
    .replace(/[·・．.]/g, "")
    .trim();
}

async function deepenBd2Atlas(dry) {
  const rows = loadCards("bd2").filter(
    (row) => row.card.summary?.stub === true && Number(row.card.gamekee_content_id)
  );
  let written = 0;
  let grades = 0;
  const stayed = [];
  for (const row of rows) {
    const contentId = Number(row.card.gamekee_content_id);
    try {
      const wiki = fetchBd2Wiki(contentId);
      const found = Array.isArray(wiki.costume_grades) ? wiki.costume_grades : [];
      if (!found.length) {
        stayed.push(row.card.name_zh || row.card.name || row.card.id);
        await sleep(200);
        continue;
      }
      const source = `${GK}/zsca2/${contentId}.html`;
      const costume_ratings = found.map((item) => {
        const next = {
          label: item.label,
          tier: item.tier,
          source,
          kind: "atlas",
          content_id: contentId,
        };
        if (item.pull) next.pull = item.pull;
        return next;
      });
      grades += costume_ratings.length;
      const next = applySummary({
        ...row.card,
        costume_ratings,
        as_of: AS_OF,
      });
      if (!changed(row.card, next)) {
        stayed.push(row.card.name_zh || row.card.name || row.card.id);
        await sleep(200);
        continue;
      }
      written++;
      if (!dry) writeJson(row.path, next);
    } catch (err) {
      console.error(`bd2 atlas ${row.card.id}: ${err.message}`);
      stayed.push(row.card.name_zh || row.card.name || row.card.id);
    }
    await sleep(200);
  }
  return { attempted: rows.length, written, grades, stayed };
}

async function deepenHw(dry) {
  // lysandria was rebuilt from the same wiki rules; leave that card as the reference.
  const rows = loadCards("hw").filter((row) => row.card.id !== "lysandria" && row.card.gamekee_content_id);
  let written = 0;
  let pulls = 0;
  let weapons = 0;
  let summaries = 0;
  let cursor = 0;

  async function one(row) {
    const contentId = Number(row.card.gamekee_content_id);
    if (!contentId) return;
    try {
      const wiki = await fetchCharacterWiki(contentId);
      const byExact = new Map();
      const byNorm = new Map();
      for (const skill of wiki.skills || []) {
        if (!skill?.summary) continue;
        byExact.set(skill.name, skill);
        byNorm.set(normSkillName(skill.name), skill);
      }
      const next = { ...row.card };
      let touched = false;
      next.skills = (next.skills || []).map((skill) => {
        if (String(skill.summary || "").trim()) return skill;
        const fresh = byExact.get(skill.name) || byNorm.get(normSkillName(skill.name));
        if (!fresh?.summary) return skill;
        touched = true;
        summaries++;
        return {
          ...skill,
          summary: fresh.summary,
          ...(fresh.type && !skill.type ? { type: fresh.type } : {}),
        };
      });
      const pull = cleanHwPull(wiki.meta?.pull);
      if (pull && !/抽取建议:/.test(String(next.note || ""))) {
        next.note = `抽取建议: ${pull}`;
        touched = true;
        pulls++;
      }
      const weapon = cleanHwWeapon(wiki.meta?.weapon);
      if (weapon && !String(next.weapon || "").trim()) {
        next.weapon = weapon;
        touched = true;
        weapons++;
      }
      if (!touched) return;
      const stamped = applySummary({ ...next, as_of: AS_OF });
      if (!changed(row.card, stamped)) return;
      written++;
      if (!dry) writeJson(row.path, stamped);
    } catch (err) {
      console.error(`hw ${row.card.id}: ${err.message}`);
    }
  }

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      await one(row);
      await sleep(200);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { attempted: rows.length, written, pulls, weapons, summaries, skipped_lysandria: true };
}

function addBunnyAlias(dry) {
  const cardPath = path.join(DATA, "guides", "nikke", "characters", `${SIN_BUNNY.id}.json`);
  if (!fs.existsSync(cardPath)) return false;
  const card = readJson(cardPath);
  const aliasPath = path.join(DATA, "guides", "nikke", "aliases.p4.json");
  const raw = fs.readFileSync(aliasPath, "utf8");
  if (raw.includes(`"${SIN_BUNNY.id}"`)) return false;
  const name = card.name_zh || card.name;
  const entry = { id: SIN_BUNNY.id, name, kind: "character" };
  const insert = `,${JSON.stringify(SIN_BUNNY.id)}:${JSON.stringify(entry)},${JSON.stringify(name)}:${JSON.stringify(entry)}`;
  const trimmed = raw.trim();
  if (!trimmed.endsWith("}}")) throw new Error("nikke_alias_shape");
  if (!dry) fs.writeFileSync(aliasPath, trimmed.replace(/}}$/, `${insert}}}`));
  return true;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? String(process.argv[onlyIdx + 1] || "") : "";
  const report = { ok: true, dry_run: dry, as_of: AS_OF, only: only || "all" };
  if (!only || only === "bd2-skills") report.bd2_skills = await deepenBd2Skills(dry);
  if (!only || only === "bd2-reviews") report.bd2_reviews = await deepenBd2Reviews(dry);
  if (!only || only === "bd2-atlas") report.bd2_atlas = await deepenBd2Atlas(dry);
  if (!only || only === "hw") report.hw = await deepenHw(dry);
  if (!only || only === "nikke") report.nikke = await deepenNikke(dry);
  if (!only || only === "nikke") report.bunny_alias = addBunnyAlias(dry);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
