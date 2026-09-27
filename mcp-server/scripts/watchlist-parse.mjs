/**
 * Pure parsers for watchlist conclusions. Never invents tiers or numbers.
 */

const NIKKE_TIERS = new Set(["SSS", "SS", "S", "A", "B", "C", "D", "E", "F"]);

/** nikke.gg url slug → local card id, when the published slug is not our id. */
export const NIKKE_SLUG_ALIAS = {
  "anis-sparkling-summer": "sparkling-summer-anis",
  "helm-aquamarine": "aqua-marine-helm",
  "snow-white-innocent-days": "innocent-dayss-snow-white",
  "anne-miracle-fairy": "miracle-fairy-anne",
  "mary-bay-goddess": "bay-goddess-mary",
  "neon-blue-ocean": "blue-ocean-neon",
  "rupee-winter-shopper": "winter-shopper-rupee",
  mari: "mari-makinami-illustrious",
  asuka: "asuka-shikinami-langley",
  misato: "misato-katsuragi",
  "asuka-wille": "asuka-shikinami-langley-wille",
  "little-mermaid": "siren",
  jill: "jill-valentine",
  ada: "ada-wong",
  claire: "claire-redfield",
  chisato: "chisato-nishikigi",
  takina: "takina-inoue",
};

export function nikkeLocalId(url, knownIds) {
  const raw = String(url || "");
  const treasure = /(?:\?|&)treasure=true/.test(raw);
  const base = raw.split("?")[0];
  if (treasure && knownIds.has(`${base}-treasure`)) return `${base}-treasure`;
  if (!treasure && NIKKE_SLUG_ALIAS[base] && knownIds.has(NIKKE_SLUG_ALIAS[base])) {
    return NIKKE_SLUG_ALIAS[base];
  }
  if (knownIds.has(base)) return base;
  if (knownIds.has(raw)) return raw;
  return null;
}

export function nikkeCharacterUrl(url) {
  const raw = String(url || "");
  const treasure = /(?:\?|&)treasure=true/.test(raw);
  const base = raw.split("?")[0];
  if (!base) return null;
  if (treasure) return `https://nikke.gg/characters/${base}/?treasure=true`;
  return `https://nikke.gg/characters/${base}/`;
}

export function isNikkeTier(value) {
  return NIKKE_TIERS.has(String(value || "").trim());
}

/**
 * Render a Nikke.gg skill at level 1 by substituting published description_value_*.
 * Returns null if a referenced placeholder has no published value.
 */
export function renderNikkeSkill(description, levelRow) {
  let text = String(description || "");
  if (!text.trim()) return null;
  const refs = [...text.matchAll(/\{(description_value_\d+)\}/g)].map((m) => m[1]);
  for (const key of refs) {
    const v = levelRow?.[key];
    if (v == null || String(v).trim() === "") return null;
  }
  text = text.replace(/<word_group=\d+>([\s\S]*?)<\/word_group>/g, "$1");
  text = text.replace(/<\/?color[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\{(description_value_\d+)\}/g, (_, key) => String(levelRow[key]).trim());
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 900 ? `${text.slice(0, 900).trim()}…` : text;
}

export function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Pull the first 综合评价 tier phrase from a GameKee review summary. */
export function extractCostumeTier(summary) {
  const text = String(summary || "");
  const m = text.match(
    /综合评价[:：]\s*(T\d(?:\.\d)?(?:（[^）]{0,48}）)?)(?:\s*(T\d(?:\.\d)?(?:（[^）]{0,48}）)?))?/
  );
  if (!m) return null;
  const tiers = [m[1], m[2]].filter(Boolean);
  return tiers.join(" / ");
}

/** Copy explicit 建议抽 / 不建议抽 / 必抽 clauses. No paraphrase. */
export function extractCostumePull(summary) {
  const text = String(summary || "");
  const bits = [];
  const re = /(?:不建议抽[^。！\n]{0,30}|建议抽[^。！\n]{0,40}|必抽[^。！\n]{0,24})/g;
  let m;
  while ((m = re.exec(text))) bits.push(m[0].replace(/\s+/g, " ").trim());
  return [...new Set(bits)].slice(0, 3).join("；");
}

const TITLE_HINTS = [
  [/卢班[希西]亚/, "lu_ban_xi_ya"],
  [/忌妒之夜|猜忌之夜/, "lai_wei_ya"],
  [/威廉/, "wei_lian_ming_na"],
  [/芮彼/, "rui_bi_tai_ya"],
  [/米卡/, "micaela"],
  [/哥杀|哥布林杀手/, "goblin_slayer"],
  [/戴安娜|黛安娜/, "diana"],
];

function keysFor(card) {
  const keys = [];
  for (const value of [card.name, card.name_zh, ...(card.nicknames || [])]) {
    if (typeof value === "string" && value.trim().length >= 2) keys.push(value.trim());
  }
  for (const costume of card.costumes || []) {
    if (typeof costume?.name === "string" && costume.name.trim().length >= 2) {
      keys.push(costume.name.trim());
    }
  }
  return keys;
}

/**
 * Match one review to one character. Ambiguous ties return null.
 * Title hints are used only when the title itself matches and no longer name hits a different card.
 */
export function matchCostumeReview(title, summary, cards) {
  const titleText = String(title || "");
  if (/全角色|三四星|抽卡测评|重做测评|梯度排行|怎么抽/.test(titleText)) return null;
  const owners = new Map();
  for (const card of cards) {
    for (const key of keysFor(card)) {
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(card.id);
    }
  }
  const hits = [];
  for (const card of cards) {
    let best = 0;
    for (const key of keysFor(card)) {
      if ((owners.get(key)?.size || 0) !== 1) continue;
      const inTitle = titleText.includes(key);
      const inBody = String(summary || "").includes(key);
      if (!inTitle && !inBody) continue;
      const score = key.length + (inTitle ? 100 : 0);
      if (score > best) best = score;
    }
    if (best >= 2) hits.push({ id: card.id, score: best });
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length) {
    const top = hits.filter((hit) => hit.score === hits[0].score);
    const ids = [...new Set(top.map((hit) => hit.id))];
    if (ids.length === 1) return ids[0];
    return null;
  }
  const hinted = [];
  for (const [re, id] of TITLE_HINTS) {
    if (re.test(titleText) && cards.some((card) => card.id === id)) hinted.push(id);
  }
  const uniq = [...new Set(hinted)];
  return uniq.length === 1 ? uniq[0] : null;
}
