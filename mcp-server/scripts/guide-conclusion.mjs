/**
 * Conclusion line (`summary`) for character cards.
 * Uses only fields already on the card. Never invents T-ranks, pull advice, rates, or prices.
 * Thin evidence → summary.stub = true (the skill card can stay non-stub).
 */

const HTTP = /^https?:\/\//i;

export function httpSources(card) {
  const raw = [];
  if (Array.isArray(card?.sources)) raw.push(...card.sources);
  if (Array.isArray(card?.summary?.sources)) raw.push(...card.summary.sources);
  const out = [];
  for (const s of raw) {
    if (typeof s === "string" && HTTP.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function keepExisting(existing) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  if (existing.stub === true) return false;
  const srcs = Array.isArray(existing.sources)
    ? existing.sources.filter((s) => typeof s === "string" && HTTP.test(s))
    : [];
  return srcs.length > 0 && Boolean(existing.tier || existing.pull);
}

/**
 * @param {object} card
 * @returns {object|null} summary object, or null when this game has no conclusion rule
 */
export function conclusionFromCard(card) {
  const existing = card?.summary;
  if (keepExisting(existing)) {
    return {
      ...existing,
      sources: httpSources({ ...card, summary: existing }),
    };
  }
  const sources = httpSources(card);
  const game = card?.game;
  if (game === "hw") return hwSummary(card, sources);
  if (game === "nikke") return catalogSummary(card, sources, "nikke");
  if (game === "bd2") return catalogSummary(card, sources, "bd2");
  return existing && typeof existing === "object" ? existing : null;
}

function pullFromNote(note) {
  const m = String(note || "").match(/抽取建议:\s*([^|]+)/);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function hwSummary(card, sources) {
  const role = String(card.role || "").trim();
  const hasTier = /^T\d/.test(role);
  const pull = pullFromNote(card.note);
  const summary = { sources };
  if (hasTier) summary.tier = role;
  else if (role) summary.position = role;
  if (pull) {
    summary.pull = pull;
    summary.stub = false;
    summary.caveat = "抽取建议摘自卡面已收录备注，未另编数字。";
  } else if (hasTier) {
    summary.stub = false;
    summary.caveat =
      "强度来自 GameKee 图鉴 T度/标签（卡面 role）。本卡无独立抽取建议正文，不编造抽卡结论。";
  } else {
    summary.stub = true;
    summary.caveat =
      "仓内无已核实 T 度或抽取建议，结论行 stub:true，不编造强度或抽卡。";
  }
  return summary;
}

function catalogSummary(card, sources, game) {
  const parts =
    game === "bd2"
      ? [card.rarity, card.element, card.attack_type, card.role]
      : [card.rarity, card.burst, card.role, card.element, card.manufacturer];
  const position = parts.filter((x) => typeof x === "string" && x.trim()).join(" / ");
  const caveat =
    game === "nikke"
      ? "仅有 GameKee/Prydwen 图鉴职业与技能。仓内无已核实强度榜或抽取建议，结论行 stub:true，不编造 T 度与抽卡结论。"
      : "仅有 GameKee 图鉴职业/属性/稀有度与技能。仓内无已核实强度榜或抽取建议，结论行 stub:true，不编造 T 度、抽卡结论或价格。";
  return {
    position: position || "图鉴未标定位",
    sources,
    stub: true,
    caveat,
  };
}

export function applyConclusion(card) {
  const summary = conclusionFromCard(card);
  if (!summary) return card;
  return { ...card, summary };
}
