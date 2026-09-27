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

const GRADE_TOKEN = "T\\d+(?:\\.\\d+)?(?:（[^）]{0,48}）)?";
const GRADE_PREFIX = "前期|后期|全期|单皮|萌新";

/** Flatten GameKee editor JSON or HTML to plain text. Does not invent text. */
export function stripMarkup(value) {
  let s = String(value || "");
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      let content = parsed && typeof parsed === "object" ? parsed.content ?? parsed : parsed;
      if (typeof content === "string") {
        try {
          const nodes = JSON.parse(content);
          if (Array.isArray(nodes)) content = nodes;
        } catch {
          /* HTML or plain string inside the envelope */
        }
      }
      if (Array.isArray(content)) {
        const texts = [];
        const walk = (node) => {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(walk);
            return;
          }
          if (typeof node === "object") {
            if (typeof node.text === "string" && node.text.trim()) texts.push(node.text.trim());
            if (node.children) walk(node.children);
          }
        };
        walk(content);
        if (texts.length) s = texts.join("\n");
        else if (typeof parsed.content === "string") s = parsed.content;
      } else if (typeof content === "string" && content.trim()) {
        s = content;
      }
    } catch {
      /* keep original */
    }
  }
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Pull the first 综合评价 tier phrase.
 * Accepts a short qualifier (前期 / 单皮) and a second grade.
 * Rejects a prose sentence that merely mentions the label.
 */
export function extractCostumeTier(summary) {
  const text = stripMarkup(summary).replace(/[ \t]+/g, " ");
  const m = text.match(/综合评价[:：]\s*([\s\S]{0,120})/);
  if (!m) return null;
  const rest = m[1].trim();
  const first = rest.match(
    new RegExp(`^(?:${GRADE_PREFIX})?\\s*(${GRADE_TOKEN})`)
  );
  if (!first) return null;
  const grades = [first[1]];
  const idx = first[0].length;
  const second = rest
    .slice(idx)
    .match(new RegExp(`^(?:\\s*[，,/／]?\\s*)(?:${GRADE_PREFIX})?\\s*(${GRADE_TOKEN})`));
  if (second && second[1] && second.index === 0) grades.push(second[1]);
  const hasQualifier = new RegExp(`^(?:${GRADE_PREFIX})`).test(rest);
  if (hasQualifier) {
    const end = idx + (second && second[1] ? second[0].length : 0);
    return rest.slice(0, end).replace(/\s+/g, " ").trim();
  }
  if (grades.length >= 2) return grades.slice(0, 2).join(" / ");
  return grades[0];
}

/** First 服装评价 / 综合评价 line in one section, only when it contains a T grade. */
export function extractLabeledGrade(sectionText) {
  const text = stripMarkup(sectionText);
  const m = text.match(/(?:服装综合评价|综合评价|服装评价)[:：]\s*([^\n]{1,48})/);
  if (!m) return null;
  const phrase = m[1].replace(/\s+/g, " ").trim();
  if (!/T\d/.test(phrase)) return null;
  if (/[。！？]/.test(phrase)) return null;
  return phrase;
}

/**
 * Numbered 三四星-style sections. Skips a heading that names three or more characters.
 * Returns only sections whose evaluation line contains a written T grade.
 */
export function parseNumberedGradeSections(text) {
  const clean = stripMarkup(text);
  const chunks = clean.split(/\n(?=\s*\d+\.\s*)/);
  const out = [];
  for (const chunk of chunks) {
    const head = chunk.match(/^\s*\d+\.\s*([^\n]{2,48})/);
    if (!head) continue;
    const heading = head[1].trim();
    const names = heading.split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
    if (names.length >= 3) continue;
    const tier = extractLabeledGrade(chunk);
    if (!tier) continue;
    out.push({ heading, tier, body: chunk });
  }
  return out;
}

const SECTION_HINTS = [
  [/绿帽|（阿里）|阿里内斯/, "a_li_nei_si"],
  [/卢克蕾西亚/, "lu_ke_lei_qi_ya"],
];

/** One numbered section → one character. Title match first; hints only on a miss. */
export function matchGradeSection(heading, body, cards) {
  const hinted = [];
  for (const [re, cid] of SECTION_HINTS) {
    if (re.test(String(heading || "")) && cards.some((card) => card.id === cid)) hinted.push(cid);
  }
  const uniq = [...new Set(hinted)];
  if (uniq.length === 1) return uniq[0];
  return matchCostumeReview(heading, `${heading}\n${body || ""}`, cards);
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

/** A shorter name glued inside a different longer name is not a hit. */
const NAME_SHADOW = [["克蕾西亚", "卢克蕾西亚"]];

function mentionsKey(hay, key) {
  const text = String(hay || "");
  if (!text.includes(key)) return false;
  for (const [short, long] of NAME_SHADOW) {
    if (key === short && text.includes(long)) return false;
  }
  return true;
}

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
      const inTitle = mentionsKey(titleText, key);
      const inBody = mentionsKey(summary, key);
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
