#!/usr/bin/env node
/**
 * Enrich BD2 stub cards from GameKee 图鉴 CDN (baseData + styleData 服装/技能).
 * Node fetch often CF-blocked on api-cdn — use curl. Never invent skill names/numbers.
 *
 * Usage:
 *   node mcp-server/scripts/enrich-bd2-cards.js [--limit N] [--only id,id] [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const CHAR_DIR = path.join(DATA, "guides", "bd2", "characters");
const GK = "https://www.gamekee.com";
const GAME_ALIAS = "zsca2";
const AS_OF = "2026-09";
const DELAY_MS = 400;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PRIORITY = [
  "sylvia",
  "rou",
  "goblin_slayer",
  "nevendaria",
  "mammonile",
  "palette",
  "granade",
  "dalian",
  "tir",
  "sonia",
  "oliver",
  "glansheit",
  "holy_ustia",
  "micaela",
  "diana",
  "yamashiro_ren",
  "izumo_tenka",
  "uzen_kyoka",
  "yukiizumi",
  "hikage",
  "yozakura",
  "utage",
  "ikaros",
  "levita",
  "blade",
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
  "技能名",
]);

const META_LABELS = {
  角色名称: "name_zh",
  英文名: "name_en",
  星级: "rarity",
  元素属性: "element",
  攻击属性: "attack_type",
  角色定位: "role",
  装备名称: "weapon",
  天赋名称: "talent_name",
};

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
    "35",
    "-A",
    UA,
    "-H",
    "Accept: application/json,text/plain,*/*",
    "-H",
    `Referer: ${GK}/`,
    ...extraHeaders.flatMap((h) => ["-H", h]),
    url,
  ];
  const r = spawnSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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

function labelValue(texts, label) {
  const i = texts.indexOf(label);
  if (i < 0) return null;
  const v = texts[i + 1];
  if (!v || v === label) return null;
  return v;
}

function parseBaseMeta(baseData) {
  const meta = {};
  let talentSummary = null;
  for (const row of baseData || []) {
    const texts = rowTexts(row);
    if (!texts.length) continue;
    for (const [label, key] of Object.entries(META_LABELS)) {
      if (texts.includes(label) && meta[key] == null) {
        const v = labelValue(texts, label);
        if (v) meta[key] = v;
      }
    }
    // talent legend tier
    if (texts[0] === "传说" && texts[1]) talentSummary = texts[1];
  }
  if (meta.talent_name) {
    meta.talent = {
      name: meta.talent_name,
      summary: talentSummary || null,
    };
    delete meta.talent_name;
  }
  return meta;
}

function pickSkillSummary(rows) {
  // Prefer 满破满潜力 / 满破满潜能 effect text; else highest +N.
  let best = null;
  let bestPlus = -1;
  let full = null;
  for (const row of rows) {
    const texts = rowTexts(row);
    if (!texts.length) continue;
    const head = texts[0];
    if (/^满破满潜/.test(head) || head === "满破满潜力" || head === "满破满潜能") {
      const effect = texts[texts.length - 1];
      if (effect && effect !== head && !/^(技能|SP|CD|范围)/.test(effect)) {
        full = effect;
      } else if (texts.length >= 4) {
        full = texts[3];
      }
    }
    const m = /^\+(\d+)$/.exec(head);
    if (m) {
      const n = Number(m[1]);
      const effect = texts[texts.length - 1];
      if (
        n >= bestPlus &&
        effect &&
        effect !== head &&
        !/^(技能|SP|CD|范围)/.test(effect)
      ) {
        bestPlus = n;
        best = effect;
      }
    }
  }
  return full || best || null;
}

function parseCostume(skin) {
  const rows = skin?.data || [];
  let costumeName = null;
  let costumeType = null;
  let skillName = null;
  const skillRows = [];

  for (const row of rows) {
    const texts = rowTexts(row);
    if (!texts.length) continue;
    if (texts.includes("服装名称") || texts.includes("时装名称")) {
      costumeName =
        labelValue(texts, "服装名称") ||
        labelValue(texts, "时装名称") ||
        costumeName;
    }
    if (texts.includes("服装类别") || texts.includes("时装类别")) {
      costumeType =
        labelValue(texts, "服装类别") ||
        labelValue(texts, "时装类别") ||
        costumeType;
    }
    if (texts.includes("技能名称") || texts.includes("技能名")) {
      skillName =
        labelValue(texts, "技能名称") ||
        labelValue(texts, "技能名") ||
        skillName;
    }
    if (/^\+\d+$/.test(texts[0]) || /^满破满潜/.test(texts[0])) {
      skillRows.push(row);
    }
  }

  if (!skillName || SKIP_SKILL_NAMES.has(skillName)) return null;
  const summary = pickSkillSummary(skillRows);
  return {
    costume: costumeName || skin.name || null,
    costume_type: costumeType || null,
    skill_name: skillName.replace(/\s+/g, " ").trim(),
    summary: summary ? summary.replace(/\s+/g, " ").trim() : null,
  };
}

