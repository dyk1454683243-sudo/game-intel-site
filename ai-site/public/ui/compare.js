/**
 * Side-by-side projection of fields already stored on character cards.
 * Empty cells stay empty. The page prints 暂无出处; this module does not fill them.
 */
import { displayCharacterName, localizePath, tx } from "./i18n.js";
import { characterHref, esc, teamLines } from "./render.js";

export const COMPARE_KEY = "game-intel.compare.v1";
export const COMPARE_GAP = "暂无出处";
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ATTRS = [
  ["role", "职业 / 定位", "Class / role", "役割"],
  ["element", "属性", "Element", "属性"],
  ["rarity", "稀有度", "Rarity", "レア度"],
  ["faction", "阵营", "Faction", "陣営"],
  ["attack_type", "攻击类型", "Attack type", "攻撃タイプ"],
  ["burst", "爆裂", "Burst", "バースト"],
  ["class", "职业", "Class", "クラス"],
  ["profession", "职业", "Profession", "職業"],
  ["attribute", "属性", "Attribute", "属性"],
  ["afflatus", "灵视", "Afflatus", "霊視"],
  ["damage_type", "伤害类型", "Damage type", "ダメージ"],
  ["path", "命途", "Path", "運命"],
  ["weapon_type", "武器类型", "Weapon type", "武器種"],
  ["manufacturer", "制造商", "Manufacturer", "メーカー"],
  ["position", "定位", "Position", "役割"],
];

function fail(error, message, status = 400) {
  return { ok: false, error, message, status };
}

export function gapLabel() {
  return tx(COMPARE_GAP, "No cited source", "出典なし");
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function httpsUrl(value) {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(text) || /[\s<>"']/.test(text)) return "";
  return text;
}

function slugPair(token) {
  const match = String(token ?? "")
    .trim()
    .toLowerCase()
    .match(/^([a-z0-9][a-z0-9_-]{0,63}):([a-z0-9][a-z0-9_-]{0,63})$/);
  if (!match || !SLUG.test(match[1]) || !SLUG.test(match[2])) return null;
  return { game: match[1], id: match[2] };
}

export function parseCompareIds(input) {
  const tokens = Array.isArray(input) ? input : String(input ?? "").split(/[\s,，]+/);
  const ids = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!String(token ?? "").trim()) continue;
    let decoded = String(token).trim();
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return fail("bad_compare", "角色地址需要是 game:id。Need game:id.");
    }
    const row = slugPair(decoded);
    if (!row) return fail("bad_compare", "角色地址需要是 game:id。Need game:id.");
    const key = `${row.game}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(row);
  }
  if (ids.length < MIN_COMPARE) {
    return fail("bad_compare", "需要 2 到 4 张同一游戏的卡。Need 2 to 4 cards from the same game.");
  }
  if (ids.length > MAX_COMPARE) {
    return fail("bad_compare", "最多对比 4 张卡。At most 4 cards.");
  }
  if (ids.some((row) => row.game !== ids[0].game)) {
    return fail("bad_compare", "只能对比同一游戏的卡。Compare cards from the same game.");
  }
  return { ok: true, game: ids[0].game, ids, status: 200 };
}

export function parseCompareAdd(value) {
  let decoded = String(value ?? "").trim();
  if (!decoded) return null;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  return slugPair(decoded);
}

export function emptyCompare() {
  return { v: 1, ids: [] };
}

export function parseCompareState(raw) {
  const state = emptyCompare();
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.ids)) return state;
  const seen = new Set();
  for (const token of raw.ids) {
    const row = slugPair(token);
    if (!row) continue;
    const key = `${row.game}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.ids.push(key);
  }
  const game = state.ids[0] ? state.ids[0].split(":")[0] : "";
  state.ids = state.ids.filter((key) => key.startsWith(`${game}:`)).slice(0, MAX_COMPARE);
  return state;
}

