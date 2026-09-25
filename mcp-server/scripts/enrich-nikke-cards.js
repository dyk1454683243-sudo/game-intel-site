#!/usr/bin/env node
/**
 * Enrich NIKKE stub character cards from GameKee 图鉴 CDN JSON and/or Prydwen HTML.
 * Never invent skill names — upgrade stub→rich only when real skill names found.
 *
 * Usage:
 *   node mcp-server/scripts/enrich-nikke-cards.js [--limit N] [--only id,id] [--dry-run] [--prydwen-only]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const CHAR_DIR = path.join(DATA, "guides", "nikke", "characters");
const GK = "https://www.gamekee.com";
const PRYDWEN = "https://www.prydwen.gg";
const AS_OF = "2026-09";
const DELAY_MS = 400;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Priority batch for first enrich (popular / meta / user-mentioned). */
const PRIORITY = [
  "rapi",
  "scarlet",
  "modernia",
  "alice",
  "anis",
  "neon",
  "dorothy",
  "liter",
  "privaty",
  "blanc",
  "noir",
  "scarlet-black-shadow",
  "rapi-red-hood",
  "helm",
  "harran",
  "alice-wonderland-bunny",
  "soda",
  "crown",
  "red-hood",
  "snow-white",
  "laplace",
  "maxwell",
  "drake",
  "naga",
  "tia",
  "dorothy-serendipity",
  "cinderella",
  "prika",
  "mint",
  "anis-star",
  "guillotine",
  "maiden",
  "rupee",
  "volume",
  "noise",
  "sugar",
  "novel",
  "pepper",
  "centi",
  "mast",
];

const SKIP_SKILL_NAMES = new Set([
  "",
  "待机",
  "技能名称",
  "—",
  "-",
  "无",
  "/",
  "／",
  "Normal Attack",
  "普通攻击",
  "爆裂技能",
  "爆裂技能名称",
  "爆裂技能图标",
  "技能1名称",
  "技能2名称",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRich(card) {
  if (!card) return false;
  if (card.stub === true) return false;
  if (card.stub === false) return true;
  return Array.isArray(card.skills) && card.skills.length > 0;
}

function curlText(url, extraHeaders = []) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    "30",
    "-A",
    UA,
    "-H",
    "Accept: text/html,application/json,*/*",
    "-H",
    `Referer: ${GK}/`,
    ...extraHeaders.flatMap((h) => ["-H", h]),
    url,
  ];
  const r = spawnSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`curl_fail_${r.status}: ${(r.stderr || "").slice(0, 120)}`);
  }
  return r.stdout || "";
}

function curlJson(url, extraHeaders = []) {
  const body = curlText(url, extraHeaders);
  if (body.startsWith("<!DOCTYPE") || body.startsWith("<html")) {
    throw new Error("http_html_blocked");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`bad_json_${body.slice(0, 40)}`);
  }
}

function rowTexts(row) {
  if (!Array.isArray(row)) return [];
  const out = [];
  for (const c of row) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "text" && typeof c.value === "string") {
      const v = c.value.replace(/\ufeff/g, "").trim();
      if (v) out.push(v);
    }
  }
  return out;
}

function mapSkillType(zh) {
  if (!zh) return null;
  if (/被动|Passive/i.test(zh)) return "passive";
  if (/爆裂|Burst|终极|大招/i.test(zh)) return "burst";
  if (/主动|Active/i.test(zh)) return "active";
  return null;
}

function labelValue(texts, label) {
  const i = texts.indexOf(label);
  if (i < 0) return null;
  const v = texts[i + 1];
  if (!v || v === label) return null;
  return v;
}

