#!/usr/bin/env node
/**
 * Build Zenless Zone Zero agent cards from public sources.
 *
 * - Roster, skills, factions, skill priority, teams: BWIKI wikitext
 *   https://wiki.biligame.com/zzz/角色图鉴
 * - Portraits / English slugs: Prydwen agent list (already fetched text) plus
 *   GameKee entry icons when the display name matches one entry.
 * - Does not invent tiers. summary.stub stays true unless a later pass
 *   copies a named rating.
 *
 * Usage: node mcp-server/scripts/import-zzz-catalog.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const OUT_DIR = path.join(DATA, "guides", "zenless-zone-zero", "characters");
const ALIAS_PATH = path.join(DATA, "guides", "zenless-zone-zero", "aliases.json");
const AS_OF = "2026-10-17";
const UA = "game-intel-catalog/0.3.19";
const BWIKI = "https://wiki.biligame.com/zzz";
const GK = "https://www.gamekee.com";
const ENTRY_LIST = `${GK}/v1/entry/list?page_no=1&limit=2000`;
const PRY_LIST = "https://www.prydwen.gg/zenless/characters";
const CHAR_FOLDER_PID = 148506;

const EXTRA_TITLES = ["菲欧妮", "赛维里安", "卡芙卡", "知更鸟"];

function clean(s) {
  return String(s || "")
    .replace(/\ufeff/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function cleanWiki(raw) {
  let s = String(raw || "");
  s = s.replace(/\{\{图标\|按钮\|([^}|]+)\}\}/g, "$1");
  s = s.replace(/\{\{图标\/小\|([^}|]+)(?:\|[^}]*)?\}\}/g, "$1");
  s = s.replace(/\{\{颜色\|[^|]+\|([^}]+)\}\}/g, "$1");
  s = s.replace(/\{\{黑幕\|([^}]+)\}\}/g, "$1");
  s = s.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/'''?/g, "");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function allFields(block) {
  const text = String(block || "");
  const re = /(?:^|\n)[ \t]*\|([^=\n]+)=/g;
  const marks = [...text.matchAll(re)];
  const map = {};
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    map[marks[i][1].trim()] = text.slice(start, end).trim();
  }
  return map;
}

function isHollowSkill(name, summary) {
  const n = String(name || "").trim();
  const s = String(summary || "").trim();
  if (!n || !s || s.length < 12) return true;
  if (/[：:]$/.test(n)) return true;
  if (/^点按[^。；]{0,16}发动：?$/.test(s)) return true;
  return false;
}

const CACHE = "/tmp/zzz/wiki-cache";

function cachePath(url) {
  const sha = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
  const b64 = Buffer.from(url).toString("base64url");
  const legacy = path.join(CACHE, b64);
  if (fs.existsSync(sha)) return sha;
  if (b64.length < 240 && fs.existsSync(legacy)) return legacy;
  return sha;
}

async function getText(url, headers = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const cached = cachePath(url);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
    return fs.readFileSync(cached, "utf8");
  }
  let last = "fetch_failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 700 * attempt));
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/json,*/*",
        Referer: "https://wiki.biligame.com/zzz/",
        ...headers,
      },
      signal: AbortSignal.timeout(40000),
    });
    if (res.status === 567 || res.status === 429 || res.status === 503) {
      last = `http_${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    const text = await res.text();
    fs.writeFileSync(cached, text);
    return text;
  }
  throw new Error(last);
}

function parseRoster(html) {
  const re =
    /<div class="role-box divsort" data-param1="([^"]*)" data-param2="([^"]*)" data-param3="([^"]*)" data-param4="([^"]*)">[\s\S]*?<a href="\/zzz\/([^"]+)"/g;
  const rows = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const title = clean(decodeURIComponent(m[5]));
    if (!title || seen.has(title)) continue;
    seen.add(title);
    rows.push({
      title,
      rarity: clean(m[1]),
      element: clean(m[2]),
      faction: clean(m[3]),
      role: clean(m[4]),
    });
  }
  return rows;
}

async function fetchWikitext(title) {
  const url = `${BWIKI}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
  const body = JSON.parse(await getText(url));
  if (body?.error) return null;
  const wt = body?.parse?.wikitext;
  const text = typeof wt === "string" ? wt : wt?.["*"] || "";
  return text || null;
}

