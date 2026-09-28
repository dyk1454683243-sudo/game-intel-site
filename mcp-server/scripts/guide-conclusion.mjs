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
  if (game === "nikke") return nikkeFromRatings(card, sources) || catalogSummary(card, sources, "nikke");
  if (game === "bd2") return bd2FromCostumeRatings(card, sources) || catalogSummary(card, sources, "bd2");
  return existing && typeof existing === "object" ? existing : null;
}

function pullFromNote(note) {
  const m = String(note || "").match(/抽取建议:\s*([^|]+)/);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

const NIKKE_TIERS = new Set(["SSS", "SS", "S", "A", "B", "C", "D", "E", "F"]);

function uniqSources(list) {
  const out = [];
  for (const s of list) {
    if (typeof s === "string" && HTTP.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function nikkePosition(card) {
  return [card.rarity, card.burst, card.role, card.element, card.manufacturer]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" / ");
}

function bd2Position(card) {
  return [card.rarity, card.element, card.attack_type, card.role]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" / ");
}

function nikkeTierLine(ratings) {
  const combined = String(ratings.combined || "").trim();
  if (!NIKKE_TIERS.has(combined)) return "";
  const bits = [`Nikke.gg 综合 ${combined}`];
  const parts = [];
  for (const [key, label] of [
    ["story", "故事"],
    ["boss", "Boss"],
    ["pvp", "PvP"],
  ]) {
    const v = String(ratings[key] || "").trim();
    if (NIKKE_TIERS.has(v)) parts.push(`${label} ${v}`);
  }
  return parts.length ? `${bits[0]}（${parts.join(" / ")}）` : bits[0];
}

function nikkeFromRatings(card, sources) {
  const ratings = card?.ratings;
  if (!ratings || typeof ratings !== "object") return null;
  const tier = nikkeTierLine(ratings);
  const cited = uniqSources([
    ratings.url,
    ratings.character_url,
    ...sources,
  ]);
  if (!cited.length) return null;
  const position = nikkePosition(card);
  if (tier) {
    const notes = [
      "强度摘自 Nikke.gg 梯度页（编辑向，非官方；页面说明综合档约 60% Boss、40% 战役，不含 PvP）。不编造抽卡结论。",
    ];
    if (ratings.req_invest === true) notes.push("Nikke.gg 标记需高练度才完整发挥。");
    if (ratings.strong_early === true) notes.push("Nikke.gg 标记低中战役缺口表现更好。");
    const summary = {
      tier,
      sources: cited,
      stub: false,
      caveat: notes.join(""),
    };
    if (position) summary.position = position;
    return summary;
  }
  if (ratings.checked === true) {
    const summary = {
      sources: cited,
      stub: true,
      caveat:
        "Nikke.gg 2026-09 梯度页未给出该角色综合档。强度未见可靠出处，不编造 T 度或抽卡结论。",
    };
    if (position) summary.position = position;
    return summary;
  }
  return null;
}

function isBd2TextGrade(tier) {
  const t = String(tier || "").trim();
  if (!t || t.length > 80) return false;
  if (/[。！？?]/.test(t)) return false;
  return /T\d/.test(t);
}

function bd2FromCostumeRatings(card, sources) {
  const rows = Array.isArray(card?.costume_ratings) ? card.costume_ratings : [];
  const good = rows.filter(
    (row) =>
      row &&
      isBd2TextGrade(row.tier) &&
      typeof row.source === "string" &&
      HTTP.test(row.source) &&
      typeof row.label === "string" &&
      row.label.trim()
  );
  if (!good.length) return null;
  const pulls = good
    .filter((row) => typeof row.pull === "string" && row.pull.trim())
    .map((row) => `${row.label.trim()}：${row.pull.trim()}`);
  const atlas = good.some((row) => row.kind === "atlas");
  const review = good.some((row) => row.kind !== "atlas");
  const prefix =
    atlas && !review ? "GameKee 图鉴服装梯度：" : atlas && review ? "GameKee：" : "GameKee 服装测评：";
  const summary = {
    tier: `${prefix}${good.map((row) => `${row.label.trim()} ${row.tier.trim()}`).join("；")}`,
    sources: uniqSources([...good.map((row) => row.source), ...sources]),
    stub: false,
    caveat: atlas
      ? "梯度只摘自 GameKee 角色图鉴「服装梯度」单元格里写明的 T 档，按服装分列，不合并成角色总榜。抽取建议只复制同表「抽取建议」单元格原文。没有 T 档的服装不收录，不编造。"
      : "梯度只摘自 GameKee 测评正文里写明的「综合评价」或「服装评价」短句，按出处分列，不合并成角色总榜。测评写明具备时效性。图片榜无角色名文本的不收录，不编造未写明的服装。",
  };
  const position = bd2Position(card);
  if (position) summary.position = position;
  if (pulls.length) summary.pull = pulls.join("；");
  return summary;
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
