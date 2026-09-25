/**
 * Multi-game guide loader.
 * Canonical: data/guides/{game}/  (hw migrated from data/hw-guides via symlink).
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveAlias as resolveHwAlias,
  guideHw as guideHwCard,
  listCharacterIds as listHwIds,
  loadDopamine,
  loadCharacter as loadHwCharacter,
} from "./hw-guides.js";

/** Watchlist game ids that should eventually have guides/{id}/ */
export const WATCHLIST_GAMES = [
  "hw",
  "nikke",
  "bd2",
  "star",
  "asora",
  "miraesi",
  "lo2",
];

export function guidesRoot(dataDir) {
  return path.join(dataDir, "guides");
}

export function gameGuidesDir(dataDir, game) {
  return path.join(guidesRoot(dataDir), String(game || "").toLowerCase().trim());
}

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function listGuideGames(dataDir) {
  const root = guidesRoot(dataDir);
  if (!fs.existsSync(root)) return [...WATCHLIST_GAMES];
  const found = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
  // Union with watchlist so empty scaffolds still appear
  return [...new Set([...WATCHLIST_GAMES, ...found])].sort();
}

export function listCharacterIdsForGame(dataDir, game) {
  const g = String(game || "").toLowerCase();
  if (g === "hw") return listHwIds(dataDir);
  const dir = path.join(gameGuidesDir(dataDir, g), "characters");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadCharacterForGame(dataDir, game, id) {
  const g = String(game || "").toLowerCase();
  const key = String(id || "").toLowerCase().trim();
  if (!key) return null;
  if (g === "hw") return loadHwCharacter(dataDir, key);
  const p = path.join(gameGuidesDir(dataDir, g), "characters", `${key}.json`);
  return readJsonSafe(p, null);
}

function isStubCard(c) {
  if (!c) return true;
  if (c.stub === true) return true;
  if (c.stub === false) return false;
  return !(Array.isArray(c.skills) && c.skills.length > 0);
}

export function listGuides(dataDir, { game } = {}) {
  const games = game
    ? [String(game).toLowerCase()]
    : listGuideGames(dataDir);
  const watch = readJsonSafe(path.join(dataDir, "watchlist.json"), {}) || {};
  const asOf = new Date().toISOString().slice(0, 10);
  const out = [];

  for (const g of games) {
    const ids = listCharacterIdsForGame(dataDir, g);
    let stub = 0;
    let rich = 0;
    for (const id of ids) {
      const c = loadCharacterForGame(dataDir, g, id);
      if (isStubCard(c)) stub++;
      else rich++;
    }
    const entry = watch[g] || {};
    const aliases = loadAliasesJson(
      path.join(gameGuidesDir(dataDir, g), "aliases.json")
    );
    const hasModes =
      fs.existsSync(path.join(gameGuidesDir(dataDir, g), "dopamine-auto.json")) ||
      (fs.existsSync(path.join(gameGuidesDir(dataDir, g), "modes")) &&
        fs
          .readdirSync(path.join(gameGuidesDir(dataDir, g), "modes"))
          .some((f) => f.endsWith(".json")));
    out.push({
      id: g,
      name: entry.name || g,
      name_zh: entry.name_zh || entry.name || g,
      character_count: ids.length,
      rich_count: rich,
      stub_count: stub,
      has_aliases: !!(aliases && Object.keys(aliases.aliases || {}).length),
      has_modes: !!hasModes,
      path: `guides/${g}`,
    });
  }

  return {
    ok: true,
    as_of: asOf,
    timezone: "Asia/Shanghai",
    count: out.length,
    games: out,
  };
}

/**
 * Generic guide. HW uses full alias/topic engine; others return no_cards_yet
 * until verified cards exist.
 */

function loadAliasesJson(aliasesPath) {
  const aliases = readJsonSafe(aliasesPath, null);
  if (!aliases || typeof aliases !== "object") return aliases;
  const parts = aliases._parts;
  if (!Array.isArray(parts) || !parts.length) return aliases;
  const dir = path.dirname(aliasesPath);
  const merged = { ...aliases, aliases: { ...(aliases.aliases || {}) } };
  for (const part of parts) {
    const partPath = path.join(dir, String(part));
    const pj = readJsonSafe(partPath, null);
    const map = pj?.aliases && typeof pj.aliases === "object" ? pj.aliases : pj;
    if (map && typeof map === "object" && !Array.isArray(map)) {
      Object.assign(merged.aliases, map);
    }
  }
  return merged;
}

function resolveAliasForGame(dataDir, game, q) {
  const raw = String(q || "").trim();
  if (!raw) return null;
  const aliases = loadAliasesJson(
    path.join(gameGuidesDir(dataDir, game), "aliases.json")
  );
  const map = aliases?.aliases || {};
  // exact then case-insensitive
  if (map[raw]) return map[raw];
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (String(k).toLowerCase() === lower) return v;
  }
  // direct id hit
  const ids = listCharacterIdsForGame(dataDir, game);
  if (ids.includes(lower)) return { id: lower, name: lower, kind: "character" };
  return null;
}

