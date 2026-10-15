/**
 * Cited team rosters. A roster is kept only when every member slug maps to
 * exactly one character id. Existing teams are never cleared or rewritten.
 */

const PLACEHOLDER = /^(flex|any|filler|b1|b2|b3|b1-cdr|b2-cdr|b3-cdr)$/i;

export function teamsEmpty(card) {
  const teams = card?.teams;
  if (!teams || typeof teams !== "object" || Array.isArray(teams)) return true;
  return !Object.values(teams).some((value) => {
    if (value == null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

function addSlug(keys, value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return;
  if (text.includes("treasure=true")) {
    const base = text.split("?")[0].replace(/-treasure$/, "");
    if (base) keys.add(`${base}-treasure`);
    return;
  }
  const bare = text.split("?")[0];
  if (bare) keys.add(bare);
}

export function slugKeys(card) {
  const keys = new Set();
  addSlug(keys, card?.id);
  addSlug(keys, card?.prydwen_slug);
  addSlug(keys, card?.ratings?.slug);
  return [...keys];
}

export function indexBySlug(cards) {
  const index = new Map();
  for (const card of cards) {
    for (const key of slugKeys(card)) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(card.id);
    }
  }
  return index;
}

export function resolveSlug(slug, index) {
  const key = String(slug || "").trim().toLowerCase();
  if (!key || PLACEHOLDER.test(key) || key.includes("flex")) return null;
  const ids = index.get(key);
  if (!ids || ids.size !== 1) return null;
  return [...ids][0];
}

export function acceptRoster(slugs, index, { size = 5 } = {}) {
  if (!Array.isArray(slugs) || slugs.length !== size) return null;
  const ids = [];
  for (const slug of slugs) {
    const id = resolveSlug(slug, index);
    if (!id) return null;
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

export function formatRosterLine(roster, names) {
  const label = String(roster.label || "").trim();
  const source = String(roster.source || "").trim();
  const asOf = String(roster.asOf || "").trim();
  if (!label || !/^https?:\/\//.test(source) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "";
  if (!names.length) return "";
  return `${label}：${names.join(" / ")}（${source} ，as_of ${asOf}）`;
}

function displayName(card) {
  return String(card?.name || card?.name_zh || "").trim();
}

export function applyCitedTeams(cards, rosters, { limit = 2 } = {}) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const nameOwners = new Map();
  for (const card of cards) {
    const name = displayName(card);
    if (!name) continue;
    if (!nameOwners.has(name)) nameOwners.set(name, new Set());
    nameOwners.get(name).add(card.id);
  }
  const touched = [];
  for (const card of cards) {
    if (!teamsEmpty(card)) continue;
    const mine = rosters
      .filter((roster) => Array.isArray(roster.members) && roster.members.includes(card.id))
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const chosen = [];
    const seen = new Set();
    for (const roster of mine) {
      const key = [...roster.members].sort().join("|");
      if (seen.has(key)) continue;
      const names = [];
      let ok = true;
      for (const id of roster.members) {
        const member = byId.get(id);
        const name = member && displayName(member);
        const owners = name ? nameOwners.get(name) : null;
        if (!member || !name || !owners || owners.size !== 1) {
          ok = false;
          break;
        }
        names.push(name);
      }
      const line = ok ? formatRosterLine(roster, names) : "";
      if (!line) continue;
      seen.add(key);
      chosen.push({ roster, line });
      if (chosen.length >= limit) break;
    }
    if (!chosen.length) continue;
    if (!card.teams || typeof card.teams !== "object" || Array.isArray(card.teams)) card.teams = {};
    card.teams.comp = chosen.map((row) => row.line);
    if (!Array.isArray(card.sources)) card.sources = [];
    for (const row of chosen) {
      if (!card.sources.includes(row.roster.source)) card.sources.push(row.roster.source);
    }
    touched.push(card.id);
  }
  return touched;
}