function parseWiki(inner) {
  const baseData = Array.isArray(inner?.baseData) ? inner.baseData : [];
  const styleData = Array.isArray(inner?.styleData) ? inner.styleData : [];
  const meta = parseBaseMeta(baseData);
  const costumes = [];
  const skills = [];
  const seen = new Set();

  for (const skin of styleData) {
    const parsed = parseCostume(skin);
    if (!parsed) continue;
    costumes.push({
      name: parsed.costume,
      type: parsed.costume_type,
      skill: parsed.skill_name,
    });
    const key = `${parsed.costume || ""}::${parsed.skill_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const skill = {
      name: parsed.skill_name,
      type: "active",
    };
    if (parsed.costume) skill.costume = parsed.costume;
    if (parsed.summary) skill.summary = parsed.summary;
    skills.push(skill);
  }

  return { meta, skills, costumes };
}

function fetchDetail(contentId) {
  const url = `${GK}/v1/content/detail/${contentId}`;
  const detail = curlJson(url, [`game-alias: ${GAME_ALIAS}`]);
  if (detail.code !== 0 || !detail.data) {
    throw new Error(detail.msg || "detail_fail");
  }
  return detail.data;
}

function fetchWiki(contentId) {
  const d = fetchDetail(contentId);
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
  const parsed = parseWiki(inner);
  return {
    title: d.title || null,
    desc: d.desc || d.summary || null,
    content_id: contentId,
    entry_id: d.entry_id ?? null,
    ...parsed,
  };
}

function enrichCard(card, wiki) {
  if (!wiki.skills.length) return { ok: false, reason: "no_skills", card };

  const next = { ...card };
  next.skills = wiki.skills;
  next.costumes = wiki.costumes;
  next.skill_prio = [];

  const m = wiki.meta || {};
  if (m.name_zh) {
    next.name_zh = m.name_zh;
    next.name = m.name_zh;
  }
  if (m.name_en && m.name_en !== "-" && m.name_en !== "英文名") {
    next.name_en = m.name_en;
  }
  if (m.role) next.role = m.role;
  if (m.rarity) next.rarity = m.rarity;
  if (m.element) next.element = m.element;
  if (m.attack_type) next.attack_type = m.attack_type;
  if (m.weapon) next.weapon = m.weapon;
  if (m.talent) next.talent = m.talent;

  // Optional: include talent as a passive-like skill if named
  if (m.talent?.name && !SKIP_SKILL_NAMES.has(m.talent.name)) {
    const already = next.skills.some((s) => s.name === m.talent.name);
    if (!already) {
      const t = { name: m.talent.name, type: "talent" };
      if (m.talent.summary) t.summary = m.talent.summary;
      next.skills.push(t);
    }
  }

  const src = `${GK}/${GAME_ALIAS}/${wiki.content_id}.html`;
  const sources = Array.isArray(next.sources) ? [...next.sources] : [];
  if (!sources.includes(src)) sources.unshift(src);
  next.sources = sources;

  next.gamekee_content_id = wiki.content_id;
  if (wiki.entry_id != null) next.gamekee_entry_id = wiki.entry_id;

  next.stub = false;
  delete next.note;
  delete next.enrich_attempted;
  next.as_of = AS_OF;
  next.verified = `GameKee ${GAME_ALIAS}/${wiki.content_id} 图鉴`;

  return { ok: true, card: next, skill_count: next.skills.length };
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

function resolveContentId(card) {
  if (card.gamekee_content_id) return Number(card.gamekee_content_id);
  if (Array.isArray(card.sources)) {
    for (const u of card.sources) {
      const m = String(u).match(/gamekee\.com\/zsca2\/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
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
  const entry = (index.games || []).find((g) => g.id === "bd2");
  if (entry) {
    entry.character_count = files.length;
    entry.rich_count = rich;
    entry.stub_count = stub;
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
    skipped_no_id: 0,
    errors: [],
    enriched_ids: [],
    failed_ids: [],
  };

  for (const { file, card } of queue) {
    const contentId = resolveContentId(card);
    if (!contentId) {
      summary.skipped_no_id++;
      summary.failed_ids.push({ id: card.id, reason: "no_content_id" });
      continue;
    }

    summary.attempted++;
    const sourceUrl = `${GK}/${GAME_ALIAS}/${contentId}.html`;
    try {
      const wiki = fetchWiki(contentId);
      const result = enrichCard(card, wiki);
      if (!result.ok) {
        summary.still_stub++;
        summary.failed_ids.push({
          id: card.id,
          reason: result.reason,
          source: sourceUrl,
        });
        if (!dry) {
          fs.writeFileSync(
            path.join(CHAR_DIR, file),
            JSON.stringify(
              {
                ...card,
                gamekee_content_id: contentId,
                sources: card.sources?.length ? card.sources : [sourceUrl],
                enrich_attempted: {
                  at: AS_OF,
                  source: sourceUrl,
                  reason: result.reason,
                },
              },
              null,
              2
            ) + "\n"
          );
        }
      } else {
        summary.enriched++;
        summary.enriched_ids.push({
          id: card.id,
          skills: result.skill_count,
          costumes: result.card.costumes?.length || 0,
        });
        if (!dry) {
          fs.writeFileSync(
            path.join(CHAR_DIR, file),
            JSON.stringify(result.card, null, 2) + "\n"
          );
        }
      }
    } catch (e) {
      summary.still_stub++;
      summary.errors.push({ id: card.id, error: e.message, source: sourceUrl });
      summary.failed_ids.push({
        id: card.id,
        reason: e.message,
        source: sourceUrl,
      });
      if (!dry) {
        fs.writeFileSync(
          path.join(CHAR_DIR, file),
          JSON.stringify(
            {
              ...card,
              gamekee_content_id: contentId,
              sources: card.sources?.length ? card.sources : [sourceUrl],
              enrich_attempted: {
                at: AS_OF,
                source: sourceUrl,
                reason: e.message,
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