/** Parse NIKKE GameKee wiki baseData (技能1名称 / 技能2名称 / 爆裂技能). */
function parseNikkeWiki(inner) {
  const rows = Array.isArray(inner?.baseData) ? inner.baseData : [];
  const skills = [];
  const meta = {};
  let pendingType = null;
  let pendingSummary = null;
  let expectSummaryFor = null;

  const pushSkill = (name, typeHint) => {
    const n = String(name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!n || SKIP_SKILL_NAMES.has(n)) return null;
    const sk = { name: n };
    if (typeHint) sk.type = typeHint;
    skills.push(sk);
    return sk;
  };

  for (const row of rows) {
    const texts = rowTexts(row);
    if (!texts.length) continue;

    const take = (label, key) => {
      const v = labelValue(texts, label);
      if (v && meta[key] == null) meta[key] = v;
    };
    take("角色名称", "name_zh");
    take("稀有度", "rarity");
    take("企业", "manufacturer");
    take("属性", "element");
    take("职业", "role");
    take("武器", "weapon_type");
    take("武器（名）", "weapon");
    take("部队", "squad");

    if (texts[0] === "技能1名称" || texts.includes("技能1名称")) {
      const name = labelValue(texts, "技能1名称") || texts[1];
      expectSummaryFor = pushSkill(name, null);
      continue;
    }
    if (texts[0] === "技能2名称" || texts.includes("技能2名称")) {
      const name = labelValue(texts, "技能2名称") || texts[1];
      expectSummaryFor = pushSkill(name, null);
      continue;
    }
    // Newer pages: 爆裂技能 + name; older: 爆裂技能名称 + name
    if (texts.includes("爆裂技能名称") || texts[0] === "爆裂技能名称") {
      const name = labelValue(texts, "爆裂技能名称") || texts[1];
      if (name && name !== "爆裂技能图标" && name !== "爆裂技能") {
        expectSummaryFor = pushSkill(name, "burst");
        meta.burst_name = name;
      }
      continue;
    }
    if (texts[0] === "爆裂技能" || (texts.includes("爆裂技能") && !texts.includes("爆裂技能图标") && !texts.includes("爆裂技能名称"))) {
      const name = labelValue(texts, "爆裂技能") || texts[1];
      if (name && name !== "爆裂技能图标" && name !== "爆裂技能" && name !== "爆裂技能名称") {
        expectSummaryFor = pushSkill(name, "burst");
        meta.burst_name = name;
      }
      continue;
    }

    if (texts.includes("技能类型")) {
      const t = mapSkillType(labelValue(texts, "技能类型"));
      pendingType = t;
      if (expectSummaryFor && t && !expectSummaryFor.type) {
        expectSummaryFor.type = t;
      }
      continue;
    }

    // Capture lv1 description as summary (first level only)
    if (
      expectSummaryFor &&
      !expectSummaryFor.summary &&
      texts[0] &&
      /^lv\s*1$/i.test(texts[0]) &&
      texts[1]
    ) {
      expectSummaryFor.summary = texts[1].replace(/\s+/g, " ").trim().slice(0, 280);
      continue;
    }
  }

  // Dedup by name
  const seen = new Set();
  const uniq = [];
  for (const s of skills) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    uniq.push(s);
  }
  return { skills: uniq, meta };
}