export function addToCompare(state, token) {
  const row = typeof token === "object" ? slugPair(`${token.game}:${token.id}`) : parseCompareAdd(token);
  if (!row) return { ok: false, error: "bad_compare", state: parseCompareState(state), replaced: false };
  const next = parseCompareState(state);
  const key = `${row.game}:${row.id}`;
  const game = next.ids[0] ? next.ids[0].split(":")[0] : "";
  if (game && game !== row.game) {
    return { ok: true, state: { v: 1, ids: [key] }, replaced: true, added: true };
  }
  if (next.ids.includes(key)) return { ok: true, state: next, replaced: false, added: false };
  if (next.ids.length >= MAX_COMPARE) {
    return { ok: false, error: "too_many", state: next, replaced: false };
  }
  next.ids.push(key);
  return { ok: true, state: next, replaced: false, added: true };
}

function attrValue(card, key) {
  if (key === "position") {
    const summary = card.summary && typeof card.summary === "object" ? card.summary : null;
    return summary ? textOrNull(summary.position) : null;
  }
  return textOrNull(card[key]);
}

function projectRating(card) {
  const lines = [];
  const sources = [];
  const summary = card.summary && typeof card.summary === "object" && !Array.isArray(card.summary) ? card.summary : null;
  if (summary && textOrNull(summary.tier)) {
    lines.push(summary.tier.trim());
    for (const url of summary.sources || []) {
      const href = httpsUrl(url);
      if (href) sources.push(href);
    }
  }
  const ratings = card.ratings && typeof card.ratings === "object" && !Array.isArray(card.ratings) ? card.ratings : null;
  const ratingUrl = ratings ? httpsUrl(ratings.url) : "";
  if (ratingUrl) sources.push(ratingUrl);
  if (ratings) {
    const keyed = [
      ["combined", "综合"],
      ["story", "故事"],
      ["boss", "Boss"],
      ["pvp", "PvP"],
    ];
    for (const [key, label] of keyed) {
      const grade = textOrNull(ratings[key]);
      if (grade) lines.push(`${label} ${grade}`);
    }
    for (const row of Array.isArray(ratings.rows) ? ratings.rows : []) {
      if (!row || typeof row !== "object") continue;
      const role = textOrNull(row.role);
      const modes = Array.isArray(row.modes) ? row.modes : [];
      if (!modes.length && role) lines.push(role);
      for (const mode of modes) {
        if (!mode || typeof mode !== "object") continue;
        const text = [role, textOrNull(mode.label), textOrNull(mode.grade)].filter(Boolean).join(" · ");
        if (text) lines.push(text);
      }
    }
  }
  for (const row of Array.isArray(card.costume_ratings) ? card.costume_ratings : []) {
    if (!row || typeof row !== "object") continue;
    const text = [textOrNull(row.label), textOrNull(row.tier)].filter(Boolean).join(" ");
    if (!text) continue;
    lines.push(text);
    const href = httpsUrl(row.source);
    if (href) sources.push(href);
  }
  return {
    lines,
    sources: [...new Set(sources)],
    as_of: ratings ? textOrNull(ratings.as_of) : null,
    empty: lines.length === 0,
  };
}

function projectTeams(card) {
  const lines = teamLines(card).map((row) => ({ label: row.label, text: row.text }));
  return { lines, empty: lines.length === 0 };
}

function projectSkills(card) {
  const lines = [];
  for (const skill of Array.isArray(card.skills) ? card.skills : []) {
    if (!skill || typeof skill !== "object") continue;
    const name = textOrNull(skill.name);
    const summary = textOrNull(skill.summary);
    const type = textOrNull(skill.type);
    if (!name && !summary) continue;
    lines.push({ name, type, summary });
  }
  return { lines, empty: lines.length === 0 };
}

export function projectCompareCard(card) {
  const attributes = {};
  for (const [key] of ATTRS) {
    const value = attrValue(card, key);
    if (value) attributes[key] = value;
  }
  return {
    game: textOrNull(card.game),
    id: textOrNull(card.id),
    name: textOrNull(card.name),
    name_zh: textOrNull(card.name_zh),
    name_en: textOrNull(card.name_en),
    attributes,
    rating: projectRating(card),
    teams: projectTeams(card),
    skills: projectSkills(card),
  };
}

function columnName(card) {
  return displayCharacterName(card) || card.name || card.id || "";
}