async function fetchRevisions(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const url = `${BWIKI}/api.php?action=query&prop=revisions&rvprop=timestamp&format=json&titles=${encodeURIComponent(chunk.join("|"))}`;
    const body = JSON.parse(await getText(url));
    const pages = body?.query?.pages || {};
    for (const page of Object.values(pages)) {
      const title = page.title;
      const ts = page.revisions?.[0]?.timestamp || "";
      if (title) out.set(title, ts.slice(0, 10));
    }
  }
  return out;
}

function skillSection(text) {
  const parts = String(text || "").split("==技能==");
  if (parts.length < 2) return "";
  let region = parts[1].split("==角色搭配推荐==")[0];
  const idx = region.search(/\n\|加强=/);
  if (idx >= 0) region = region.slice(idx);
  return region;
}

const TYPE_KEYS = [
  ["普攻", "basic"],
  ["闪避", "dodge"],
  ["特殊技", "special"],
  ["连携技", "chain"],
  ["终结技", "ultimate"],
  ["支援技", "assist"],
  ["支援", "assist"],
  ["核心技", "core"],
];

const OLD_SKILL_ORDER = [
  ["普攻", "basic"],
  ["强化普攻", "basic"],
  ["闪避", "dodge"],
  ["冲刺攻击", "dodge"],
  ["冲刺攻击2", "dodge"],
  ["闪避反击", "dodge"],
  ["特殊技", "special"],
  ["强化特殊技", "special"],
  ["强化特殊技2", "special"],
  ["连携技", "chain"],
  ["连携技2", "chain"],
  ["终结技", "ultimate"],
  ["快速支援", "assist"],
  ["受击支援", "assist"],
  ["招架支援", "assist"],
  ["支援突击", "assist"],
  ["核心被动", "core"],
  ["额外能力", "additional"],
];

function skillType(region, index, name) {
  if (name.startsWith("终结技")) return "ultimate";
  if (name.startsWith("连携技")) return "chain";
  if (name.startsWith("普通攻击") || name.startsWith("强化普攻")) return "basic";
  if (name.startsWith("闪避") || name.startsWith("冲刺")) return "dodge";
  if (name.startsWith("特殊技") || name.startsWith("强化特殊技")) return "special";
  if (name.startsWith("核心")) return "core";
  if (name.startsWith("额外能力")) return "additional";
  if (name.includes("支援")) return "assist";
  const before = region.slice(0, index);
  let found = null;
  let at = -1;
  for (const [key, type] of TYPE_KEYS) {
    const i = before.lastIndexOf(`|${key}=`);
    if (i > at) {
      at = i;
      found = type;
    }
  }
  if (name.startsWith("额外能力")) return "additional";
  if (name.startsWith("核心被动")) return "core";
  return found || "skill";
}

function pushSkill(skills, seen, name, summary, type) {
  const n = cleanWiki(name);
  const s = cleanWiki(summary);
  if (isHollowSkill(n, s)) return;
  const key = `${n}\n${s}`;
  if (seen.has(key)) return;
  seen.add(key);
  skills.push({ name: n, type, summary: s });
}

function parseNewSkills(text) {
  const region = skillSection(text);
  if (!region.includes("{{角色/技能/项")) return [];
  const re = /\{\{角色\/技能\/项([\s\S]*?)\n\s*\}\}/g;
  const skills = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(region))) {
    const map = allFields(m[1]);
    pushSkill(skills, seen, map["名称"], map["描述"], skillType(region, m.index, cleanWiki(map["名称"] || "")));
  }
  return skills;
}

function parseOldSkills(text) {
  const i = String(text || "").indexOf("{{角色技能");
  if (i < 0) return [];
  const region = text.slice(i).split("==角色搭配推荐==")[0];
  const map = allFields(region);
  const skills = [];
  const seen = new Set();
  for (const [key, type] of OLD_SKILL_ORDER) {
    pushSkill(skills, seen, map[key], map[`${key}描述`], type);
  }
  return skills;
}

function parseSkills(text) {
  const newer = parseNewSkills(text);
  const older = parseOldSkills(text);
  return newer.length >= older.length ? newer : older;
}

