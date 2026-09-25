#!/usr/bin/env node
/**
 * Enrich HW stub character cards from GameKee 图鉴 CDN JSON.
 * Never invent skill/stigmata names — upgrade stub→rich only when real skill names found.
 *
 * Usage:
 *   node mcp-server/scripts/enrich-hw-cards.js [--limit N] [--only id,id] [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const CHAR_DIR = path.join(DATA, "guides", "hw", "characters");
const GK = "https://www.gamekee.com";
const AS_OF = "2026-09";
const DELAY_MS = 450;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PRIORITY = [
  "olivia",
  "valet",
  "mahari",
  "yuha",
  "palmen",
  "cola",
  "alan",
  "gigi",
  "pretina",
  "leia",
  "shiraishi_kotoha",
];

const MANUAL_CONTENT_ID = {
  gigi: 635915, // 妮姆赛 — community nickname 吉吉
};

const MANUAL_ALIASES = {
  gigi: { name_zh: "妮姆赛", aliases: ["妮姆赛"], nicknames: ["吉吉"] },
  garud: {
    name_zh: "迦露德",
    aliases: ["加鲁德", "加魯德", "Garud", "Garuda", "가루드"],
    nicknames: ["大佬迦", "不死鸟"],
  },
};

const STIG_SET_MAP = {
  优菲特尔: { set_id: "set_iuppiter", nickname: "木星" },
  灼热太阳: { set_id: "set_blazing_sun", nickname: "火太阳" },
};

const DOPAMINE_TEAM = {
  lysandria: "A",
  palmen: "A",
  mahari: "A",
  yuha: "A",
  olivia: "B",
  valet: "B",
  gigi: "B",
  pretina: "B",
  cola: "C",
  alan: "C",
  leia: "C",
  shiraishi_kotoha: "C",
};

const SKIP_SKILL_NAMES = new Set([
  "",
  "待机",
  "技能图标",
  "技能名称",
  "—",
  "-",
  "无",
  "/",
  "／",
]);

const LABELS = new Set([
  "技能名称",
  "技能类型",
  "精简描述",
  "加点推荐",
  "冷却时间",
  "行动力消耗",
  "技能信息",
  "技能图标",
  "2件套效果",
  "4件套效果",
  "圣痕来源",
  "专武名称",
  "推荐套装",
  "综合加点分析",
  "综合分析",
  "T度",
  "角色标签1",
  "角色标签2",
  "使用武器类型",
  "抽取建议",
  "强度评测",
  "1阶职业名",
  "2阶职业名",
  "3阶职业名",
  "称号",
  "品质",
  "主属性",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRich(card) {
  if (!card) return false;
  if (card.stub === true) return false;
  if (card.stub === false) return true;
  if (Array.isArray(card.skills) && card.skills.length > 0) return true;
  if (card.stigmata && (card.stigmata.set_id || card.stigmata.set_name))
    return true;
  return false;
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
  if (/被动/.test(zh)) return "passive";
  if (/终极|大招|奥义|必杀/.test(zh)) return "ult";
  if (/主动/.test(zh)) return "active";
  return null;
}

function labelValue(texts, label) {
  const i = texts.indexOf(label);
  if (i < 0) return null;
  const v = texts[i + 1];
  if (!v || v === label || LABELS.has(v)) return null;
  return v;
}

function parseWikiContent(inner) {
  const rows = Array.isArray(inner?.baseData) ? inner.baseData : [];
  const skills = [];
  let cur = null;
  const meta = {};

  const flush = () => {
    if (cur?.name && !SKIP_SKILL_NAMES.has(cur.name)) skills.push(cur);
    cur = null;
  };

  for (const row of rows) {
    const texts = rowTexts(row);
    if (!texts.length) continue;

    if (texts[0] === "技能名称" || texts.includes("技能名称")) {
      const name = labelValue(texts, "技能名称");
      flush();
      if (name && !SKIP_SKILL_NAMES.has(name) && !/^技能\d/.test(name)) {
        cur = { name: name.replace(/\s+/g, " ").trim() };
      } else {
        cur = null;
      }
      continue;
    }

    if (cur) {
      if (texts.includes("技能类型")) {
        const mapped = mapSkillType(labelValue(texts, "技能类型"));
        if (mapped) cur.type = mapped;
      }
      if (texts.includes("精简描述")) {
        const s = labelValue(texts, "精简描述");
        if (s) cur.summary = s.replace(/\s+/g, " ").trim();
      }
      if (texts.includes("加点推荐")) {
        const p = labelValue(texts, "加点推荐");
        if (p) cur.prio_note = p;
      }
    }

    const take = (label, key) => {
      const v = labelValue(texts, label);
      if (v && meta[key] == null) meta[key] = v;
    };
    take("推荐套装", "stig_set");
    take("专武名称", "weapon");
    take("综合加点分析", "prio_all");
    take("T度", "t_rank");
    take("角色标签1", "tag1");
    take("角色标签2", "tag2");
    take("使用武器类型", "weapon_type");
    take("2件套效果", "set2");
    take("4件套效果", "set4");
    take("1阶职业名", "job1");
    take("2阶职业名", "job2");
    take("3阶职业名", "job3");
    take("抽取建议", "pull");
    take("强度评测", "review");
    take("综合分析", "stig_analysis");
  }
  flush();

  const seen = new Set();
  const uniq = [];
  for (const s of skills) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    uniq.push(s);
  }
  return { skills: uniq, meta };
}

/** Node fetch often gets CF 567 on api-cdn; curl from same box works. */
function curlJson(url, extraHeaders = []) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    "30",
    "-A",
    UA,
    "-H",
    "Accept: application/json, text/plain, */*",
    "-H",
    `Referer: ${GK}/`,
    "-H",
    `Origin: ${GK}`,
    ...extraHeaders.flatMap((h) => ["-H", h]),
    url,
  ];
  const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`curl_fail_${r.status}: ${(r.stderr || "").slice(0, 120)}`);
  }
  const body = r.stdout || "";
  if (body.startsWith("<!DOCTYPE") || body.startsWith("<html")) {
    throw new Error("http_html_blocked");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`bad_json_${body.slice(0, 40)}`);
  }
}

