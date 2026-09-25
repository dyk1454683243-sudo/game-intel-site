#!/usr/bin/env node
/**
 * Import Brown Dust 2 character stubs from GameKee entry list.
 * Game alias: zsca2. Folders: pid 122323 (main), 122318, 122322.
 * Never overwrites rich cards. Offline: bd2-catalog-seed.json
 *
 * Usage: node mcp-server/scripts/import-bd2-catalog.js [--offline]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const OUT_DIR = path.join(DATA, "guides", "bd2", "characters");
const ALIAS_PATH = path.join(DATA, "guides", "bd2", "aliases.json");
const SEED_PATH = path.join(__dirname, "bd2-catalog-seed.json");
const GK = "https://www.gamekee.com";
const GAME_ALIAS = "zsca2";
const CHAR_FOLDER_PIDS = new Set([122323, 122318, 122322]);
const AS_OF = "2026-09";
const UA = "game-intel-catalog/0.3.22";

const NAME_TO_ID = {
  席比雅: "sylvia",
  鲁: "rou",
  哥布林杀手: "goblin_slayer",
  女神官: "priestess",
  妖精弓手: "elf_archer",
  剑之圣女: "sword_maiden",
  雪泉: "yukiizumi",
  日影: "hikage",
  夜樱: "yozakura",
  咏: "utage",
  斑鸠: "ikaros",
  出云天花: "izumo_tenka",
  羽前京香: "uzen_kyoka",
  山城恋: "yamashiro_ren",
  内肯达莉亚: "nevendaria",
  马莫尼勒: "mammonile",
  帕莱特: "palette",
  葛拉娜德: "granade",
  达丽安: "dalian",
  提尔: "tir",
  索妮亚: "sonia",
  奥利维尔: "oliver",
  格兰希特: "glansheit",
  神圣悠丝缇亚: "holy_ustia",
  米卡艾拉: "micaela",
  黛安娜: "diana",
  露比雅: "rubia",
  黎维塔: "levita",
  西利亚: "celia",
  布莱德: "blade",
  阿奇拉: "achila",
};

const NICK_TO_ID = {
  黑妹: "nevendaria",
  章鱼妹: "mammonile",
  棉被: "palette",
  葛拉: "granade",
  大公主: "dalian",
  猫娘: "tir",
  地雷妹: "sonia",
  黑妈妈: "oliver",
  哥杀: "goblin_slayer",
  光坦: "glansheit",
  神UT: "holy_ustia",
  米卡埃拉: "micaela",
  戴安娜: "diana",
};

function clean(n) {
  return String(n || "").replace(/\ufeff/g, "").trim();
}

function toId(name, contentId) {
  const n = clean(name);
  if (NAME_TO_ID[n]) return NAME_TO_ID[n];
  if (NICK_TO_ID[n]) return NICK_TO_ID[n];
  let ascii = n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (ascii && /[a-z]/.test(ascii) && ascii.length >= 2) return ascii;
  const py = pinyin(n, { toneType: "none", type: "array" })
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (py && py.length >= 2) return py;
  return `c${contentId}`;
}

function isRich(card) {
  if (!card) return false;
  if (card.stub === true) return false;
  if (card.stub === false) return true;
  return Array.isArray(card.skills) && card.skills.length > 0;
}

async function fetchEntryList() {
  const url = `${GK}/v1/entry/list?page_no=1&limit=2000`;
  const res = await fetch(url, {
    headers: {
      "game-alias": GAME_ALIAS,
      Accept: "application/json",
      "User-Agent": UA,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const body = await res.json();
  if (body.code !== 0 || !Array.isArray(body.data)) {
    throw new Error(body.msg || "bad_entry_list");
  }
  return body.data
    .filter((x) => CHAR_FOLDER_PIDS.has(x.pid) && !x.is_del)
    .map((x) => ({
      entry_id: x.id,
      name: clean(x.name),
      content_id: x.content_id,
      name_alias: clean(x.name_alias || ""),
      pid: x.pid,
    }))
    .filter((x) => x.name && x.content_id);
}

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) return [];
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")).map((x) => ({
    entry_id: x.entry_id,
    name: clean(x.name),
    content_id: x.content_id,
    name_alias: clean(x.name_alias || ""),
    pid: x.pid ?? null,
  }));
}

function stubCard(row, id) {
  const nick =
    row.name_alias && row.name_alias !== row.name ? row.name_alias : null;
  return {
    id,
    name: row.name,
    name_zh: row.name,
    name_en: null,
    aliases: [],
    nicknames: nick ? [nick] : [],
    game: "bd2",
    role: null,
    rarity: null,
    element: null,
    attack_type: null,
    skills: [],
    skill_prio: [],
    weapon: null,
    talent: null,
    costumes: [],
    teams: {},
    sources: row.content_id
      ? [`${GK}/${GAME_ALIAS}/${row.content_id}.html`]
      : [],
    stub: true,
    note: "Catalog stub from GameKee 角色图鉴 (zsca2). Enrich skills from styleData 服装/技能 only.",
    as_of: AS_OF,
    gamekee_content_id: row.content_id ?? null,
    gamekee_entry_id: row.entry_id ?? null,
  };
}

function buildAliases(cardsById) {
  const aliases = {};
  const put = (key, id, name) => {
    const k = String(key || "").trim();
    if (!k || !id || !cardsById.has(id)) return;
    if (aliases[k]) return;
    aliases[k] = {
      id,
      name: name || cardsById.get(id).name,
      kind: "character",
    };
  };

  for (const [id, card] of cardsById) {
    put(id, id, card.name_zh || card.name);
    if (card.name_zh) put(card.name_zh, id, card.name_zh);
    if (card.name_en) put(card.name_en, id, card.name_zh || card.name);
    if (card.name) put(card.name, id, card.name_zh || card.name);
    for (const a of card.aliases || []) put(a, id, card.name_zh || card.name);
    for (const n of card.nicknames || []) put(n, id, card.name_zh || card.name);
  }

  for (const [nick, id] of Object.entries(NICK_TO_ID)) {
    if (!cardsById.has(id)) continue;
    const card = cardsById.get(id);
    put(nick, id, card.name_zh || card.name);
    card.nicknames = [...new Set([...(card.nicknames || []), nick])];
  }

  return aliases;
}

function updateGuidesIndex(cardsById) {
  const indexPath = path.join(DATA, "guides", "index.json");
  if (!fs.existsSync(indexPath)) return null;
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  let rich = 0;
  let stub = 0;
  for (const c of cardsById.values()) {
    if (isRich(c)) rich++;
    else stub++;
  }
  const entry = (index.games || []).find((g) => g.id === "bd2");
  if (entry) {
    entry.character_count = cardsById.size;
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
  return {
    character_count: cardsById.size,
    rich_count: rich,
    stub_count: stub,
  };
}

async function main() {
  const offline = process.argv.includes("--offline");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let rows = [];
  let source = "seed";
  if (!offline) {
    try {
      rows = await fetchEntryList();
      source = "gamekee_entry_list";
      fs.writeFileSync(SEED_PATH, JSON.stringify(rows, null, 2) + "\n");
    } catch (e) {
      console.error("fetch failed:", e.message, "→ seed");
      rows = loadSeed();
      source = "seed_fallback";
    }
  } else {
    rows = loadSeed();
    source = "offline_seed";
  }

  const cardsById = new Map();
  if (fs.existsSync(OUT_DIR)) {
    for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.endsWith(".json"))) {
      const card = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
      if (card.id) cardsById.set(card.id, card);
    }
  }

  let written = 0;
  let skipped_rich = 0;
  const used = new Set([...cardsById.keys()]);

  for (const row of rows) {
    if (!row.name || !row.content_id) continue;
    let id = toId(row.name, row.content_id);
    if (used.has(id)) {
      const existing = cardsById.get(id);
      if (
        existing &&
        existing.gamekee_content_id &&
        existing.gamekee_content_id !== row.content_id
      ) {
        id = `${id}_${row.content_id}`;
      } else if (existing && isRich(existing)) {
        skipped_rich++;
        continue;
      } else if (!existing) {
        id = `${id}_${row.content_id}`;
      }
    }
    used.add(id);

    if (cardsById.has(id) && isRich(cardsById.get(id))) {
      skipped_rich++;
      continue;
    }

    const stub = stubCard(row, id);
    const prev = cardsById.get(id);
    if (prev && prev.stub) {
      stub.nicknames = [
        ...new Set([...(prev.nicknames || []), ...(stub.nicknames || [])]),
      ];
      if (prev.enrich_attempted) stub.enrich_attempted = prev.enrich_attempted;
    }
    cardsById.set(id, stub);
    fs.writeFileSync(
      path.join(OUT_DIR, `${id}.json`),
      JSON.stringify(stub, null, 2) + "\n"
    );
    written++;
  }

  const fresh = new Map();
  for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.endsWith(".json"))) {
    const card = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    if (card.id) fresh.set(card.id, card);
  }
  for (const [nick, id] of Object.entries(NICK_TO_ID)) {
    const card = fresh.get(id);
    if (!card) continue;
    card.nicknames = [...new Set([...(card.nicknames || []), nick])];
  }

  const aliases = buildAliases(fresh);
  fs.writeFileSync(
    ALIAS_PATH,
    JSON.stringify(
      {
        _meta: {
          game: "bd2",
          note: "GameKee name_alias + sure community nicknames only; never invent skill names/numbers.",
          as_of: AS_OF,
        },
        aliases,
      },
      null,
      2
    ) + "\n"
  );

  for (const [id, card] of fresh) {
    if (isRich(card)) continue;
    fs.writeFileSync(
      path.join(OUT_DIR, `${id}.json`),
      JSON.stringify(card, null, 2) + "\n"
    );
  }

  const counts = updateGuidesIndex(fresh);
  console.log(
    JSON.stringify(
      {
        ok: true,
        source,
        discovered: rows.length,
        written,
        skipped_rich,
        character_files: fresh.size,
        aliases: Object.keys(aliases).length,
        index: counts,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