function parseSkillPrio(text) {
  const map = allFields(String(text || "").split("==角色相关==")[0]);
  const line = cleanWiki(map["技能升级推荐"] || "");
  if (!line || line.length < 2 || /\{\{/.test(line)) return [];
  return [`BWIKI 技能升级推荐：${line}`];
}

function parseTeams(text) {
  const rows = [];
  const re = /\{\{角色\/配队表([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    const map = allFields(m[1]);
    const members = ["角色1", "角色2", "角色3"].map((key) => cleanWiki(map[key] || "")).filter(Boolean);
    if (members.length < 2) continue;
    const before = text.slice(Math.max(0, m.index - 180), m.index);
    const tab = before.match(/\|-\|([^|=\n]{1,24})=/);
    rows.push({ members, label: tab ? cleanWiki(tab[1]) : "配队表" });
  }
  return rows;
}

function parseInfobox(text) {
  const head = String(text || "").split(/==/)[0];
  const map = allFields(head);
  const pick = (key) => cleanWiki(map[key] || "");
  return {
    full: pick("全名"),
    name_en: pick("英文名称"),
    faction: pick("阵营"),
    rarity: pick("稀有度"),
    element: pick("属性"),
    role: pick("特性"),
    attack_type: pick("伤害类型"),
    nick: pick("昵称/外号"),
  };
}

function toPinyinId(name) {
  const py = pinyin(name, { toneType: "none", type: "array" })
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return py && py.length >= 2 ? py : "";
}

function normEn(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function loadPrydwen() {
  const file = "/tmp/zzz/pry-list.json";
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const SLUG_OVERRIDE = {
  丽娜: "rina",
  猫又: "nekomata",
};

function pryLabel(row) {
  return String(row.label || "")
    .replace(/\s+(3\.3|3\.x|New|HSR)$/i, "")
    .trim();
}

function tokenSet(s) {
  return normEn(s).split(" ").filter(Boolean);
}

function scorePrydwen(info, row) {
  const forced = SLUG_OVERRIDE[info.title];
  if (forced) return row.slug === forced ? 1000 : 0;
  const en = tokenSet(info.name_en);
  if (!en.length) return 0;
  const label = tokenSet(pryLabel(row));
  if (!label.length) return 0;
  const enSet = new Set(en);
  const labelSet = new Set(label);
  const overlap = label.filter((t) => enSet.has(t)).length;
  const allLabel = overlap === label.length;
  const allEn = en.every((t) => labelSet.has(t));
  if (!allLabel && !allEn) return 0;
  return overlap * 10 + label.length + (allLabel && allEn ? 50 : 0);
}

function matchPrydwen(info, prydwen) {
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const row of prydwen) {
    const score = scorePrydwen(info, row);
    if (!score) continue;
    if (score > bestScore) {
      best = row;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) tie = true;
  }
  if (!best || tie) return null;
  return best;
}

function normZh(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[·・]/g, "")
    .replace(/[「」"']/g, "");
}

async function fetchGameKee() {
  const body = JSON.parse(
    await getText(ENTRY_LIST, { "game-alias": "zzz", Accept: "application/json" })
  );
  if (body.code !== 0 || !Array.isArray(body.data)) throw new Error("bad_entry_list");
  return body.data.filter((x) => x.pid === CHAR_FOLDER_PID && !x.is_del && x.content_id);
}

function matchGameKee(card, rows) {
  const keys = new Set(
    [card.name, card.name_zh, ...(card.aliases || [])].map(normZh).filter((x) => x.length >= 2)
  );
  const hits = rows.filter((row) => keys.has(normZh(row.name)));
  if (hits.length !== 1) return null;
  return hits[0];
}

function wikiUrl(title) {
  return `${BWIKI}/${encodeURIComponent(title)}`;
}

function positionOf(card) {
  return [card.rarity, card.element, card.role, card.faction].filter(Boolean).join(" / ");
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function splitNicks(raw, name) {
  return cleanWiki(raw)
    .split(/[、,，/]/)
    .map((x) => x.trim())
    .filter((x) => x && x !== name && x.length <= 16);
}

async function main() {
  const rosterHtml = await getText(`${BWIKI}/${encodeURIComponent("角色图鉴")}`);
  const roster = parseRoster(rosterHtml);
  const have = new Set(roster.map((r) => r.title));
  for (const title of EXTRA_TITLES) {
    if (!have.has(title)) roster.push({ title, rarity: "", element: "", faction: "", role: "", extra: true });
  }
  console.error(`roster ${roster.length}`);

  const prydwen = loadPrydwen();
  const pages = await mapPool(roster, 2, async (row) => {
    try {
      const text = await fetchWikitext(row.title);
      return { ...row, text };
    } catch (e) {
      console.error("wiki fail", row.title, e.message);
      return { ...row, text: null };
    }
  });
  let revisions = new Map();
  try {
    revisions = await fetchRevisions(pages.filter((p) => p.text).map((p) => p.title));
  } catch (e) {
    console.error("revisions", e.message);
  }
  let gamekee = [];
  try {
    gamekee = await fetchGameKee();
  } catch (e) {
    console.error("gamekee", e.message);
  }

  const drafts = [];
  const usedIds = new Set();
  for (const page of pages) {
    if (!page.text || !page.text.includes("{{角色图鉴") && !page.text.includes("|名称=")) {
      console.error("no infobox", page.title);
      continue;
    }
    const info = parseInfobox(page.text);
    const name = page.title;
    const pry = matchPrydwen({ ...info, title: name }, prydwen);
    let id = pry?.slug || toPinyinId(name) || toPinyinId(page.title);
    if (!id) id = `c-${drafts.length}`;
    if (usedIds.has(id)) {
      console.error("id collision", id, name);
      id = `${id}-2`;
    }
    usedIds.add(id);
    const skills = parseSkills(page.text);
    const avg = skills.length
      ? skills.reduce((n, s) => n + s.summary.length, 0) / skills.length
      : 0;
    const stub = skills.length < 6 || avg < 30;
    const skill_prio = parseSkillPrio(page.text);
    const teamDrafts = parseTeams(page.text);
    const aliases = [];
    if (info.full && info.full !== name && !info.full.includes("PAGENAME")) aliases.push(info.full);
    const sources = [wikiUrl(page.title)];
    if (pry) sources.push(`https://www.prydwen.gg/zenless/characters/${pry.slug}`);
    const rev = revisions.get(page.title) || "";
    const card = {
      id,
      name,
      name_zh: name,
      name_en: info.name_en || pry?.label || null,
      aliases,
      nicknames: splitNicks(info.nick, name),
      game: "zenless-zone-zero",
      role: info.role || page.role || null,
      rarity: info.rarity || page.rarity || null,
      element: info.element || page.element || null,
      faction: info.faction || page.faction || null,
      attack_type: info.attack_type || null,
      skills,
      skill_prio,
      weapon: null,
      teams: {},
      sources,
      stub,
      as_of: AS_OF,
      wiki_title: page.title,
      wiki_revised: rev || null,
      prydwen_slug: pry?.slug || null,
      _teams: teamDrafts,
      verified: `BWIKI「${page.title}」图鉴 wikitext${rev ? `，页面修订 ${rev}` : ""}`,
      ...(skills.length === 0
        ? { note: "BWIKI 该页技能模板没有写具体效果。属性、稀有度和阵营来自同一页图鉴。不编造技能。" }
        : stub
          ? { note: "BWIKI 该页只写了一部分技能，未写全的招式不收录。" }
          : {}),
    };
    if (!card.attack_type) delete card.attack_type;
    drafts.push(card);
    console.error(
      `${id}\t${name}\t${info.name_en || "-"}\t${pry?.slug || "NO_SLUG"}\tskills ${skills.length}\tteams ${teamDrafts.length}`
    );
  }

  const byExact = new Map();
  function bind(key, id) {
    const k = clean(key);
    if (!k) return;
    const prev = byExact.get(k);
    if (prev && prev !== id) byExact.set(k, null);
    else if (!prev) byExact.set(k, id);
  }
  for (const card of drafts) {
    bind(card.name, card.id);
    bind(card.name_zh, card.id);
    for (const a of card.aliases) bind(a, card.id);
  }
  function resolveName(raw) {
    const k = clean(raw);
    if (!k || !byExact.has(k)) return null;
    return byExact.get(k);
  }

  const cardsById = new Map(drafts.map((c) => [c.id, c]));
  for (const card of drafts) {
    const lines = [];
    const seen = new Set();
    for (const team of card._teams) {
      const ids = team.members.map(resolveName);
      if (ids.some((id) => !id)) continue;
      if (new Set(ids).size !== ids.length) continue;
      const names = ids.map((id) => cardsById.get(id).name);
      const sig = ids.join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      const url = wikiUrl(card.wiki_title);
      lines.push({
        ids,
        text: `BWIKI · 阵容搭配 · ${team.label}：${names.join(" / ")}（${url} ，as_of ${AS_OF}）`,
        url,
      });
    }
    card._resolvedTeams = lines;
  }
  for (const card of drafts) {
    const bag = [];
    const seen = new Set();
    const own = card._resolvedTeams || [];
    const incoming = [];
    for (const other of drafts) {
      if (other.id === card.id) continue;
      for (const line of other._resolvedTeams || []) {
        if (line.ids.includes(card.id)) incoming.push(line);
      }
    }
    for (const line of [...own, ...incoming]) {
      if (seen.has(line.text) || bag.length >= 6) continue;
      seen.add(line.text);
      bag.push(line.text);
      if (!card.sources.includes(line.url)) card.sources.push(line.url);
    }
    if (bag.length) card.teams = { comp: bag };
  }

  for (const card of drafts) {
    const gk = matchGameKee(card, gamekee);
    if (gk) {
      const icon = String(gk.icon || "").startsWith("//") ? `https:${gk.icon}` : String(gk.icon || "");
      card.gamekee_content_id = gk.content_id;
      card.gamekee_entry_id = gk.id;
      const gkUrl = `${GK}/zzz/${gk.content_id}.html`;
      if (!card.sources.includes(gkUrl)) card.sources.push(gkUrl);
      if (icon.startsWith("https://cdnimg-v2.gamekee.com/wiki2.0/images/")) {
        card.portrait = icon;
        card.portrait_source = ENTRY_LIST;
        card.portrait_via = `gamekee-entry-icon:zzz:${gk.id}`;
      }
    }
    if (!card.portrait) {
      const slug = card.prydwen_slug;
      if (slug) {
        card.portrait = `https://cdn.prydwen.gg/images/zenless-zone-zero/characters/${slug}_card.webp`;
        card.portrait_source = `https://www.prydwen.gg/zenless/characters/${slug}`;
        card.portrait_via = `prydwen-character:${slug}`;
        if (!card.sources.includes(card.portrait_source)) card.sources.push(card.portrait_source);
      } else {
        card.portrait = null;
        card.portrait_source = null;
        card.portrait_via = null;
      }
    }
    const pos = positionOf(card);
    if (!card.stub) {
      card.summary = {
        position: pos || "图鉴未标定位",
        sources: card.sources.filter((u) => /^https:\/\//.test(u)),
        stub: true,
        caveat:
          "技能、属性、稀有度、阵营与技能升级推荐摘自 BWIKI 角色图鉴 wikitext。Prydwen 3.2 梯度页（2026-09-30）的公开文本没有把 T 档和角色名绑在一起，本卡不编造强度或抽卡结论。",
      };
    }
    delete card._teams;
    delete card._resolvedTeams;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith(".json")) fs.rmSync(path.join(OUT_DIR, file));
  }
  for (const card of drafts) {
    const { wiki_title, wiki_revised, ...out } = card;
    if (wiki_revised) out.wiki_revised = wiki_revised;
    fs.writeFileSync(path.join(OUT_DIR, `${out.id}.json`), JSON.stringify(out, null, 2) + "\n");
  }

  const aliases = {};
  const put = (key, id, name) => {
    const k = clean(key);
    if (!k || aliases[k]) return;
    aliases[k] = { id, name, kind: "character" };
  };
  for (const card of drafts) {
    put(card.id, card.id, card.name);
    put(card.name, card.id, card.name);
    put(card.name_en, card.id, card.name);
    put(card.prydwen_slug, card.id, card.name);
    for (const a of card.aliases) put(a, card.id, card.name);
    for (const n of card.nicknames) put(n, card.id, card.name);
  }
  const aliasDoc = {
    _meta: {
      game: "zenless-zone-zero",
      note: "BWIKI 名称 / 全名 / 英文名，以及能唯一对上的 Prydwen slug。不编造外号。",
      as_of: AS_OF,
    },
    aliases,
  };
  fs.writeFileSync(ALIAS_PATH, JSON.stringify(aliasDoc, null, 2) + "\n");

  const rich = drafts.filter((c) => !c.stub).length;
  const withTeams = drafts.filter((c) => c.teams && c.teams.comp && c.teams.comp.length).length;
  const report = {
    cards: drafts.length,
    rich,
    stub: drafts.length - rich,
    with_teams: withTeams,
    prydwen: drafts.filter((c) => c.prydwen_slug).length,
    gamekee: drafts.filter((c) => c.gamekee_content_id).length,
    portraits: drafts.filter((c) => c.portrait).length,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