export function compareDocument(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const parsed = parseCompareIds(list.map((card) => `${card && card.game}:${card && card.id}`));
  if (!parsed.ok) return parsed;
  for (const card of list) {
    if (!card || card.game !== parsed.game) {
      return fail("not_found", "角色卡和地址不一致。", 404);
    }
  }
  const projected = list.map(projectCompareCard);
  const rows = [];
  const attrKeys = ATTRS.filter(([key]) => projected.some((card) => card.attributes[key]));
  if (!attrKeys.length) {
    rows.push({
      section: "attributes",
      key: "attributes",
      cells: projected.map(() => null),
    });
  } else {
    for (const [key] of attrKeys) {
      rows.push({
        section: "attributes",
        key,
        cells: projected.map((card) => card.attributes[key] || null),
      });
    }
  }
  rows.push({
    section: "rating",
    key: "rating",
    cells: projected.map((card) => card.rating),
  });
  rows.push({
    section: "teams",
    key: "teams",
    cells: projected.map((card) => card.teams),
  });
  rows.push({
    section: "skills",
    key: "skills",
    cells: projected.map((card) => card.skills),
  });
  return {
    ok: true,
    derived: true,
    stored: false,
    game: parsed.game,
    count: projected.length,
    gap: COMPARE_GAP,
    columns: list.map((card) => ({
      game: card.game,
      id: card.id,
      name: columnName(card),
      name_zh: textOrNull(card.name_zh),
      name_en: textOrNull(card.name_en),
      path: `/character/?game=${encodeURIComponent(card.game)}&id=${encodeURIComponent(card.id)}`,
    })),
    rows,
  };
}

export async function assembleCompare(readJson, ids) {
  const parsed = parseCompareIds(ids);
  if (!parsed.ok) return parsed;
  const cards = [];
  for (const row of parsed.ids) {
    const card = await readJson(`/v1/guides/${row.game}/characters/${row.id}.json`);
    if (!card || card.game !== row.game || card.id !== row.id) {
      return fail("not_found", `没有已发布的角色卡 ${row.game}:${row.id}。`, 404);
    }
    cards.push(card);
  }
  return compareDocument(cards);
}

function attrLabel(key) {
  const row = ATTRS.find((item) => item[0] === key);
  if (!row) return tx("属性 / 职业", "Element / class", "属性 / 役割");
  return tx(row[1], row[2], row[3]);
}

function sectionLabel(section, key) {
  if (section === "attributes") return key === "attributes" ? tx("属性 / 职业", "Element / class", "属性 / 役割") : attrLabel(key);
  if (section === "rating") return tx("评级", "Rating", "評価");
  if (section === "teams") return tx("配队", "Teams", "編成");
  return tx("技能摘要", "Skill summary", "スキル要約");
}

function cellText(value) {
  if (value == null || value === "") return `<span class="gap">${esc(gapLabel())}</span>`;
  return esc(value);
}

function ratingCell(cell) {
  if (!cell || cell.empty || !cell.lines || !cell.lines.length) return `<span class="gap">${esc(gapLabel())}</span>`;
  const lines = cell.lines.map((line) => `<li>${esc(line)}</li>`).join("");
  const sources = (cell.sources || [])
    .map((url, index) => `<li><a href="${esc(url)}" rel="noopener noreferrer">${esc(tx(`出处 ${index + 1}`, `Source ${index + 1}`, `出典 ${index + 1}`))}</a></li>`)
    .join("");
  const asOf = cell.as_of ? `<p class="meta">as_of ${esc(cell.as_of)}</p>` : "";
  return `<ul>${lines}</ul>${sources ? `<ul class="srcs">${sources}</ul>` : `<p class="gap">${esc(tx("评级出处：", "Rating source: ", "評価の出典："))}${esc(gapLabel())}</p>`}${asOf}`;
}

function teamsCell(cell) {
  if (!cell || cell.empty || !cell.lines || !cell.lines.length) return `<span class="gap">${esc(gapLabel())}</span>`;
  return `<ul>${cell.lines.map((row) => `<li><span class="k">${esc(row.label)}</span> ${esc(row.text)}</li>`).join("")}</ul>`;
}

