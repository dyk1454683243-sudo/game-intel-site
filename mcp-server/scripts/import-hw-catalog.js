#!/usr/bin/env node
/**
 * Import Horizon Walker character stubs from GameKee entry list (pid=163022).
 * Never overwrites rich (non-stub) cards. Offline fallback: hw-catalog-seed.json
 *
 * Usage: node mcp-server/scripts/import-hw-catalog.js [--offline]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const OUT_DIR = path.join(DATA, "guides", "hw", "characters");
const SEED_PATH = path.join(__dirname, "hw-catalog-seed.json");
const GK = "https://www.gamekee.com";
const CHAR_FOLDER_PID = 163022;
const AS_OF = "2026-09";

const NAME_TO_ID = {
  莉珊德莉娅: "lysandria",
  尤哈: "yuha",
  珠哈: "yuha",
  玛哈里: "mahari",
  奥利维亚: "olivia",
  瓦莱塔: "valet",
  帕梅恩: "palmen",
  科拉: "cola",
  阿岚: "alan",
  蕾雅: "leia",
  白石琴叶: "shiraishi_kotoha",
  吉吉: "gigi",
  普蕾缇娜: "pretina",
  普拉蒂娜: "pretina",
  迦露德: "garud",
};

const ENSURE = [
  { id: "gigi", name: "吉吉" },
  { id: "pretina", name: "普蕾缇娜" },
  { id: "leia", name: "蕾雅" },
  { id: "shiraishi_kotoha", name: "白石琴叶" },
];

function clean(n) {
  return String(n || "").replace(/\ufeff/g, "").trim();
}

function toId(name, contentId) {
  const n = clean(name);
  if (NAME_TO_ID[n]) return NAME_TO_ID[n];
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
  if (Array.isArray(card.skills) && card.skills.length > 0) return true;
  if (card.stigmata && (card.stigmata.set_id || card.stigmata.set_name))
    return true;
  return false;
}

async function fetchEntryList() {
  const url = `${GK}/v1/entry/list?page_no=1&limit=2000`;
  const res = await fetch(url, {
    headers: {
      "game-alias": "hw",
      Accept: "application/json",
      "User-Agent": "game-intel-catalog/0.3.16",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const body = await res.json();
  if (body.code !== 0 || !Array.isArray(body.data)) {
    throw new Error(body.msg || "bad_entry_list");
  }
  return body.data
    .filter((x) => x.pid === CHAR_FOLDER_PID && !x.is_del)
    .map((x) => ({
      entry_id: x.id,
      name: clean(x.name),
      content_id: x.content_id,
      name_alias: x.name_alias || "",
    }));
}

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) return [];
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")).map((x) => ({
    entry_id: x.entry_id,
    name: clean(x.name),
    content_id: x.content_id,
    name_alias: x.name_alias || "",
  }));
}

function stubCard(row, id) {
  return {
    id,
    name: row.name,
    name_zh: row.name,
    name_en: row.name_alias || null,
    aliases: row.name === "珠哈" ? ["尤哈"] : [],
    nicknames: [],
    game: "hw",
    role: null,
    skills: [],
    skill_prio: [],
    stigmata: null,
    weapon: null,
    teams: {},
    sources: row.content_id
      ? [`https://www.gamekee.com/hw/${row.content_id}.html`]
      : [],
    stub: true,
    note: "Catalog stub from GameKee 角色图鉴. Expand skills only from verified 图鉴/测评.",
    as_of: AS_OF,
    gamekee_content_id: row.content_id ?? null,
    gamekee_entry_id: row.entry_id ?? null,
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

  let written = 0;
  let skipped_rich = 0;
  const used = new Set();

  for (const row of rows) {
    if (!row.name || !row.content_id) continue;
    let id = toId(row.name, row.content_id);
    if (used.has(id)) id = `${id}_${row.content_id}`;
    used.add(id);
    const dest = path.join(OUT_DIR, `${id}.json`);
    if (fs.existsSync(dest) && isRich(JSON.parse(fs.readFileSync(dest, "utf8")))) {
      skipped_rich++;
      continue;
    }
    // Prefer display name 尤哈 for yuha
    if (id === "yuha") row.name = "尤哈";
    fs.writeFileSync(dest, JSON.stringify(stubCard(row, id), null, 2) + "\n");
    written++;
  }

  for (const e of ENSURE) {
    const dest = path.join(OUT_DIR, `${e.id}.json`);
    if (fs.existsSync(dest)) continue;
    fs.writeFileSync(
      dest,
      JSON.stringify(
        stubCard({ name: e.name, content_id: null, entry_id: null }, e.id),
        null,
        2
      ) + "\n"
    );
    written++;
  }

  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
  console.log(
    JSON.stringify(
      {
        ok: true,
        source,
        discovered: rows.length,
        written,
        skipped_rich,
        character_files: files.length,
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