async function fetchDetail(contentId) {
  const url = `${GK}/v1/content/detail/${contentId}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        "game-alias": "nikke",
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const detail = await res.json();
    if (detail.code !== 0 || !detail.data) {
      throw new Error(detail.msg || "detail_fail");
    }
    return detail.data;
  } catch (e) {
    // CF / network fallback via curl
    const detail = curlJson(url, ["game-alias: nikke"]);
    if (detail.code !== 0 || !detail.data) {
      throw new Error(detail.msg || e.message || "detail_fail");
    }
    return detail.data;
  }
}

async function fetchGameKeeWiki(contentId) {
  const d = await fetchDetail(contentId);
  let cdnUrl = d.content_cdn || "";
  if (!cdnUrl) throw new Error("no_content_cdn");
  if (cdnUrl.startsWith("//")) cdnUrl = `https:${cdnUrl}`;
  if (cdnUrl.startsWith("http://")) cdnUrl = cdnUrl.replace("http://", "https://");

  let cdn;
  try {
    cdn = curlJson(cdnUrl);
  } catch (e1) {
    try {
      cdn = curlJson(cdnUrl.split("?")[0]);
    } catch (e2) {
      throw new Error(`cdn_fail: ${e1.message}; ${e2.message}`);
    }
  }

  const raw = cdn.content;
  const inner = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = parseNikkeWiki(inner);
  return {
    title: d.title || null,
    desc: d.desc || d.summary || null,
    content_id: contentId,
    entry_id: d.entry_id ?? null,
    ...parsed,
  };
}

function parsePrydwenHtml(html) {
  const skills = [];
  // skill-name + skill-type pairs
  const re =
    /class="skill-icon[^"]*">([^<]+)<[\s\S]*?class="skill-name">([^<]+)<\/p>\s*<p class="skill-type">([^<]*)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const icon = m[1].trim();
    const name = m[2].replace(/\s+/g, " ").trim();
    const typeRaw = m[3].trim();
    if (!name || SKIP_SKILL_NAMES.has(name)) continue;
    if (/^Team\b/i.test(icon)) continue;
    let type = mapSkillType(typeRaw);
    if (!type) {
      if (/Burst/i.test(icon)) type = "burst";
      else if (/Skill/i.test(icon)) type = /Passive/i.test(typeRaw)
        ? "passive"
        : "active";
      else if (/Normal Attack/i.test(icon)) continue;
    }
    if (/Normal Attack/i.test(name)) continue;
    skills.push({
      name,
      ...(type ? { type } : {}),
      ...(typeRaw ? { type_label: typeRaw } : {}),
    });
  }

  // Fallback simpler pattern
  if (!skills.length) {
    const re2 =
      /class="skill-name">([^<]+)<\/p>\s*<p class="skill-type">([^<]*)<\/p>/gi;
    while ((m = re2.exec(html))) {
      const name = m[1].replace(/\s+/g, " ").trim();
      const typeRaw = m[2].trim();
      if (!name || SKIP_SKILL_NAMES.has(name) || /Normal Attack/i.test(name))
        continue;
      const type = mapSkillType(typeRaw);
      skills.push({ name, ...(type ? { type } : {}) });
    }
  }

  const seen = new Set();
  const uniq = [];
  for (const s of skills) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    // strip type_label from output card
    const { type_label, ...rest } = s;
    uniq.push(rest);
  }

  const meta = {};
  const burstM = html.match(/Burst Type\s*(I{1,3}|IV|\d)/i);
  if (burstM) meta.burst = burstM[1];
  return { skills: uniq, meta };
}

function fetchPrydwenSkills(slug) {
  const html = curlText(`${PRYDWEN}/nikke/characters/${slug}`);
  if (!/skill-name/i.test(html)) throw new Error("no_skill_markup");
  return parsePrydwenHtml(html);
}

function resolveContentId(card) {
  if (card.gamekee_content_id) return Number(card.gamekee_content_id);
  if (Array.isArray(card.sources)) {
    for (const u of card.sources) {
      const m = String(u).match(/gamekee\.com\/nikke\/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function resolvePrydwenSlug(card) {
  if (card.prydwen_slug) return card.prydwen_slug;
  if (card.id && fs.existsSync(path.join(CHAR_DIR, `${card.id}.json`))) {
    // id often IS the slug
    return card.id;
  }
  if (Array.isArray(card.sources)) {
    for (const u of card.sources) {
      const m = String(u).match(/prydwen\.gg\/nikke\/characters\/([a-z0-9-]+)/i);
      if (m) return m[1];
    }
  }
  return null;
}

function enrichFromGameKee(card, wiki) {
  const skills = wiki.skills.map((s) => {
    const o = { name: s.name };
    if (s.type) o.type = s.type;
    if (s.summary) o.summary = s.summary;
    return o;
  });
  if (skills.length < 1) return { ok: false, reason: "no_skills" };

  const next = { ...card };
  next.skills = skills;
  if (wiki.meta.burst_name) next.burst = wiki.meta.burst_name;
  if (wiki.meta.weapon) next.weapon = wiki.meta.weapon;
  if (wiki.meta.weapon_type && !next.weapon) next.weapon = wiki.meta.weapon_type;
  if (wiki.meta.element) next.element = wiki.meta.element;
  if (wiki.meta.manufacturer) next.manufacturer = wiki.meta.manufacturer;
  if (wiki.meta.role) next.role = wiki.meta.role;
  if (wiki.meta.name_zh) {
    next.name_zh = wiki.meta.name_zh;
    next.name = wiki.meta.name_zh;
  }
  if (wiki.meta.rarity) next.rarity = wiki.meta.rarity;

  const src = `${GK}/nikke/${wiki.content_id}.html`;
  const sources = Array.isArray(next.sources) ? [...next.sources] : [];
  if (!sources.includes(src)) sources.unshift(src);
  next.sources = sources;
  next.gamekee_content_id = wiki.content_id;
  if (wiki.entry_id != null) next.gamekee_entry_id = wiki.entry_id;
  next.stub = false;
  delete next.note;
  delete next.enrich_attempted;
  next.as_of = AS_OF;
  next.verified = `GameKee nikke/${wiki.content_id} 图鉴`;
  return { ok: true, card: next, skill_count: skills.length, via: "gamekee" };
}

function enrichFromPrydwen(card, parsed, slug) {
  const skills = parsed.skills;
  if (!skills.length) return { ok: false, reason: "no_skills" };
  const next = { ...card };
  next.skills = skills;
  if (parsed.meta.burst) next.burst = `Burst ${parsed.meta.burst}`;
  const src = `${PRYDWEN}/nikke/characters/${slug}`;
  const sources = Array.isArray(next.sources) ? [...next.sources] : [];
  if (!sources.includes(src)) sources.push(src);
  next.sources = sources;
  next.prydwen_slug = slug;
  next.stub = false;
  delete next.note;
  delete next.enrich_attempted;
  next.as_of = AS_OF;
  next.verified = `Prydwen /nikke/characters/${slug}`;
  return { ok: true, card: next, skill_count: skills.length, via: "prydwen" };
}

function listStubCards() {
  return fs
    .readdirSync(CHAR_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const card = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, f), "utf8"));
      return { file: f, card };
    })
    .filter(({ card }) => !isRich(card));
}

function orderCards(stubs, onlyIds) {
  const byId = new Map(stubs.map((s) => [s.card.id, s]));
  const out = [];
  const used = new Set();
  const prefer = onlyIds?.length ? onlyIds : PRIORITY;
  for (const id of prefer) {
    if (byId.has(id)) {
      out.push(byId.get(id));
      used.add(id);
    }
  }
  if (!onlyIds?.length) {
    for (const s of stubs) {
      if (!used.has(s.card.id)) out.push(s);
    }
  }
  return out;
}

function updateGuidesIndex() {
  const indexPath = path.join(DATA, "guides", "index.json");
  if (!fs.existsSync(indexPath)) return null;
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const files = fs.readdirSync(CHAR_DIR).filter((f) => f.endsWith(".json"));
  let rich = 0;
  let stub = 0;
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, f), "utf8"));
    if (isRich(c)) rich++;
    else stub++;
  }
  const nikke = (index.games || []).find((g) => g.id === "nikke");
  if (nikke) {
    nikke.character_count = files.length;
    nikke.rich_count = rich;
    nikke.stub_count = stub;
  }
  index.as_of = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  return { character_count: files.length, rich_count: rich, stub_count: stub };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const prydwenOnly = args.includes("--prydwen-only");
  let limit = Infinity;
  const li = args.indexOf("--limit");
  if (li >= 0) limit = Number(args[li + 1]) || Infinity;
  let only = null;
  const oi = args.indexOf("--only");
  if (oi >= 0) {
    only = String(args[oi + 1] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const stubs = listStubCards();
  const queue = orderCards(stubs, only).slice(0, limit);

  const summary = {
    ok: true,
    dry_run: dry,
    attempted: 0,
    enriched: 0,
    still_stub: 0,
    skipped_no_source: 0,
    errors: [],
    enriched_ids: [],
    failed_ids: [],
  };

  for (const { file, card } of queue) {
    summary.attempted++;
    const contentId = resolveContentId(card);
    const slug = resolvePrydwenSlug(card);
    let result = null;
    let lastErr = null;

    try {
      if (!prydwenOnly && contentId) {
        try {
          const wiki = await fetchGameKeeWiki(contentId);
          result = enrichFromGameKee(card, wiki);
          if (!result.ok) lastErr = result.reason;
        } catch (e) {
          lastErr = e.message;
        }
      }
      if ((!result || !result.ok) && slug) {
        try {
          const parsed = fetchPrydwenSkills(slug);
          result = enrichFromPrydwen(card, parsed, slug);
          if (!result.ok) lastErr = result.reason;
        } catch (e) {
          lastErr = e.message;
        }
      }
      if (!contentId && !slug) {
        summary.skipped_no_source++;
        summary.failed_ids.push({ id: card.id, reason: "no_source" });
        continue;
      }
    } catch (e) {
      lastErr = e.message;
    }

    if (result?.ok) {
      summary.enriched++;
      summary.enriched_ids.push({
        id: card.id,
        skills: result.skill_count,
        via: result.via,
      });
      if (!dry) {
        fs.writeFileSync(
          path.join(CHAR_DIR, file),
          JSON.stringify(result.card, null, 2) + "\n"
        );
      }
    } else {
      summary.still_stub++;
      summary.failed_ids.push({ id: card.id, reason: lastErr || "unknown" });
      if (!dry) {
        const attemptedSources = [];
        if (contentId) attemptedSources.push(`${GK}/nikke/${contentId}.html`);
        if (slug) attemptedSources.push(`${PRYDWEN}/nikke/characters/${slug}`);
        fs.writeFileSync(
          path.join(CHAR_DIR, file),
          JSON.stringify(
            {
              ...card,
              enrich_attempted: {
                at: AS_OF,
                reason: lastErr || "no_skills",
                sources: attemptedSources,
              },
            },
            null,
            2
          ) + "\n"
        );
      }
    }

    await sleep(DELAY_MS);
  }

  if (!dry) summary.index = updateGuidesIndex();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
