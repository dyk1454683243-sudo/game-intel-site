#!/usr/bin/env node
/**
 * Fill empty teams from published rosters. Does not clear or edit cards that
 * already have teams. A roster is written only when every member maps to one
 * character id.
 *
 *   node mcp-server/scripts/fill-cited-teams.mjs [--write]
 *   node mcp-server/scripts/fill-cited-teams.mjs --write --prydwen-text /path
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { cardsMentioned, nodeText, parseContentNodes } from "./team-build-parse.mjs";
import { acceptRoster, applyCitedTeams, indexBySlug, teamsEmpty } from "./cited-teams.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PRYDWEN_TEAMS = "https://www.prydwen.gg/nikke/teams-database";
const META_PAGE = "https://nikke.gg/meta/";
const PRYDWEN_AS_OF = "2026-10-15";

function curl(url, headers = []) {
  const result = spawnSync(
    "curl",
    ["-sS", "-L", "--max-time", "40", "-A", UA, "-H", "Accept: application/json,text/plain,*/*", ...headers.flatMap((header) => ["-H", header]), url],
    { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }
  );
  if (result.status !== 0) throw new Error(`curl_${result.status}:${url}`);
  return result.stdout || "";
}

function curlJson(url, headers = []) {
  const body = curl(url, headers);
  if (body.startsWith("<!") || body.startsWith("Hacker")) throw new Error(`blocked:${url}`);
  return JSON.parse(body);
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

function shanghaiDate(unixSeconds) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(unixSeconds) * 1000));
}

function positions(row) {
  return [1, 2, 3, 4, 5].map((index) => String(row[`Pos_${index}`] || "").trim());
}

function prydwenRoster(row, index, { scoreBase, sourceFor }) {
  const members = acceptRoster(positions(row), index);
  if (!members) return null;
  const title = String(row.Name || "").trim();
  const mode = String(row.Mode || "").trim();
  const element = String(row.Element || "").trim();
  if (!title || !mode) return null;
  const source = sourceFor(row);
  if (!source) return null;
  const label = ["Prydwen", mode, element, title].filter(Boolean).join(" · ");
  return {
    members,
    label,
    source,
    asOf: PRYDWEN_AS_OF,
    score: scoreBase + Number(row.Id || 0),
  };
}

function metaRosters(snapshot, index) {
  const top = snapshot?.squads?.top;
  if (!Array.isArray(top)) return [];
  const asOf = shanghaiDate(snapshot.generated_at);
  const window = String(snapshot.window || "").trim();
  const mode = String(snapshot.mode || snapshot.format || "raid").trim();
  const out = [];
  for (const squad of top) {
    const units = Array.isArray(squad.units) ? squad.units : [];
    if (units.length !== 5) continue;
    const members = acceptRoster(
      units.map((unit) => unit.slug),
      index
    );
    if (!members) continue;
    const n = Number(squad.n || 0);
    const share = squad.share;
    const label = `Nikke.gg Meta · ${mode} · ${window} · ${n}名指挥官 · 占比${share}%`;
    out.push({
      members,
      label,
      source: META_PAGE,
      asOf,
      score: 2_000_000 + n,
    });
  }
  return out;
}

function nikkeRosters(cards, pageText) {
  const index = indexBySlug(cards);
  const version = curl("https://butterfly.dotgg.gg/?game=nikke").trim();
  const snapshot = curlJson(
    `https://api.dotgg.gg/cgfw/getmetasnapshot?game=nikke&format=raid&cache=${encodeURIComponent(version)}`,
    ["Referer: https://nikke.gg/meta/", "Origin: https://nikke.gg"]
  );
  const publicRows = curlJson("https://nkas.pages.dev/nk_data/prydwen/teams-public-data.json").NIKKETeamsPublic || [];
  const profileRows = curlJson("https://nkas.pages.dev/nk_data/prydwen/teams-profile-data.json").NIKKETeamsProfile || [];
  const publicIds = new Set(publicRows.map((row) => Number(row.Id)));
  const seenNames = pageText ? String(pageText) : "";
  const rosters = [...metaRosters(snapshot, index)];
  let publicKept = 0;
  let publicSkipped = 0;
  for (const row of publicRows) {
    const title = String(row.Name || "").trim();
    if (seenNames && title && !seenNames.includes(title)) {
      publicSkipped++;
      continue;
    }
    const roster = prydwenRoster(row, index, {
      scoreBase: 1_000_000,
      sourceFor: () => PRYDWEN_TEAMS,
    });
    if (!roster) continue;
    publicKept++;
    rosters.push(roster);
  }
  let profileKept = 0;
  for (const row of profileRows) {
    if (publicIds.has(Number(row.Id))) continue;
    const slug = String(row.Profile_display || "").trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    const roster = prydwenRoster(row, index, {
      scoreBase: 0,
      sourceFor: () => `https://www.prydwen.gg/nikke/characters/${slug}`,
    });
    if (!roster) continue;
    profileKept++;
    rosters.push(roster);
  }
  return {
    rosters,
    meta_as_of: shanghaiDate(snapshot.generated_at),
    meta_squads: (snapshot.squads?.top || []).length,
    public_kept: publicKept,
    public_name_miss: publicSkipped,
    profile_kept: profileKept,
  };
}