async function fetchDetail(contentId) {
  // Detail API works with node fetch
  const res = await fetch(`${GK}/v1/content/detail/${contentId}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      "game-alias": "hw",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const detail = await res.json();
  if (detail.code !== 0 || !detail.data) {
    throw new Error(detail.msg || "detail_fail");
  }
  return detail.data;
}

async function fetchCharacterWiki(contentId) {
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
  const parsed = parseWikiContent(inner);

  return {
    title: d.title || null,
    desc: d.desc || d.summary || null,
    content_id: contentId,
    entry_id: d.entry_id ?? null,
    ...parsed,
  };
}

function buildStigmata(meta) {
  const setName = meta.stig_set;
  if (!setName || setName === "封面图片" || setName === "圣痕套装名") return null;
  const known = STIG_SET_MAP[setName] || {};
  const stig = {
    set_id: known.set_id || null,
    set_name: setName,
    pieces: 4,
  };
  if (known.nickname) stig.nickname = known.nickname;
  const notes = [];
  if (meta.set2) notes.push(`2件: ${meta.set2}`);
  if (meta.set4) notes.push(`4件: ${meta.set4}`);
  if (meta.stig_analysis) notes.push(meta.stig_analysis);
  if (notes.length) stig.notes = notes;
  if (meta.stig_analysis && /近战攻击力/.test(meta.stig_analysis)) {
    stig.substats_priority = ["近战攻击力"];
  }
  return stig;
}

function buildSkillPrio(skills, meta) {
  const out = [];
  if (meta.prio_all) out.push(meta.prio_all);
  for (const s of skills) {
    if (s.prio_note) out.push(`${s.name}: ${s.prio_note}`);
  }
  return out;
}

function buildRole(meta, desc) {
  const parts = [];
  if (meta.t_rank) parts.push(meta.t_rank);
  if (meta.tag1) parts.push(meta.tag1);
  if (meta.tag2) parts.push(meta.tag2);
  if (meta.job3) parts.push(meta.job3);
  else if (meta.job2) parts.push(meta.job2);
  if (parts.length) return parts.join(" / ");
  if (desc && desc.length < 80) return desc;
  return null;
}

function enrichCard(card, wiki) {
  const skills = wiki.skills.map((s) => {
    const o = { name: s.name };
    if (s.type) o.type = s.type;
    if (s.summary) o.summary = s.summary;
    return o;
  });
  if (skills.length < 1) return { ok: false, reason: "no_skills", card };

  const next = { ...card };
  next.skills = skills;
  // Match existing lysandria / guide_hw field names
  next.skill_prio = buildSkillPrio(wiki.skills, wiki.meta);
  next.stigmata = buildStigmata(wiki.meta);
  if (wiki.meta.weapon) next.weapon = wiki.meta.weapon;
  const role = buildRole(wiki.meta, wiki.desc);
  if (role) next.role = role;

  const src = `${GK}/hw/${wiki.content_id}.html`;
  const sources = Array.isArray(next.sources) ? [...next.sources] : [];
  if (!sources.includes(src)) sources.unshift(src);
  next.sources = sources;

  next.gamekee_content_id = wiki.content_id;
  if (wiki.entry_id != null) next.gamekee_entry_id = wiki.entry_id;

  if (DOPAMINE_TEAM[next.id]) {
    next.teams = {
      ...(next.teams || {}),
      dopamine_auto: DOPAMINE_TEAM[next.id],
    };
  }

  const manual = MANUAL_ALIASES[next.id];
  if (manual) {
    if (manual.name_zh) {
      next.name_zh = manual.name_zh;
      next.name = manual.name_zh; // GameKee canonical display name
    }
    next.aliases = [
      ...new Set([...(next.aliases || []), ...(manual.aliases || [])]),
    ];
    next.nicknames = [
      ...new Set([...(next.nicknames || []), ...(manual.nicknames || [])]),
    ];
  }

  next.stub = false;
  delete next.enrich_attempted;
  if (wiki.meta?.pull) {
    const pull = String(wiki.meta.pull)
      .replace(/\*[a-z]+:([^*]*)\*/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (pull) next.note = `抽取建议: ${pull}`;
  } else {
    delete next.note;
  }
  next.as_of = AS_OF;
  next.verified = `GameKee hw/${wiki.content_id} 图鉴`;

  return { ok: true, card: next, skill_count: skills.length };
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
  const hw = (index.games || []).find((g) => g.id === "hw");
  if (hw) {
    hw.character_count = files.length;
    hw.rich_count = rich;
    hw.stub_count = stub;
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

function resolveContentId(card) {
  if (card.gamekee_content_id) return Number(card.gamekee_content_id);
  if (MANUAL_CONTENT_ID[card.id]) return MANUAL_CONTENT_ID[card.id];
  if (Array.isArray(card.sources)) {
    for (const u of card.sources) {
      const m = String(u).match(/gamekee\.com\/hw\/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
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
      if (!dry) {
        fs.writeFileSync(
          path.join(CHAR_DIR, file),
          JSON.stringify(
            {
              ...card,
              enrich_attempted: {
                at: AS_OF,
                source: null,
                reason: "no_content_id",
              },
            },
            null,
            2
          ) + "\n"
        );
      }
      continue;
    }

    summary.attempted++;
    const sourceUrl = `${GK}/hw/${contentId}.html`;
    try {
      const wiki = await fetchCharacterWiki(contentId);
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
          stigmata: result.card.stigmata?.set_name || null,
          weapon: result.card.weapon || null,
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

  const all = fs.readdirSync(CHAR_DIR).filter((f) => f.endsWith(".json"));
  let rich = 0;
  let stub = 0;
  for (const f of all) {
    const c = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, f), "utf8"));
    if (isRich(c)) rich++;
    else stub++;
  }
  summary.disk = { total: all.length, rich, stub };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