function skillsCell(cell) {
  if (!cell || cell.empty || !cell.lines || !cell.lines.length) return `<span class="gap">${esc(gapLabel())}</span>`;
  return `<ul>${cell.lines
    .map((row) => {
      const name = row.name || tx("未命名", "Untitled", "無題");
      const type = row.type ? ` <code>${esc(row.type)}</code>` : "";
      const summary = row.summary ? esc(row.summary) : `<span class="gap">${esc(gapLabel())}</span>`;
      return `<li><strong>${esc(name)}</strong>${type} — ${summary}</li>`;
    })
    .join("")}</ul>`;
}

function renderCell(section, value) {
  if (section === "rating") return ratingCell(value);
  if (section === "teams") return teamsCell(value);
  if (section === "skills") return skillsCell(value);
  return cellText(value);
}

export function renderCompare(doc) {
  if (!doc || doc.ok === false) {
    return `<h1>${esc(tx("角色对比", "Compare", "キャラ比較"))}</h1><p class="error">${esc(tx("无法对比这些角色。", "Could not compare these cards.", "このカードは比べられない。"))}</p>`;
  }
  const columns = doc.columns || [];
  const head = columns
    .map((column) => `<th scope="col">${esc(column.name)} <code>${esc(column.id || "")}</code><div><a href="${esc(characterHref(column.game, column.id))}">${esc(tx("角色页", "Character", "キャラ"))}</a></div></th>`)
    .join("");
  const body = (doc.rows || [])
    .map((row) => {
      const cells = (row.cells || []).map((cell) => `<td>${renderCell(row.section, cell)}</td>`).join("");
      return `<tr><th scope="row">${esc(sectionLabel(row.section, row.key))}</th>${cells}</tr>`;
    })
    .join("");
  const query = columns.map((column) => `${column.game}:${column.id}`).join(",");
  return `<h1>${esc(tx("角色对比", "Compare", "キャラ比較"))}</h1>
<p class="lede">${esc(tx(
    "并排只显示卡上已有的属性 / 职业、评级、配队和技能摘要。空的格子是「暂无出处」，不补。",
    "The columns show element or class, rating, teams, and skill summaries already on the card. An empty cell stays empty.",
    "並ぶのはカードにある属性・役割、評価、編成、スキル要約だけ。空欄は埋めない。"
  ))}</p>
<p class="meta"><a href="${esc(localizePath("/compare/"))}">${esc(tx("清空地址重新选", "Clear and choose again", "アドレスを消して選び直す"))}</a></p>
<div class="compare-wrap"><table class="compare"><thead><tr><th scope="col">${esc(tx("字段", "Field", "項目"))}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
<p class="meta">JSON：<a href="/v1/compare?ids=${esc(query)}"><code>/v1/compare?ids=${esc(query)}</code></a></p>`;
}

export function renderComparePrompt(state, note = "") {
  const parsed = parseCompareState(state);
  const items = parsed.ids.length
    ? `<ul>${parsed.ids.map((key) => `<li><code>${esc(key)}</code></li>`).join("")}</ul>`
    : `<p class="meta">${esc(tx("还没有加入对比的卡。", "No cards in the comparison yet.", "比較に入ったカードはまだない。"))}</p>`;
  return `<h1>${esc(tx("角色对比", "Compare", "キャラ比較"))}</h1>
<p class="lede">${esc(tx(
    "同一游戏选 2 到 4 张卡。从角色页点「加入对比」，或打开 /compare/?ids=game:id,game:id。",
    "Choose 2 to 4 cards from the same game. Use Add to compare on a character page, or open /compare/?ids=game:id,game:id.",
    "同じゲームから 2〜4 枚。キャラページの「比較に入れる」か /compare/?ids=game:id,game:id。"
  ))}</p>
${note ? `<p class="meta" role="status">${esc(note)}</p>` : ""}
${items}
<p class="rule">${esc(tx("不同游戏不能放在同一张表里。空字段保持「暂无出处」。", "Cards from different games do not share a table. Empty fields stay empty.", "別のゲームは同じ表に置かない。空欄は埋めない。"))}</p>`;
}