function formatGuideCard(g, card, topic) {
  const t = topic || "all";
  const base = {
    ok: true,
    game: g,
    topic: t,
    id: card.id,
    name: card.name,
    name_zh: card.name_zh || null,
    name_en: card.name_en || null,
    stub: isStubCard(card),
    sources: card.sources || [],
    note: card.note || null,
    verified: card.verified || null,
  };
  if (t === "skills") {
    return { ...base, skills: card.skills || [], skill_prio: card.skill_prio || [] };
  }
  if (t === "overview") {
    return {
      ...base,
      role: card.role || null,
      rarity: card.rarity || null,
      element: card.element || null,
      manufacturer: card.manufacturer || null,
      weapon: card.weapon || null,
      burst: card.burst || null,
      aliases: card.aliases || [],
      nicknames: card.nicknames || [],
    };
  }
  return {
    ...base,
    role: card.role || null,
    rarity: card.rarity || null,
    element: card.element || null,
    manufacturer: card.manufacturer || null,
    weapon: card.weapon || null,
    burst: card.burst || null,
    skills: card.skills || [],
    skill_prio: card.skill_prio || [],
    aliases: card.aliases || [],
    nicknames: card.nicknames || [],
  };
}

export function guide(dataDir, { game, q, id, topic } = {}) {
  const g = String(game || "hw").toLowerCase().trim();
  if (!g) return { ok: false, error: "need_game" };

  if (g === "hw") {
    return guideHwCard(dataDir, { q, id, topic });
  }

  const ids = listCharacterIdsForGame(dataDir, g);
  if (!ids.length) {
    return {
      ok: false,
      error: "no_cards_yet",
      game: g,
      hint: `Fill data/guides/${g}/ from verified GameKee 图鉴/测评 or Bahamut only.`,
    };
  }

  const rawId = id ? String(id).toLowerCase().trim() : "";
  if (rawId) {
    const card = loadCharacterForGame(dataDir, g, rawId);
    if (!card) {
      return { ok: false, error: "no_character_card", game: g, id: rawId };
    }
    return formatGuideCard(g, card, topic);
  }

  if (q) {
    const hit = resolveAliasForGame(dataDir, g, q);
    if (hit?.id) {
      const card = loadCharacterForGame(dataDir, g, hit.id);
      if (!card) {
        return { ok: false, error: "no_character_card", game: g, id: hit.id };
      }
      return formatGuideCard(g, card, topic);
    }
    return {
      ok: false,
      error: "alias_not_found",
      game: g,
      q: String(q),
      hint: "Try id=rapi / scarlet / modernia, or add aliases.json entry.",
      character_count: ids.length,
    };
  }

  return {
    ok: false,
    error: "need_q_or_id",
    game: g,
    hint: "Pass id (e.g. rapi) or q matching aliases.json.",
    character_count: ids.length,
  };
}

export { resolveHwAlias, guideHwCard, loadDopamine };