const BD2_PAGE = "http://cymmina.gamependium.com/browndust2/teams.html";
const BD2_AS_OF = "2026-08-21";
const BD2_PARTIES = [
  ["Just 3 Stars (Physical)", ["Arines", "Wiggle", "Ingrid", "Gynt"], 100],
  ["Just 3 and 4 Stars (Physical)", ["Arines", "Samay", "Wiggle", "Kry"], 100],
  ["Chapter 2 Magic", ["Elpis", "Samay", "Dalvi", "Maria", "Scheherazade"], 120],
  ["Early Liatris Carry (Physical)", ["Arines", "Samay", "Rafina", "Liatris"], 150],
  ["No Advantage Physical", ["Liberta", "Lathel", "Rafina", "Sacred Justia", "Yuri"], 200],
  ["General Purpose (High Crit Rate)", ["Liberta", "Arines", "Rafina", "Sacred Justia", "Yuri"], 200],
  ["General Purpose (High Crit Rate)", ["Liberta", "Arines", "Teresse", "Rafina", "Sacred Justia"], 200],
  ["General Purpose (with SP Recovery)", ["Elpis", "Helena", "Levia", "Loen", "Lucrezia"], 200],
  ["Strong Elemental Advantage for Fire", ["Diana", "Refithea", "Helena", "Levia", "Loen"], 200],
  ["General Purpose Magic (High Chains)", ["Refithea", "Helena", "Olstein", "Levia", "Loen"], 200],
  ["General Purpose (High Crit Rate)", ["Elpis", "Helena", "Teresse", "Levia", "Loen"], 190],
  ["General Purpose (with Clean-Up)", ["Helena", "Teresse", "Levia", "Loen", "Venaka"], 200],
  ["Elemental Advantage for Fire", ["Diana", "Helena", "Teresse", "Levia", "Loen"], 200],
  ["SP Hungry Magic", ["Helena", "Teresse", "Lucrezia", "Levia", "Morpeah"], 200],
  ["Elemental Advantage for Wind", ["Diana", "Helena", "Olstein", "Dalvi", "Venaka"], 200],
  ["Elemental Advantage for Wind (Alternate)", ["Diana", "Helena", "Olstein", "Venaka", "Dalvi"], 190],
  ["Elemental Advantage for Wind (Low Chain)", ["Diana", "Helena", "Teresse", "Dalvi", "Venaka"], 190],
  ["Very First Solo Boss Kill (Partan, ch11 Fake Game)", ["Diana", "Arines", "Liatris", "Wiggle", "Lathel"], 180],
  ["Advanced Solo Boss Kill (Nox, ch12 or ch14)", ["Diana", "Refithea", "Arines", "Zenith", "Ventana"], 180],
  ["Advanced Solo Boss Kill (Nox, ch12 or ch14), crit fishing edition", ["Diana", "Refithea", "Zenith", "Levia", "Angelica"], 180],
  ["Single Target Physical", ["Liberta", "Refithea", "Zenith", "Wilhelmina", "Ventana"], 180],
];

