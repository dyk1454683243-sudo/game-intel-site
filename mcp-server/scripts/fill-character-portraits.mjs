#!/usr/bin/env node
/**
 * Fill portrait / portrait_source / portrait_via on hw, nikke, and bd2 cards.
 *
 * GameKee: icon field on the entry whose id and content_id already match the card,
 * from GET /v1/entry/list (game-alias header). The icon URL is kept only after the
 * CDN returns a real image with a GameKee Referer.
 * Nikke cards with no GameKee icon: a cdn.prydwen.gg character image that appears
 * on a Prydwen page already listed in sources.
 * Anything else stays null. Does not touch other games.
 *
 * Usage: node mcp-server/scripts/fill-character-portraits.mjs [--dry-run]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAMEKEE_IMAGE_HEADERS, looksLikeImage, portraitTarget } from "../../ai-site/public/ui/portrait.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const DRY = process.argv.includes("--dry-run");
const ENTRY_LIST = "https://www.gamekee.com/v1/entry/list?page_no=1&limit=2000";

const GAMES = [
  { id: "hw", alias: "hw" },
  { id: "nikke", alias: "nikke" },
  { id: "bd2", alias: "zsca2" },
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function listCards(game) {
  const dir = path.join(DATA, "guides", game, "characters");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ file: path.join(dir, name), card: readJson(path.join(dir, name)) }));
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function entryList(alias) {
  const res = await fetch(ENTRY_LIST, {
    headers: {
      "game-alias": alias,
      Accept: "application/json",
      "User-Agent": "game-intel-catalog/0.3.22",
    },
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`${alias} entry list http ${res.status}`);
  const body = await res.json();
  if (body.code !== 0 || !Array.isArray(body.data)) throw new Error(`${alias} entry list ${body.msg || "bad"}`);
  if (body.data.length >= 2000) throw new Error(`${alias} entry list hit the page cap`);
  return body.data;
}

function iconUrl(icon) {
  let value = String(icon || "").trim();
  if (!value) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  if (value.startsWith("http://")) value = `https://${value.slice("http://".length)}`;
  return portraitTarget(value) ? value : "";
}

async function imageMagic(url, headers) {
  const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(25000) });
  if (res.status !== 200) {
    await res.arrayBuffer().catch(() => {});
    return "";
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const type = looksLikeImage(new Uint8Array(await res.arrayBuffer()));
    return type;
  }
  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  return looksLikeImage(value || new Uint8Array());
}

function withPortrait(card, fields) {
  const out = {};
  let placed = false;
  for (const [key, value] of Object.entries(card)) {
    if (key === "portrait" || key === "portrait_source" || key === "portrait_via") continue;
    out[key] = value;
    if (key === "gamekee_entry_id") {
      Object.assign(out, fields);
      placed = true;
    }
  }
  if (!placed) Object.assign(out, fields);
  return out;
}

function prydwenPage(card) {
  const sources = Array.isArray(card.sources) ? card.sources : [];
  for (const source of sources) {
    const match = String(source).match(/^https:\/\/www\.prydwen\.gg\/nikke\/characters\/([a-z0-9-]+)\/?$/i);
    if (match) return { url: `https://www.prydwen.gg/nikke/characters/${match[1].toLowerCase()}`, slug: match[1].toLowerCase() };
  }
  return null;
}

function pythonText(url) {
  const script = `
import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
})
with urllib.request.urlopen(req, timeout=30) as res:
    sys.stdout.buffer.write(res.read())
`;
  const result = spawnSync("python3", ["-c", script, url], {
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) return "";
  return result.stdout.toString("utf8");
}

function prydwenImage(html, slug) {
  const found = new Set();
  const re = /https:\/\/cdn\.prydwen\.gg\/images\/nikke\/characters\/[a-z0-9-]+\.webp/gi;
  let match;
  while ((match = re.exec(html))) found.add(match[0]);
  const prefer = [
    `https://cdn.prydwen.gg/images/nikke/characters/${slug}.webp`,
    `https://cdn.prydwen.gg/images/nikke/characters/${slug}_card.webp`,
  ];
  return prefer.find((url) => found.has(url) && portraitTarget(url)) || "";
}

function matchEntry(card, byId) {
  const entryId = Number(card.gamekee_entry_id);
  const contentId = Number(card.gamekee_content_id);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  if (!Number.isInteger(contentId) || contentId <= 0) return null;
  const row = byId.get(entryId);
  if (!row || row.is_del) return null;
  if (Number(row.content_id) !== contentId) return null;
  return row;
}

async function fillGame(game) {
  const rows = await entryList(game.alias);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const cards = listCards(game.id);
  const jobs = [];
  const results = [];

  for (const item of cards) {
    const row = matchEntry(item.card, byId);
    const url = row ? iconUrl(row.icon) : "";
    if (row && String(row.icon || "").trim() && !url) {
      results.push({ ...item, kind: "rejected-icon", url: "" });
      continue;
    }
    if (!url) {
      results.push({ ...item, kind: "no-gamekee-icon", url: "" });
      continue;
    }
    jobs.push({ ...item, kind: "gamekee", url, entryId: Number(row.id) });
  }

  const checked = await pool(jobs, 8, async (job) => {
    let type = "";
    try {
      type = await imageMagic(job.url, GAMEKEE_IMAGE_HEADERS);
    } catch {
      type = "";
    }
    return { ...job, kind: type ? "gamekee" : "image-failed", url: type ? job.url : "" };
  });

  const byFile = new Map([...results, ...checked].map((row) => [row.file, row]));
  const ordered = cards.map((item) => byFile.get(item.file));

  const gamekeeOk = ordered.filter((row) => row.kind === "gamekee").length;
  const gamekeeTried = jobs.length;
  if (gamekeeTried >= 10 && gamekeeOk / gamekeeTried < 0.5) {
    throw new Error(`${game.id}: only ${gamekeeOk}/${gamekeeTried} GameKee icons verified; not writing`);
  }

  for (const row of ordered) {
    if (row.kind === "gamekee") {
      row.fields = {
        portrait: row.url,
        portrait_source: ENTRY_LIST,
        portrait_via: `gamekee-entry-icon:${game.alias}:${row.entryId}`,
      };
      continue;
    }
    row.fields = { portrait: null, portrait_source: null, portrait_via: null };
    if (game.id !== "nikke") continue;
    const page = prydwenPage(row.card);
    if (!page) continue;
    const html = pythonText(page.url);
    if (!html || html.length < 1000 || /Just a moment/i.test(html.slice(0, 500))) continue;
    const image = prydwenImage(html, page.slug);
    if (!image) continue;
    let type = "";
    try {
      type = await imageMagic(image, {
        Accept: "image/*",
        "User-Agent": GAMEKEE_IMAGE_HEADERS["User-Agent"],
        Referer: "https://game-intel-ai.dyk1454683243.workers.dev/",
      });
    } catch {
      type = "";
    }
    if (!type) continue;
    row.kind = "prydwen";
    row.fields = {
      portrait: image,
      portrait_source: page.url,
      portrait_via: `prydwen-character:${page.slug}`,
    };
  }

  if (!DRY) {
    for (const row of ordered) writeJson(row.file, withPortrait(row.card, row.fields));
  }

  const counts = {};
  for (const row of ordered) counts[row.kind] = (counts[row.kind] || 0) + 1;
  const missing = ordered.filter((row) => row.fields.portrait == null).map((row) => row.card.id);
  return { game: game.id, cards: ordered.length, counts, missing };
}

const summary = [];
for (const game of GAMES) {
  summary.push(await fillGame(game));
}
console.log(JSON.stringify({ ok: true, dry_run: DRY, summary }, null, 2));
