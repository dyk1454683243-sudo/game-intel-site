#!/usr/bin/env node
/**
 * Build Limbus Company identity cards from Prydwen HTML cached by
 * fetch-limbus-pages.mjs, plus the identities list and tier-list markdown.
 *
 * Does not invent tiers. A card with parsed skills is stub:false.
 * summary.stub stays true when neither the identity page nor the tier list
 * states a grade. Teams are attached only when every linked member is one id.
 *
 * Usage:
 *   node mcp-server/scripts/build-limbus-cards.mjs
 *   node mcp-server/scripts/build-limbus-cards.mjs --check-one blade-lineage-salsu-yi-sang
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const SITE = path.join(ROOT, "ai-site");
const HTML_DIR = process.env.LIMBUS_HTML || "/tmp/limbus/html";
const MD_DIR = process.env.LIMBUS_MD || "/tmp/limbus/md";
const CATALOG = process.env.LIMBUS_CATALOG || "/tmp/limbus/catalog.json";
const TIER_MD = process.env.LIMBUS_TIER || "/tmp/limbus/tier.md";
const AS_OF = "2026-10-17";
const LIST_URL = "https://www.prydwen.gg/limbus-company/identities";
const TIER_URL = "https://www.prydwen.gg/limbus-company/tier-list";
const TEAM_URL = "https://www.prydwen.gg/limbus-company/team-database/";

const SINNERS = [
  { id: "yi-sang", name_en: "Yi Sang", name_zh: "李箱", order: 1, source: "https://www.gamekee.com/limbus/585110.html", match: ["yi sang"] },
  { id: "faust", name_en: "Faust", name_zh: "浮士德", order: 2, source: "https://www.gamekee.com/limbus/585793.html", match: ["faust"] },
  { id: "don-quixote", name_en: "Don Quixote", name_zh: "堂吉诃德", order: 3, source: "https://www.gamekee.com/limbus/585794.html", match: ["don quixote"] },
  { id: "ryoshu", name_en: "Ryōshū", name_zh: "良秀", order: 4, source: "https://www.gamekee.com/limbus/585796.html", match: ["ryoshu", "ryōshū", "ryōshu"] },
  { id: "meursault", name_en: "Meursault", name_zh: "默尔索", order: 5, source: "https://www.gamekee.com/limbus/585801.html", match: ["meursault"] },
  { id: "hong-lu", name_en: "Hong Lu", name_zh: "鸿璐", order: 6, source: "https://www.gamekee.com/limbus/585802.html", match: ["hong lu"] },
  { id: "heathcliff", name_en: "Heathcliff", name_zh: "希斯克利夫", order: 7, source: "https://www.gamekee.com/limbus/585803.html", match: ["heathcliff"] },
  { id: "ishmael", name_en: "Ishmael", name_zh: "以实玛利", order: 8, source: "https://www.gamekee.com/limbus/585805.html", match: ["ishmael"] },
  { id: "rodion", name_en: "Rodion", name_zh: "罗佳", order: 9, source: "https://www.gamekee.com/limbus/585809.html", match: ["rodion"] },
  { id: "sinclair", name_en: "Sinclair", name_zh: "辛克莱尔", order: 10, source: "https://www.gamekee.com/limbus/585810.html", match: ["sinclair"] },
  { id: "outis", name_en: "Outis", name_zh: "奥提斯", order: 11, source: "https://www.gamekee.com/limbus/585565.html", match: ["outis"] },
  { id: "gregor", name_en: "Gregor", name_zh: "格里高尔", order: 12, source: "https://www.gamekee.com/limbus/585811.html", match: ["gregor"] },
];

const OCT15 = "https://store.steampowered.com/news/app/1973530/view/1846018067940411";
const OCT1 = "https://store.steampowered.com/news/app/1973530/view/1844751498230922";
const SEP24 = "https://store.steampowered.com/news/app/1973530/view/1844115010500798";
const SEP17 = "https://store.steampowered.com/news/app/1973530/view/1843481262701165";

function decode(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function field(block, label) {
  const clean = String(block || "").replace(/<!--[\s\S]*?-->/g, "");
  const re = new RegExp(`${label}:\\s*(?:<span>)?([^<\\n]+)`, "i");
  const m = clean.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function sinnerFromName(name) {
  const n = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const ordered = [...SINNERS].sort((a, b) => b.name_en.length - a.name_en.length);
  for (const row of ordered) {
    if (row.match.some((token) => n.endsWith(token) || n.endsWith(token.replace(/ /g, "")))) return row;
  }
  return null;
}

function sinnerObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name_en: row.name_en,
    name_zh: row.name_zh,
    order: row.order,
    source: row.source,
  };
}

function parseIdentity(html, slug) {
  const page = `https://www.prydwen.gg/limbus-company/identities/${slug}`;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = h1 ? decode(h1[1]).replace(/\s+/g, " ").trim() : slug;
  const updated = html.match(/Last updated:\s*(?:<strong>)?([^<]+)/i);
  const intro = html.match(/is a\s*(?:<strong[^>]*>)?(0{1,3})(?:<\/strong>)?\s*rarity Identity from the Sinner\s*<strong>([^<]+)<\/strong>[\s\S]{0,180}?on\s*(?:<strong>)?([^<]+)/i);
  const rarity = intro ? intro[1] : (html.match(/lc-rarity rarity-(0{1,3})/) || [])[1] || "";
  const sinnerName = intro ? decode(intro[2]) : "";
  const released = intro ? decode(intro[3]).replace(/\.$/, "") : "";
  const sinner = sinnerFromName(sinnerName || name);
  const affinities = [];
  const affRe = /class="lc-affinity ([A-Za-z]+)"[\s\S]{0,2500}?<!-- -->x<!-- -->(\d+)/g;
  let am;
  const seenAff = new Set();
  while ((am = affRe.exec(html))) {
    const key = am[1];
    if (seenAff.has(key)) continue;
    seenAff.add(key);
    affinities.push({ sin: key, count: Number(am[2]) });
  }
  const specials = [];
  const specRe = /class="employee-role"[^>]*>([^<]+)</g;
  let sm;
  while ((sm = specRe.exec(html))) {
    const text = decode(sm[1]);
    if (text && !specials.includes(text)) specials.push(text);
  }
  const ratingM = html.match(/rating-box limbus ([A-Za-z0-9+]+)/);
  const endgame = ratingM && /^[A-D][A-Z0-9+]*$/.test(ratingM[1]) ? ratingM[1] : "";
  const skills = [];
  const chunks = html.split('<div class="skill-header">').slice(1);
  for (const rawChunk of chunks) {
    const chunk = rawChunk.split('<div class="content-header')[0];
    const headerEnd = chunk.search(/<div class="(?:additional-information|skill-with-coloring|skill-description)/);
    const header = headerEnd >= 0 ? chunk.slice(0, headerEnd) : chunk.slice(0, 900);
    const nameM = header.match(/class="skill-name">([^<]+)/);
    if (!nameM) continue;
    const skillName = decode(nameM[1]);
    const sinM = header.match(/limbus-affinity-box ([A-Za-z]+)/);
    const costM = header.match(/limbus-affinity-box[^>]*>([\s\S]*?)<\/span>/);
    const cost = costM ? decode(costM[1]).replace(/\s+/g, " ").trim() : "";
    const pills = [...header.matchAll(/class="skill-type pill">([\s\S]*?)<\/span>/g)].map((m) =>
      decode(m[1]).replace(/\s+/g, " ").trim()
    );
    const slot = pills.join(" ");
    const plainHeader = decode(header);
    const info = chunk.match(/<div class="additional-information">([\s\S]*?)<\/div>/);
    const infoHtml = info ? info[1] : "";
    const effectParts = [];
    for (const m of chunk.matchAll(/<div class="skill-with-coloring[^"]*">([\s\S]*?)<\/div>/g)) {
      effectParts.push(decode(m[1]));
    }
    for (const m of chunk.matchAll(/<div class="coin">([\s\S]*?)<\/div>/g)) {
      effectParts.push(decode(m[1]));
    }
    const effect = effectParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    let type = "skill";
    if (/\bskill\s*1\b/i.test(slot)) type = "skill1";
    else if (/\bskill\s*2\b/i.test(slot)) type = "skill2";
    else if (/\bskill\s*3\b/i.test(slot)) type = "skill3";
    else if (/\bpassive\b/i.test(plainHeader)) type = "passive";
    else if (/\bsupport\b/i.test(plainHeader)) type = "support";
    else if (/\b(defense|evade|counter|guard)\b/i.test(slot)) type = "defense";
    const attack = field(infoHtml, "Attack Type");
    const power = field(infoHtml, "Skill Power");
    const coins = field(infoHtml, "No. of Coins");
    const coinPower = field(infoHtml, "Coin Power");
    const offense = field(infoHtml, "Offense Level");
    const weight = field(infoHtml, "Atk Weight");
    const bits = [];
    if (slot) bits.push(slot);
    if (cost) bits.push(cost);
    else if (sinM) bits.push(sinM[1]);
    if (attack) bits.push(attack);
    if (power) bits.push(`Skill Power ${power}`);
    if (coins) bits.push(`Coins ${coins}`);
    if (coinPower) bits.push(`Coin Power ${coinPower}`);
    if (offense) bits.push(`Offense Level ${offense}`);
    if (weight) bits.push(`Atk Weight ${weight}`);
    const summary = [bits.join(" · "), effect].filter(Boolean).join(". ");
    const skill = { name: skillName, type, summary };
    if (sinM && type !== "passive" && type !== "support") skill.sin = sinM[1];
    if (sinM && (type === "passive" || type === "support")) skill.sin_cost = decode((header.match(/limbus-affinity-box [\s\S]*?<\/span>/) || [""])[0]);
    if (attack) skill.attack_type = attack;
    skills.push(skill);
  }
  const combat = {};
  const stat = (label) => {
    const re = new RegExp(`${label}</div>\\s*<div class="details">([^<]+)`);
    const m = html.match(re);
    return m ? decode(m[1]) : "";
  };
  const hp = stat("Max HP");
  const speed = stat("Speed Range");
  const defense = stat("Defense");
  if (hp) combat.max_hp = hp;
  if (speed) combat.speed = speed;
  if (defense) combat.defense = defense;
  const resistances = {};
  const resRe = /alt="(Slash|Pierce|Blunt)"[\s\S]{0,500}?RES<\/div>\s*<div class="details">([^<]+)/g;
  let rm;
  while ((rm = resRe.exec(html))) resistances[rm[1].toLowerCase()] = decode(rm[2]);
  if (Object.keys(resistances).length) combat.resistances = resistances;
  if (Object.keys(combat).length) combat.level = 60;
  let full = "";
  const fullM = html.match(/https:\/\/cdn\.prydwen\.gg\/images\/limbus-company\/characters\/[a-z0-9._-]+_full\.webp/i);
  if (fullM) full = fullM[0];
  const reviewM = html.match(/class="review raw"[\s\S]*?<div class="rte-plain">([\s\S]*?)<\/div>/);
  const review = reviewM ? decode(reviewM[1]).slice(0, 900).trim() : "";
  return {
    slug,
    page,
    name,
    rarity,
    sinner,
    released,
    pageUpdated: updated ? decode(updated[1]) : "",
    affinities,
    specials,
    endgame,
    skills: skills.filter((skill) => skill.type !== "passive" && skill.type !== "support").concat(
      skills.filter((skill) => skill.type === "passive" || skill.type === "support")
    ),
    combat: Object.keys(combat).length ? combat : null,
    review: review && !/^[\s]*$/.test(review) && review.length > 40 ? review : "",
    portrait: full,
  };
}

function normName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "ss")
    .toLowerCase()
    .replace(/\[|\]/g, " ")
    .replace(/\b(assoc|association)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function parseMarkdown(text, slug) {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && line !== "×");
  const joined = lines.join("\n");
  const intro = joined.match(/is a (0{1,3}) rarity Identity from the Sinner (.+?) that was added to the game on ([0-9]{1,2}\/[A-Za-z]+\/[0-9]{4})/);
  const rarity = intro ? intro[1] : "";
  const sinner = sinnerFromName(intro ? intro[2] : lines[0] || slug);
  const released = intro ? intro[3] : "";
  const updated = (joined.match(/Last updated:\s*([^\n]+)/) || [])[1] || "";
  const affinities = [];
  for (const match of joined.matchAll(/Affinity \d+ ([A-Za-z]+) x(\d+)/g)) {
    affinities.push({ sin: match[1], count: Number(match[2]) });
  }
  let endgame = "";
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^(?:SSS|SS|S\+|S|A|B|C|D)$/.test(lines[i]) && lines[i + 1] === "Endgame") {
      endgame = lines[i];
      break;
    }
  }
  const specials = [];
  const specAt = lines.indexOf("Specialities");
  const skillsAt = lines.indexOf("Skills");
  if (specAt >= 0 && skillsAt > specAt) {
    for (const line of lines.slice(specAt + 1, skillsAt)) {
      if (!/^(Gallery|Profile|Affinities)$/.test(line) && !line.startsWith("Affinity ")) specials.push(line);
    }
  }
  const skills = [];
  const passAt = lines.indexOf("Passives");
  const statusAt = lines.findIndex((line, index) => index > passAt && line === "Status");
  const skillLines = lines.slice(skillsAt + 1, passAt > skillsAt ? passAt : lines.length);
  let i = 0;
  while (i < skillLines.length) {
    const line = skillLines[i];
    const skillNum = line.match(/^Skill (\d+)$/);
    let type = "";
    if (skillNum) type = `skill${skillNum[1]}`;
    else if (/^Defense\b/.test(line)) type = "defense";
    else {
      i += 1;
      continue;
    }
    const slot = line;
    const skillName = skillLines[i + 1] || "";
    i += 2;
    let sin = "";
    if (
      i < skillLines.length &&
      !skillLines[i].includes(":") &&
      !/^(Skill \d+|Defense\b)/.test(skillLines[i])
    ) {
      sin = skillLines[i];
      i += 1;
    }
    const stats = [];
    const effects = [];
    while (i < skillLines.length && !/^(Skill \d+|Defense\b)/.test(skillLines[i])) {
      const stat = skillLines[i].match(/^(Attack Type|Skill Power|No\. of Coins|Coin Power|Offense Level|Atk Weight):\s*(.*)$/);
      if (stat) stats.push(`${stat[1] === "No. of Coins" ? "Coins" : stat[1] === "Skill Power" ? "Skill Power" : stat[1]} ${stat[2]}`.replace("Attack Type ", ""));
      else effects.push(skillLines[i]);
      i += 1;
    }
    const attack = (skillLines.slice(0).join("\n").match(/Attack Type: ([^\n]+)/) || [])[1];
    const summary = [`${slot} · ${sin}`, ...stats, effects.join(" ")].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
    const skill = { name: skillName, type, summary };
    if (type !== "passive" && type !== "support" && /^[A-Za-z]+$/.test(sin)) skill.sin = sin;
    const attackLine = stats.find((item) => !item.startsWith("Skill Power") && !item.startsWith("Coins") && !item.startsWith("Coin Power") && !item.startsWith("Offense") && !item.startsWith("Atk"));
    if (attackLine) skill.attack_type = attackLine;
    if (!attack && attackLine) skill.attack_type = attackLine;
    skills.push(skill);
  }
  const passLines = lines.slice(passAt + 1, statusAt > passAt ? statusAt : passAt + 1);
  let j = 0;
  while (j < passLines.length) {
    if (passLines[j] !== "Passive" && passLines[j] !== "Support") {
      j += 1;
      continue;
    }
    const type = passLines[j].toLowerCase();
    const skillName = passLines[j + 1] || "";
    const cost = passLines[j + 2] || "";
    j += 3;
    const effects = [];
    while (j < passLines.length && passLines[j] !== "Passive" && passLines[j] !== "Support") {
      effects.push(passLines[j]);
      j += 1;
    }
    skills.push({
      name: skillName,
      type,
      summary: [cost, effects.join(" ")].filter(Boolean).join(". ").replace(/\s+/g, " ").trim(),
    });
  }
  const valueAfter = (label) => {
    const at = lines.indexOf(label);
    return at >= 0 ? lines[at + 1] : "";
  };
  const combat = {};
  if (valueAfter("Max HP")) combat.max_hp = valueAfter("Max HP");
  if (valueAfter("Speed Range")) combat.speed = valueAfter("Speed Range");
  if (valueAfter("Defense") && /^\d+$/.test(valueAfter("Defense"))) combat.defense = valueAfter("Defense");
  const resistances = {};
  for (const [label, key] of [["Slash RES", "slash"], ["Pierce RES", "pierce"], ["Blunt RES", "blunt"]]) {
    const value = valueAfter(label);
    if (value) resistances[key] = value;
  }
  if (Object.keys(resistances).length) combat.resistances = resistances;
  if (Object.keys(combat).length) combat.level = 60;
  const reviewAt = lines.indexOf("Review");
  const prosAt = lines.findIndex((line, index) => index > reviewAt && line === "Pros");
  const review = reviewAt >= 0 ? lines.slice(reviewAt + 1, prosAt > reviewAt ? prosAt : reviewAt + 4).join(" ").slice(0, 900).trim() : "";
  const about = joined.match(/about (\[?.+?) check the sections/i);
  const name = String(about ? about[1] : slug)
    .replace(/\s*\|.*$/, "")
    .replace(/^\[/, "")
    .replace(/\] /g, " ")
    .replace(/\]$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    slug,
    page: `https://www.prydwen.gg/limbus-company/identities/${slug}`,
    name,
    rarity,
    sinner,
    released,
    pageUpdated: updated.replace(/\.$/, ""),
    affinities,
    specials,
    endgame,
    skills,
    combat: Object.keys(combat).length ? combat : null,
    review,
    portrait: "",
  };
}

function parseTierMd(markdown) {
  const tiers = new Set(["SSS", "SS", "S+", "S", "A", "B", "C", "D"]);
  const roles = new Set(["Damage Dealer", "Status Specialist", "Support", "Tank"]);
  let tier = "";
  let role = "";
  const bySlug = new Map();
  for (const raw of markdown.split(/\n/)) {
    const line = raw.trim();
    if (tiers.has(line)) {
      tier = line;
      role = "";
      continue;
    }
    if (roles.has(line)) {
      role = line;
      continue;
    }
    const m = line.match(/\/limbus-company\/identities\/([a-z0-9-]+)/);
    if (!m || !tier || !role) continue;
    const slug = m[1];
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    const list = bySlug.get(slug);
    if (!list.some((row) => row.tier === tier && row.role === role)) {
      list.push({ tier, role, url: TIER_URL, as_of: AS_OF });
    }
  }
  return bySlug;
}

function portraitFromCatalog(row) {
  if (!row || !row.img) return "";
  const file = decodeURIComponent(row.img).replace(/\\/g, "");
  if (!/^[a-z0-9._-]+\.webp$/i.test(file)) return "";
  return `https://cdn.prydwen.gg/images/limbus-company/characters/${file}`;
}

function buildCard(catalogRow, parsed, placements) {
  const slug = catalogRow.slug;
  const page = `https://www.prydwen.gg/limbus-company/identities/${slug}`;
  const display = (parsed && parsed.name) || String(catalogRow.name || slug).replace(/^\[|\]$/g, "");
  const cleanName = display.replace(/^\[/, "").replace(/\](?=\s|$)/, "").replace(/\] /g, " ").replace(/\s+/g, " ").trim();
  const sinner = (parsed && parsed.sinner) || sinnerFromName(cleanName);
  const skills = parsed && parsed.skills.length ? parsed.skills.map((skill) => {
    const out = { name: skill.name, type: skill.type, summary: skill.summary };
    if (skill.sin) out.sin = skill.sin;
    if (skill.attack_type) out.attack_type = skill.attack_type;
    return out;
  }) : [];
  const sources = parsed ? [page, LIST_URL] : [LIST_URL];
  if (sinner) sources.push(sinner.source);
  const hasSkills = skills.some((skill) => skill.type.startsWith("skill") || skill.type === "defense");
  const grades = placements || [];
  if (grades.length) sources.push(TIER_URL);
  const endgame = parsed && parsed.endgame ? parsed.endgame : "";
  const tierBits = [];
  if (endgame) tierBits.push(`Prydwen 角色页 Endgame ${endgame}`);
  if (grades.length) {
    tierBits.push(
      `梯度表 ${grades.map((row) => `${row.role} ${row.tier}`).join(" / ")}`
    );
  }
  const positionBits = [
    parsed && parsed.rarity ? parsed.rarity : "",
    sinner ? sinner.name_en : "",
    parsed && parsed.specials.length ? parsed.specials.join(" / ") : "",
  ].filter(Boolean);
  const summary = {
    sources: sources.filter((url, index) => sources.indexOf(url) === index),
  };
  if (tierBits.length) {
    summary.tier = tierBits.join("；");
    summary.stub = false;
    summary.caveat = "强度只转写 Prydwen 角色页 Endgame 字母和/或梯度表分栏，编辑向，不是官方档。不编造抽取结论。";
  } else {
    summary.stub = true;
    summary.caveat = `已打开 Prydwen 角色页与梯度表（${TIER_URL}，as_of ${AS_OF}）。页面没有给出 Endgame 字母，梯度表也没有这条人格。不编造档位或抽取结论。`;
    summary.sources = [...new Set([...summary.sources, TIER_URL])];
  }
  if (positionBits.length) summary.position = positionBits.join(" / ");
  const card = {
    id: slug,
    name: cleanName,
    name_zh: null,
    name_en: cleanName,
    aliases: [],
    game: "limbus-company",
    kind: "identity",
    sinner: sinnerObject(sinner),
    rarity: (parsed && parsed.rarity) || null,
    role: parsed && parsed.specials.length ? parsed.specials.join(" / ") : null,
    sin_affinities: parsed && parsed.affinities.length ? parsed.affinities : [],
    skills,
    skill_prio: [],
    teams: {},
    sources: [...new Set(sources)],
    stub: !hasSkills,
    as_of: AS_OF,
    prydwen_slug: slug,
    portrait: (parsed && parsed.portrait) || portraitFromCatalog(catalogRow) || null,
    portrait_source: (parsed && parsed.portrait) ? page : (portraitFromCatalog(catalogRow) ? LIST_URL : null),
    portrait_via: (parsed && parsed.portrait)
      ? `prydwen-identity:${slug}`
      : (portraitFromCatalog(catalogRow) ? `prydwen-list:${slug}` : null),
  };
  if (parsed && parsed.released) card.released = parsed.released;
  if (parsed && parsed.pageUpdated) card.page_updated = parsed.pageUpdated;
  if (parsed && parsed.combat) card.combat = parsed.combat;
  if (parsed && parsed.review) card.review = parsed.review;
  if (hasSkills) {
    card.summary = summary;
    card.verified = `Prydwen /limbus-company/identities/${slug}${parsed.pageUpdated ? `，页内 Last updated ${parsed.pageUpdated}` : ""}；名单 ${LIST_URL}（Last updated 08/October/2026）`;
  } else {
    card.stub = true;
    card.note = parsed
      ? "Prydwen 角色页已打开，但没有解析到技能正文。不补技能名或数值。"
      : "Prydwen 名单有这条人格。这次没有拿到角色页，不补技能、档位或数值。";
    delete card.summary;
  }
  if (!card.portrait) {
    card.portrait = null;
    card.portrait_source = null;
    card.portrait_via = null;
  }
  return card;
}

function stubFromNotice() {
  const sinner = SINNERS.find((row) => row.id === "sinclair");
  return {
    id: "haute-couture-the-crimson-god-of-le-rouge-sinclair",
    name: "Haute Couture::The Crimson God of Le Rouge Sinclair",
    name_zh: null,
    name_en: "Haute Couture::The Crimson God of Le Rouge Sinclair",
    aliases: [],
    game: "limbus-company",
    kind: "identity",
    sinner: sinnerObject(sinner),
    rarity: "000",
    role: null,
    sin_affinities: [],
    skills: [],
    skill_prio: [],
    teams: {},
    sources: [OCT15, LIST_URL],
    stub: true,
    as_of: AS_OF,
    prydwen_slug: null,
    portrait: null,
    portrait_source: null,
    portrait_via: null,
    note: "Prydwen 人格名单 Last updated 08/October/2026，共 189 条，没有这名。Steam 2026-10-15 更新公告第 2 页写它是 3★ 新人格目标提取，并写它是 Season 8 人格。公告正文没有技能数值，不补技能。",
    verified: `Steam news 1846018067940411，as_of ${AS_OF}`,
  };
}

const BANNERS = [
  {
    id: "limbus-2026-10-15-haute-couture-sinclair",
    name: "New Identity Target Extraction: Haute Couture::The Crimson God of Le Rouge Sinclair",
    kind: "target_extraction",
    status: "current",
    names: ["Haute Couture::The Crimson God of Le Rouge Sinclair"],
    start: "2026-10-15T12:00:00+09:00",
    end: "2026-10-29T10:00:00+09:00",
    timezone: "Asia/Seoul",
    source: OCT15,
    note: "公告原文：(10/15 12:00 ~ 10/29 10:00 (KST))。3★ 概率提升。KST 与 Asia/Seoul 同为 UTC+9，无夏令时。维护结束时间为同公告第 1 页 12:00。",
  },
  {
    id: "limbus-2026-10-15-ishmael",
    name: "Target Extraction: Ishmael",
    kind: "target_extraction",
    status: "current",
    names: [
      "Haute Couture::Boutique du Rouge Ishmael",
      "LCD OSIR Team Ishmael",
      "The House of Spiders: The Middle Apprentice Ishmael",
      "Family Hierarch Candidate Ishmael",
      "Kurokumo Clan Captain Ishmael",
      "Zwei West Section 3 Ishmael",
      "The Pequod Captain Ishmael",
      "Molar Boatworks Fixer Ishmael",
      "Liu South Section 4 Ishmael",
      "R Corp. 4th Pack Reindeer Ishmael",
      "Edgar Family Butler Ishmael",
      "Lobotomy E.G.O::Sloshing Ishmael",
      "LCCB Assistant Manager Ishmael",
      "Shi South Section 5 Ishmael",
      "LCB Sinner Ishmael",
    ],
    start: "2026-10-15T12:00:00+09:00",
    end: "2026-10-29T10:00:00+09:00",
    timezone: "Asia/Seoul",
    source: OCT15,
    note: "同一页还列了 E.G.O，不写入人格 id：HE Christmas Nightmare Ishmael、Ardor Blossom Star Ishmael；TETH Bygone Days Ishmael。",
  },
  {
    id: "limbus-2026-10-15-the-ring",
    name: "Target Extraction: The Ring",
    kind: "target_extraction",
    status: "current",
    names: [
      "The Ring Fauvist Docent Rodion",
      "The Ring Fauvist Student Meursault",
      "The House of Spiders: The Ring Nursefather Hong Lu",
      "The House of Spiders: The Ring Apprentice Faust",
      "The Ring Pointillist Student Yi Sang",
      "The Ring Pointillist Student Outis",
    ],
    start: "2026-10-15T12:00:00+09:00",
    end: "2026-10-29T10:00:00+09:00",
    timezone: "Asia/Seoul",
    source: OCT15,
  },
  {
    id: "limbus-2026-10-01-don-quixote",
    name: "New Identity Target Extraction: Haute Couture::Le Noir Brand Manager Don Quixote",
    kind: "target_extraction",
    status: "ended",
    names: ["Haute Couture::Le Noir Brand Manager Don Quixote"],
    start: "2026-10-01T12:00:00+09:00",
    end: "2026-10-15T06:00:00+09:00",
    timezone: "Asia/Seoul",
    source: OCT1,
    note: "公告原文：(10/1 12:00 ~ 10/15 06:00 (KST))。3★。同页补了一条此前漏写的 E.G.O [TETH] Move-in Reg. Gregor，属于 Gregor 目标提取，不是这条人格。",
  },
  {
    id: "limbus-2026-10-01-gregor",
    name: "Target Extraction: Gregor",
    kind: "target_extraction",
    status: "ended",
    names: [
      "LCE E.G.O::AEDD Gregor",
      "Lobotomy E.G.O::Lamp Gregor",
      "Heishou Pack - Si Branch Gregor",
      "Firefist Office Survivor Gregor",
      "The Priest of La Manchaland Gregor",
      "Edgar Family Heir Gregor",
      "Twinhook Pirates First Mate Gregor",
      "Zwei South Section 4 Gregor",
      "G Corp. Manager Corporal Gregor",
      "Kurokumo Clan Captain Gregor",
      "Rosespanner Workshop Fixer Gregor",
      "R.B. Sous-chef Gregor",
      "Liu South Section 6 Gregor",
      "LCB Sinner Gregor",
    ],
    start: "2026-10-01T12:00:00+09:00",
    end: "2026-10-15T06:00:00+09:00",
    timezone: "Asia/Seoul",
    source: OCT1,
    note: "E.G.O 不写入人格 id：WAW Garden of Thorns Gregor；HE Christmas Nightmare Gregor；TETH Lantern Gregor、Move-in Reg. Gregor。",
  },
  {
    id: "limbus-2026-09-24-rodion",
    name: "New Identity Target Extraction: Haute Couture::Alteration Shop Rodion",
    kind: "target_extraction",
    status: "ended",
    names: ["Haute Couture::Alteration Shop Rodion"],
    start: "2026-09-24T12:00:00+09:00",
    end: "2026-10-08T06:00:00+09:00",
    timezone: "Asia/Seoul",
    source: SEP24,
    note: "公告原文：(9/24 12:00 ~ 10/8 06:00 (KST))。",
  },
  {
    id: "limbus-2026-09-17-haute-couture",
    name: "New Identity Target Extraction: Haute Couture Le Noir Footwear Hall Ryōshū and Boutique du Rouge Ishmael",
    kind: "target_extraction",
    status: "ended",
    names: [
      "Haute Couture::Le Noir Footwear Hall Ryōshū",
      "Haute Couture::Boutique du Rouge Ishmael",
    ],
    start: "2026-09-17T12:00:00+09:00",
    end: "2026-10-01T10:00:00+09:00",
    timezone: "Asia/Seoul",
    source: SEP17,
    note: "公告日期写成 26/9/17 12:00 ~ 26/10/1 10:00 (KST)，与同页礼包的 26. 09. 24 一样用两位年份。",
  },
  {
    id: "limbus-2026-09-17-meursault",
    name: "Target Extraction: Meursault",
    kind: "target_extraction",
    status: "ended",
    names: [
      "The Ring Fauvist Student Meursault",
      "The Prince of La Manchaland Meursault",
      "The Thumb East Capo IIII Meursault",
      "Cinq West Section 3 Meursault",
      "Dieci South Section 4 Director Meursault",
      "Blade Lineage Mentor Meursault",
      "R Corp. 4th Pack Rhino Meursault",
      "N Corp. Großhammer Meursault",
      "W Corp. L2 Cleanup Agent Meursault",
      "Dead Rabbits Boss Meursault",
      "Rosespanner Workshop Fixer Meursault",
      "Liu Assoc. South Section 6 Meursault",
      "LCB Sinner Meursault",
    ],
    start: "2026-09-17T12:00:00+09:00",
    end: "2026-10-08T10:00:00+09:00",
    timezone: "Asia/Seoul",
    source: SEP17,
    note: "公告写持续到 Oct. 8th，共 3 周。E.G.O 不写入人格 id：WAW Crushbound Past Meursault；HE Shadow-vested Bladesinger Meursault、Pursuance Meursault。对不上唯一人格 id 的名字留在 up，不写入 up_characters。",
  },
];

function matchName(name, cards) {
  const key = normName(name);
  const hits = cards.filter((card) => normName(card.name) === key || normName(card.name_en) === key);
  if (hits.length === 1) return hits[0];
  return null;
}

function applyBanners(cards) {
  const unmatched = [];
  const banners = BANNERS.map((row) => {
    const up = [];
    const upCharacters = [];
    for (const name of row.names) {
      up.push(name);
      const hit = matchName(name, cards);
      if (!hit) {
        unmatched.push({ banner: row.id, name });
        continue;
      }
      if (!upCharacters.some((item) => item.id === hit.id)) {
        upCharacters.push({ id: hit.id, name: hit.name });
      }
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      up,
      up_characters: upCharacters,
      start: row.start,
      end: row.end,
      timezone: row.timezone,
      source: row.source,
      as_of: AS_OF,
      ...(row.note ? { note: row.note } : {}),
    };
  });
  return { banners, unmatched };
}

function parseTeams(html, cards) {
  if (!html) return { teams: [], skipped: "no_html" };
  const byId = new Map(cards.map((card) => [card.id, card]));
  const blocks = html.split(/<h[1-6][^>]*>/).slice(1);
  const teams = [];
  for (const block of blocks) {
    const titleM = block.match(/^([\s\S]*?)<\/h[1-6]>/);
    const title = titleM ? decode(titleM[1]).replace(/\s+/g, " ").trim() : "";
    if (!title || /database|limbus company teams/i.test(title)) continue;
    const ids = [];
    const re = /\/limbus-company\/identities\/([a-z0-9-]+)/g;
    let m;
    while ((m = re.exec(block))) {
      if (byId.has(m[1]) && !ids.includes(m[1])) ids.push(m[1]);
    }
    if (ids.length < 2) continue;
    teams.push({ title, ids });
  }
  return { teams };
}

function applyTeams(cards, teams) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  let lines = 0;
  for (const team of teams) {
    if (team.ids.some((id) => !byId.has(id))) continue;
    const names = team.ids.map((id) => byId.get(id).name);
    const line = `Prydwen · ${team.title}：${names.join(" / ")}（${TEAM_URL} ，as_of ${AS_OF}）`;
    for (const id of team.ids) {
      const card = byId.get(id);
      if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
      if (!Array.isArray(card.teams.comp)) card.teams.comp = [];
      if (!card.teams.comp.includes(line)) card.teams.comp.push(line);
      if (!card.sources.includes(TEAM_URL)) card.sources.push(TEAM_URL);
      if (card.summary && Array.isArray(card.summary.sources) && !card.summary.sources.includes(TEAM_URL)) {
        card.summary.sources.push(TEAM_URL);
      }
    }
    lines += 1;
  }
  return lines;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publish(cards, bannerDoc, codesDoc, aliasDoc, guideIndex) {
  const v1 = path.join(SITE, "public", "v1", "guides", "limbus-company");
  const htmlDir = path.join(SITE, "public", "guides", "limbus-company");
  fs.mkdirSync(path.join(v1, "characters"), { recursive: true });
  fs.mkdirSync(htmlDir, { recursive: true });
  for (const card of cards) writeJson(path.join(v1, "characters", `${card.id}.json`), card);
  writeJson(path.join(v1, "index.json"), guideIndex);
  writeJson(path.join(v1, "aliases.json"), aliasDoc);
  writeJson(path.join(v1, "banners.json"), bannerDoc);
  writeJson(path.join(v1, "codes.json"), codesDoc);
  const rows = cards
    .map((card) => {
      const cls = card.stub ? "stub" : "rich";
      return `<tr><td><a href="${esc(card.id)}.html">${esc(card.id)}</a></td><td>${esc(card.name)}</td><td class="${cls}">${card.stub ? "stub" : "rich"}</td></tr>`;
    })
    .join("\n");
  const page = (title, body) => `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"/><title>${esc(title)}</title></head>
<body>${body}</body></html>
`;
  fs.writeFileSync(
    path.join(htmlDir, "index.html"),
    page(
      "边狱公司 攻略索引",
      `<h1>边狱公司</h1><p>as_of ${AS_OF} · ${cards.length} identities</p><table>${rows}</table>`
    )
  );
  for (const card of cards) {
    const skills = (card.skills || [])
      .map((skill) => `<li><strong>${esc(skill.name)}</strong> ${esc(skill.summary || "")}</li>`)
      .join("");
    fs.writeFileSync(
      path.join(htmlDir, `${card.id}.html`),
      page(
        card.name,
        `<p><a href="/character/?game=limbus-company&amp;id=${esc(card.id)}">人类界面</a></p><h1>${esc(card.name)}</h1><ul>${skills}</ul>`
      )
    );
  }
  const indexPath = path.join(DATA, "guides", "index.json");
  const publicIndex = path.join(SITE, "public", "v1", "guides", "index.json");
  for (const file of [indexPath, publicIndex]) {
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    const row = {
      id: "limbus-company",
      name: "Limbus Company",
      name_zh: "边狱公司",
      character_count: guideIndex.character_count,
      rich_count: guideIndex.rich_count,
      stub_count: guideIndex.stub_count,
      path: "guides/limbus-company",
    };
    const at = index.games.findIndex((game) => game.id === "limbus-company");
    if (at >= 0) index.games[at] = row;
    else index.games.push(row);
    index.games.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    writeJson(file, index);
  }
  const htmlIndex = path.join(SITE, "public", "guides", "index.html");
  let html = fs.readFileSync(htmlIndex, "utf8");
  const item = `<li><a href="./limbus-company/index.html"><strong>边狱公司</strong></a> (limbus-company) — ${guideIndex.character_count} chars (rich ${guideIndex.rich_count} / stub ${guideIndex.stub_count})</li>`;
  if (!html.includes("./limbus-company/index.html")) {
    html = html.replace("</ul>", `${item}\n</ul>`);
    fs.writeFileSync(htmlIndex, html);
  } else {
    html = html.replace(/<li><a href="\.\/limbus-company\/index.html">[\s\S]*?<\/li>/, item);
    fs.writeFileSync(htmlIndex, html);
  }
}

function codesDoc() {
  return {
    game: "limbus-company",
    as_of: AS_OF,
    checked: AS_OF,
    timezone: "Asia/Seoul",
    timezone_note: "官方公告写 KST。Asia/Seoul 与 KST 同为 UTC+9，没有夏令时。",
    sources: [
      "https://coupon.limbuscompany.site/",
      OCT15,
      "https://twinfinite.net/codes/limbus-company-codes/",
    ],
    note: "2026-10-17 核对：官方兑换站 coupon.limbuscompany.site 只是输入页，页面没有公布码。Steam 2026-10-15 更新公告第 5 页写的是维护补偿 Lunacy x300，进游戏邮箱领取，不是兑换码。Twinfinite 于 2026-10-15 写当前没有可用公开码，也没有列出过期码字符串。本文件不收录出处里没有写出的码。",
    codes: [],
  };
}

function main() {
  const checkMd = process.argv.indexOf("--check-md");
  if (checkMd >= 0) {
    const file = process.argv[checkMd + 1];
    const slug = path.basename(file, ".md");
    console.log(JSON.stringify(parseMarkdown(fs.readFileSync(file, "utf8"), slug), null, 2));
    return;
  }
  const check = process.argv.indexOf("--check-one");
  if (check >= 0) {
    const slug = process.argv[check + 1];
    const html = fs.readFileSync(path.join(HTML_DIR, `${slug}.html`), "utf8");
    const parsed = parseIdentity(html, slug);
    console.log(JSON.stringify({
      name: parsed.name,
      rarity: parsed.rarity,
      sinner: parsed.sinner && parsed.sinner.id,
      affinities: parsed.affinities,
      endgame: parsed.endgame,
      skills: parsed.skills.map((skill) => ({ name: skill.name, type: skill.type, sin: skill.sin, summary: skill.summary })),
      combat: parsed.combat,
      review: parsed.review.slice(0, 180),
    }, null, 2));
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const tiers = fs.existsSync(TIER_MD) ? parseTierMd(fs.readFileSync(TIER_MD, "utf8")) : new Map();
  const cards = [];
  const missingHtml = [];
  for (const row of catalog) {
    const file = path.join(HTML_DIR, `${row.slug}.html`);
    const mdFile = path.join(MD_DIR, `${row.slug}.md`);
    let parsed = null;
    if (fs.existsSync(file) && fs.statSync(file).size > 20_000) {
      parsed = parseIdentity(fs.readFileSync(file, "utf8"), row.slug);
    } else if (fs.existsSync(mdFile) && fs.statSync(mdFile).size > 400) {
      parsed = parseMarkdown(fs.readFileSync(mdFile, "utf8"), row.slug);
    } else missingHtml.push(row.slug);
    cards.push(buildCard(row, parsed, tiers.get(row.slug) || []));
  }
  if (!cards.some((card) => card.id === "haute-couture-the-crimson-god-of-le-rouge-sinclair")) {
    cards.push(stubFromNotice());
  }
  cards.sort((a, b) => {
    const ao = a.sinner ? a.sinner.order : 99;
    const bo = b.sinner ? b.sinner.order : 99;
    return ao - bo || String(a.id).localeCompare(String(b.id));
  });
  const { banners, unmatched } = applyBanners(cards);
  const teamFile = path.join(HTML_DIR, "_team-database.html");
  const teamParse = fs.existsSync(teamFile) ? parseTeams(fs.readFileSync(teamFile, "utf8"), cards) : { teams: [] };
  const teamCount = applyTeams(cards, teamParse.teams || []);
  const charDir = path.join(DATA, "guides", "limbus-company", "characters");
  fs.mkdirSync(charDir, { recursive: true });
  for (const old of fs.readdirSync(charDir)) {
    if (old.endsWith(".json")) fs.rmSync(path.join(charDir, old));
  }
  const aliases = {};
  for (const card of cards) {
    writeJson(path.join(charDir, `${card.id}.json`), card);
    const keys = [card.id, card.name, card.name_en].filter(Boolean);
    for (const key of keys) {
      if (!key || aliases[key]) continue;
      aliases[key] = { id: card.id, name: card.name, kind: "character" };
    }
  }
  const rich = cards.filter((card) => card.stub !== true).length;
  const bannerDoc = {
    game: "limbus-company",
    as_of: AS_OF,
    timezone: "Asia/Seoul",
    timezone_note: "公告写 KST。Asia/Seoul 与 UTC+9 同一偏移，没有夏令时。起止时间来自 Steam 公告图片里的文字，不是另行推算。",
    sources: [OCT15, OCT1, SEP24, SEP17],
    banners,
  };
  const codeDoc = codesDoc();
  const aliasDoc = {
    _meta: {
      game: "limbus-company",
      as_of: AS_OF,
      note: "Prydwen identity slug and display name. Sinner Chinese names are not aliases: one sinner has many identities.",
    },
    aliases,
  };
  writeJson(path.join(DATA, "guides", "limbus-company", "banners.json"), bannerDoc);
  writeJson(path.join(DATA, "guides", "limbus-company", "codes.json"), codeDoc);
  writeJson(path.join(DATA, "guides", "limbus-company", "aliases.json"), aliasDoc);
  const guideIndex = {
    game: "limbus-company",
    name: "Limbus Company",
    name_zh: "边狱公司",
    as_of: AS_OF,
    timezone: "Asia/Shanghai",
    character_count: cards.length,
    rich_count: rich,
    stub_count: cards.length - rich,
    conclusion_stub_count: cards.filter((card) => card.summary && card.summary.stub === true).length,
    links: {
      banners: "/v1/guides/limbus-company/banners.json",
      codes: "/v1/guides/limbus-company/codes.json",
    },
    characters: cards.map((card) => ({
      id: card.id,
      name: card.name,
      name_zh: card.name_zh || card.name,
      stub: card.stub === true,
      sources: card.sources || [],
      portrait: card.portrait || null,
      rarity: card.rarity || null,
      sinner: card.sinner
        ? { id: card.sinner.id, name_en: card.sinner.name_en, name_zh: card.sinner.name_zh, order: card.sinner.order }
        : null,
    })),
  };
  publish(cards, bannerDoc, codeDoc, aliasDoc, guideIndex);
  const noSinner = cards.filter((card) => !card.sinner).map((card) => card.id);
  console.log(JSON.stringify({
    cards: cards.length,
    rich,
    stub: cards.length - rich,
    conclusion_stub: guideIndex.conclusion_stub_count,
    missing_html: missingHtml.length,
    tier_slugs: tiers.size,
    teams: teamCount,
    banner_unmatched: unmatched,
    no_sinner: noSinner,
  }, null, 2));
}

main();