function normEn(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function englishFromAtlas(contentId) {
  const detail = curlJson(`https://www.gamekee.com/v1/content/detail/${contentId}`, [
    "game-alias: zsca2",
    "Referer: https://www.gamekee.com/",
  ]);
  let cdn = detail?.data?.content_cdn || "";
  if (cdn.startsWith("//")) cdn = `https:${cdn}`;
  if (!cdn) return "";
  const body = curl(cdn, ["Referer: https://www.gamekee.com/"]);
  const match = body.match(/角色名称[\s\S]{0,400}?"value":"([^"]*)"[\s\S]{0,200}?"value":"([^"]*)"/);
  const en = match ? match[2] : "";
  if (!en || en === "英文名") return "";
  return en;
}

function bd2EnglishIndex(cards) {
  const cachePath = "/tmp/cited-teams/bd2-en.json";
  let cache = {};
  if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const index = new Map();
  let fetched = 0;
  for (const card of cards) {
    let en = String(card.name_en || cache[card.id] || "").trim();
    if (!en && card.gamekee_content_id) {
      en = englishFromAtlas(card.gamekee_content_id);
      fetched++;
      if (en) cache[card.id] = en;
    }
    const key = normEn(en);
    if (!key) continue;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(card.id);
  }
  fs.mkdirSync("/tmp/cited-teams", { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  return { index, fetched };
}

function bd2Rosters(cards) {
  const html = curl(BD2_PAGE, ["Accept: text/html"]);
  const { index } = bd2EnglishIndex(cards);
  const rosters = [];
  let skipped = 0;
  for (const [title, names, score] of BD2_PARTIES) {
    if (!html.includes(title) || names.some((name) => !html.includes(name))) {
      skipped++;
      continue;
    }
    const ids = [];
    let ok = true;
    for (const name of names) {
      const hits = index.get(normEn(name));
      if (!hits || hits.size !== 1) {
        ok = false;
        break;
      }
      ids.push([...hits][0]);
    }
    if (!ok || new Set(ids).size !== ids.length) {
      skipped++;
      continue;
    }
    rosters.push({
      members: ids,
      label: `Gamependium · ${title}`,
      source: BD2_PAGE,
      asOf: BD2_AS_OF,
      score,
    });
  }
  return { rosters, skipped, page_bytes: html.length };
}

function hwRoster(cards) {
  const detail = curlJson("https://www.gamekee.com/v1/content/detail/686447", [
    "game-alias: hw",
    "Referer: https://www.gamekee.com/",
  ]);
  let cdn = detail?.data?.content_cdn || "";
  if (cdn.startsWith("//")) cdn = `https:${cdn}`;
  const packed = JSON.parse(curl(cdn, ["Referer: https://www.gamekee.com/"]));
  const texts = parseContentNodes(packed.content).map(nodeText).filter(Boolean);
  const line = texts
    .find((text) => text.includes("金佳映") && text.includes("配合人权辅助阿岚"))
    ?.replace(/\s+/g, " ")
    .trim()
    .replace(/[：:]+$/, "");
  if (!line) return { rosters: [] };
  const ids = [...new Set(cardsMentioned(line, cards).map((hit) => hit.id))];
  if (!ids.includes("jin_jia_ying") || !ids.includes("alan")) return { rosters: [], reason: "names" };
  return {
    rosters: [
      {
        members: ["jin_jia_ying", "alan"],
        label: line,
        source: "https://www.gamekee.com/hw/686447.html",
        asOf: shanghaiDate(detail.data.updated_at),
        score: 1,
      },
    ],
  };
}

function coverage(rows) {
  let filled = 0;
  for (const { card } of rows) if (!teamsEmpty(card)) filled++;
  return { total: rows.length, filled, empty: rows.length - filled };
}

function writeChanged(rows, before, write) {
  let written = 0;
  for (const row of rows) {
    if (JSON.stringify(row.card) === before.get(row.path)) continue;
    written++;
    if (write) fs.writeFileSync(row.path, JSON.stringify(row.card, null, 2) + "\n");
  }
  return written;
}

function runGame(game, rosters, write) {
  const rows = loadCards(game);
  const before = new Map(rows.map((row) => [row.path, JSON.stringify(row.card)]));
  const beforeCoverage = coverage(rows);
  const touched = applyCitedTeams(
    rows.map((row) => row.card),
    rosters
  );
  const written = writeChanged(rows, before, write);
  return {
    before: beforeCoverage,
    after: coverage(rows),
    filled_now: touched.length,
    written,
    sample: Object.fromEntries(
      touched.slice(0, 6).map((id) => {
        const card = rows.find((row) => row.card.id === id).card;
        return [id, card.teams.comp];
      })
    ),
  };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const textIdx = args.indexOf("--prydwen-text");
  const pageText = textIdx >= 0 ? fs.readFileSync(args[textIdx + 1], "utf8") : "";
  const nikkeCards = loadCards("nikke").map((row) => row.card);
  const nikke = nikkeRosters(nikkeCards, pageText);
  const bd2Cards = loadCards("bd2").map((row) => row.card);
  const bd2 = bd2Rosters(bd2Cards);
  const hwCards = loadCards("hw").map((row) => row.card);
  const hw = hwRoster(hwCards);
  const report = {
    write,
    nikke: { ...runGame("nikke", nikke.rosters, write), ...nikke, rosters: nikke.rosters.length },
    bd2: { ...runGame("bd2", bd2.rosters, write), ...bd2, rosters: bd2.rosters.length },
    hw: { ...runGame("hw", hw.rosters, write), ...hw, rosters: hw.rosters.length },
  };
  console.log(JSON.stringify(report, null, 2));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
