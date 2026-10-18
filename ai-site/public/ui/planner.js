/**
 * Derived gacha timeline from published banners, calendar, and codes.
 * Dates are the YYYY-MM-DD prefix already stored on a row. Prose dates are
 * not parsed. A pull shortfall is computed only when that banner note states
 * 「首个 N 次征集内必得」. No other pity or rate is invented.
 */
import { displayGameName, localizePath, tx } from "./i18n.js";
import { esc, WATCH_ORDER } from "./render.js";

export const PLANNER_KEY = "game-intel.planner.v1";
export const MAX_WANTED = 48;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SUMMON_RULE = /首个\s*(\d+)\s*次征集内必得\s*([^。；\n]+)/;
const QUALITATIVE_RULES = [
  /与同类型保底共享/,
  /保底与同类共享/,
  /保底单独累积，活动结束后清零/,
  /保底单独累积，结束后清零/,
  /首次获得\s*6\s*星必为所选角色，仅限一次/,
];
const DEAD_CODE = new Set(["expired", "expiry_not_stated"]);

function fail(error, message, status = 400) {
  return { ok: false, error, message, status };
}

export function slug(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return SLUG.test(text) ? text : "";
}

function httpsUrl(value) {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(text) || /[\s<>"']/.test(text)) return "";
  return text;
}

function dayNumber(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/** ISO calendar day already written on the row. Offsets stay in that local day. */
export function sourcedDay(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$)/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Calendar days from today to day. Null when either side is not a sourced day. */
export function daysUntil(today, day) {
  const from = sourcedDay(today) || (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null);
  const to = sourcedDay(day);
  if (!from || !to) return null;
  return dayNumber(to) - dayNumber(from);
}

function quoteFrom(note, pattern) {
  const match = String(note || "").match(pattern);
  return match ? match[0] : "";
}

/**
 * A calculable rule is only the published sentence 「首个 N 次征集内必得 …」.
 * Other 保底 sentences are quoted and do not become a number.
 */
export function citedRule(banner) {
  if (!banner || typeof banner !== "object") return null;
  const source = httpsUrl(banner.source);
  const note = String(banner.note || "");
  if (!source || !note) return null;
  const summon = note.match(SUMMON_RULE);
  if (summon) {
    const pulls = Number(summon[1]);
    if (!Number.isInteger(pulls) || pulls <= 0 || pulls > 10000) return null;
    const also = QUALITATIVE_RULES.map((pattern) => quoteFrom(note, pattern)).filter(Boolean);
    return {
      calculable: true,
      pulls,
      unit: "次征集",
      guarantee: summon[2].trim(),
      quote: summon[0],
      also,
      source,
      kind: "stated_summons",
    };
  }
  const qualitative = QUALITATIVE_RULES.map((pattern) => quoteFrom(note, pattern)).filter(Boolean);
  if (!qualitative.length) return null;
  return {
    calculable: false,
    pulls: null,
    unit: null,
    guarantee: null,
    quote: qualitative[0],
    also: qualitative.slice(1),
    source,
    kind: "stated_without_count",
  };
}

export function shortfall(rule, have) {
  if (!rule || rule.calculable !== true || !Number.isInteger(rule.pulls)) return null;
  const base = {
    target: rule.pulls,
    unit: rule.unit,
    quote: rule.quote,
    source: rule.source,
    have: null,
    shortfall: null,
  };
  if (have == null || have === "") return base;
  if (!Number.isInteger(have) || have < 0 || have > 1000000) return base;
  return { ...base, have, shortfall: Math.max(0, rule.pulls - have) };
}

function textOrEmpty(value) {
  if (value == null) return "";
  return String(value);
}

function presentCharacter(row) {
  if (!row || typeof row !== "object") return null;
  const id = slug(row.id);
  if (!id) return null;
  const out = { id };
  if (row.name) out.name = String(row.name);
  if (row.label) out.label = String(row.label);
  return out;
}

function includeBanner(row, today) {
  if (!row || typeof row !== "object") return false;
  if (!httpsUrl(row.source)) return false;
  const status = String(row.status || "");
  if (status === "ended") return false;
  const start = sourcedDay(row.start);
  const end = sourcedDay(row.end);
  if (status === "current" || status === "upcoming") return true;
  if (end && end < today) return false;
  if (start && start > today) return true;
  if (start && start <= today && (!end || end >= today)) return true;
  if (!start && end && end >= today) return true;
  return false;
}

function presentBanner(game, row, today) {
  const start = sourcedDay(row.start);
  const end = sourcedDay(row.end);
  const rule = citedRule(row);
  const characters = (Array.isArray(row.up_characters) ? row.up_characters : [])
    .map(presentCharacter)
    .filter(Boolean);
  const out = {
    origin: "banners",
    game,
    id: row.id ? String(row.id) : "",
    name: row.name ? String(row.name) : "",
    kind: row.kind ? String(row.kind) : "",
    status: row.status ? String(row.status) : "",
    start,
    end,
    start_text: textOrEmpty(row.start_text),
    end_text: textOrEmpty(row.end_text),
    timezone: row.timezone ? String(row.timezone) : "",
    days_until_start: daysUntil(today, start),
    days_until_end: daysUntil(today, end),
    source: httpsUrl(row.source),
    as_of: row.as_of ? String(row.as_of) : "",
    note: row.note ? String(row.note) : "",
    up: Array.isArray(row.up) ? row.up.filter((item) => item != null && String(item).trim()).map(String) : [],
    up_characters: characters,
    cited_rule: rule,
    savings: null,
  };
  if (row.server) out.server = String(row.server);
  return out;
}

function bannerSort(a, b) {
  const rank = { current: 0, upcoming: 1 };
  const left = rank[a.status] ?? 2;
  const right = rank[b.status] ?? 2;
  if (left !== right) return left - right;
  const endA = a.end || "9999-99-99";
  const endB = b.end || "9999-99-99";
  if (endA !== endB) return endA < endB ? -1 : 1;
  const startA = a.start || "9999-99-99";
  const startB = b.start || "9999-99-99";
  if (startA !== startB) return startA < startB ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

function presentCode(game, row, today) {
  if (!row || typeof row !== "object") return null;
  const status = String(row.status || "");
  if (DEAD_CODE.has(status)) return null;
  const source = httpsUrl(row.source);
  if (!source || !row.code) return null;
  const expires = sourcedDay(row.expires);
  if (expires && expires < today) return null;
  return {
    game,
    code: String(row.code),
    rewards: row.rewards ? String(row.rewards) : "",
    status,
    expires,
    released: sourcedDay(row.released || row.starts || row.start),
    source,
    note: row.note ? String(row.note) : "",
    counted_as_pulls: false,
  };
}

function presentCalendar(event, today, bannerSources) {
  if (!event || event.type !== "banner") return null;
  const source = httpsUrl(event.url);
  if (!source || bannerSources.has(source)) return null;
  const month = event.precision === "month";
  const start = sourcedDay(event.start);
  const end = sourcedDay(event.end);
  if (!start && !end) return null;
  if (end && end < today) return null;
  if (!end && start && start < today) return null;
  const game = slug(event.game);
  if (!game) return null;
  return {
    origin: "calendar",
    game,
    id: event.id != null ? String(event.id) : "",
    name: event.name ? String(event.name) : "",
    title: event.title ? String(event.title) : "",
    status: start && start > today ? "upcoming" : "current",
    start,
    end,
    days_until_start: month ? null : daysUntil(today, start),
    days_until_end: month ? null : daysUntil(today, end),
    precision: month ? "month" : null,
    source,
    confidence: event.confidence ? String(event.confidence) : "",
    note: event.note ? String(event.note) : "",
    cited_rule: null,
    savings: null,
  };
}

function gameRank(id) {
  const index = WATCH_ORDER.findIndex((row) => row.id === id);
  return index === -1 ? 100 : index;
}

function gameMeta(id, guidesIndex) {
  const fromWatch = WATCH_ORDER.find((row) => row.id === id);
  const fromIndex = ((guidesIndex && guidesIndex.games) || []).find((row) => row && row.id === id);
  const name = (fromIndex && fromIndex.name) || (fromWatch && fromWatch.name) || id;
  const nameZh = (fromIndex && fromIndex.name_zh) || (fromWatch && fromWatch.name_zh) || "";
  return { id, name, name_zh: nameZh };
}

export function parseResourceQuery(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, resources: null, status: 200 };
  if (text.length > 800) return fail("bad_resources", "resources 太长。");
  const resources = {};
  for (const token of text.split(/[\s,，]+/).filter(Boolean)) {
    const match = token.toLowerCase().match(/^([a-z0-9][a-z0-9_-]{0,63}):(\d{1,7})$/);
    if (!match) return fail("bad_resources", "resources 需要是 game:非负整数，多项用逗号分隔。");
    const count = Number(match[2]);
    if (count > 1000000) return fail("bad_resources", "resources 里的数量太大。");
    resources[match[1]] = count;
  }
  return { ok: true, resources, status: 200 };
}

export function parseCount(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 1000000) return null;
    return value;
  }
  const text = String(value ?? "").trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  const count = Number(text);
  return count > 1000000 ? null : count;
}

export function emptyPlanner() {
  return { v: 1, wanted: [], resources: {} };
}

export function parsePlannerState(raw) {
  const state = emptyPlanner();
  if (!raw || typeof raw !== "object") return state;
  const seen = new Set();
  for (const row of Array.isArray(raw.wanted) ? raw.wanted : []) {
    const game = slug(row && row.game);
    const id = slug(row && row.id);
    if (!game || !id) continue;
    const key = `${game}:${id}`;
    if (seen.has(key) || state.wanted.length >= MAX_WANTED) continue;
    seen.add(key);
    const item = { game, id };
    if (row.name && String(row.name).trim()) item.name = String(row.name).trim().slice(0, 80);
    state.wanted.push(item);
  }
  const resources = raw.resources && typeof raw.resources === "object" ? raw.resources : {};
  for (const [game, value] of Object.entries(resources)) {
    const id = slug(game);
    const count = parseCount(value);
    if (!id || count == null) continue;
    state.resources[id] = count;
  }
  return state;
}

export function mergeWanted(state, rows) {
  const next = parsePlannerState(state);
  const seen = new Set(next.wanted.map((row) => `${row.game}:${row.id}`));
  let added = 0;
  for (const row of rows || []) {
    const game = slug(row && row.game);
    const id = slug(row && row.id);
    if (!game || !id) continue;
    const key = `${game}:${id}`;
    if (seen.has(key)) continue;
    if (next.wanted.length >= MAX_WANTED) break;
    seen.add(key);
    const item = { game, id };
    if (row.name && String(row.name).trim()) item.name = String(row.name).trim().slice(0, 80);
    next.wanted.push(item);
    added += 1;
  }
  return { state: next, added };
}

export function toggleWanted(state, game, id, name) {
  const next = parsePlannerState(state);
  const gid = slug(game);
  const cid = slug(id);
  if (!gid || !cid) return { ok: false, error: "bad_follow", state: next };
  const key = `${gid}:${cid}`;
  const exists = next.wanted.some((row) => `${row.game}:${row.id}` === key);
  if (exists) {
    next.wanted = next.wanted.filter((row) => `${row.game}:${row.id}` !== key);
    return { ok: true, state: next, on: false };
  }
  if (next.wanted.length >= MAX_WANTED) return { ok: false, error: "too_many_chars", state: next };
  const item = { game: gid, id: cid };
  if (name && String(name).trim()) item.name = String(name).trim().slice(0, 80);
  next.wanted.push(item);
  return { ok: true, state: next, on: true };
}

export function setResource(state, game, value) {
  const next = parsePlannerState(state);
  const gid = slug(game);
  if (!gid) return next;
  const text = String(value ?? "").trim();
  if (!text) {
    delete next.resources[gid];
    return next;
  }
  const count = parseCount(text);
  if (count == null) return next;
  next.resources[gid] = count;
  return next;
}

export function applyResources(doc, resources) {
  if (!doc || doc.ok === false) return doc;
  const map = resources && typeof resources === "object" ? resources : {};
  const games = (doc.games || []).map((game) => ({
    ...game,
    banners: (game.banners || []).map((banner) => ({
      ...banner,
      savings: shortfall(banner.cited_rule, Object.prototype.hasOwnProperty.call(map, game.game) ? map[game.game] : null),
    })),
  }));
  return { ...doc, games, resources_applied: true, stored: false };
}

export function wantedPlan(doc, state) {
  const parsed = parsePlannerState(state);
  return parsed.wanted.map((item) => {
    const game = (doc && doc.games || []).find((row) => row.game === item.game) || null;
    const banners = game
      ? game.banners.filter((banner) => (banner.up_characters || []).some((character) => character.id === item.id))
      : [];
    return {
      ...item,
      timeline_only: game ? game.timeline_only !== false && banners.every((banner) => !banner.cited_rule || banner.cited_rule.calculable !== true) : true,
      banners,
    };
  });
}

export function buildPlanner({ guidesIndex, bannersByGame, codesByGame, calendar, today, resources } = {}) {
  const day = sourcedDay(today) || sourcedDay(String(today || ""));
  if (!day) return fail("bad_today", "today 需要是 YYYY-MM-DD。");
  const ids = new Set();
  for (const row of (guidesIndex && guidesIndex.games) || []) {
    const id = slug(row && row.id);
    if (id) ids.add(id);
  }
  for (const event of (calendar && calendar.events) || []) {
    const id = slug(event && event.game);
    if (id) ids.add(id);
  }
  for (const id of Object.keys(bannersByGame || {})) {
    if (slug(id)) ids.add(slug(id));
  }
  const games = [...ids].sort((a, b) => gameRank(a) - gameRank(b) || a.localeCompare(b)).map((id) => {
    const meta = gameMeta(id, guidesIndex);
    const bannerDoc = bannersByGame && bannersByGame[id];
    const banners = ((bannerDoc && bannerDoc.banners) || [])
      .filter((row) => includeBanner(row, day))
      .map((row) => presentBanner(id, row, day))
      .sort(bannerSort);
    const sources = new Set(banners.map((row) => row.source));
    const calendarRows = ((calendar && calendar.events) || [])
      .filter((event) => slug(event && event.game) === id)
      .map((event) => presentCalendar(event, day, sources))
      .filter(Boolean)
      .sort(bannerSort);
    const codes = (((codesByGame && codesByGame[id]) || {}).codes || [])
      .map((row) => presentCode(id, row, day))
      .filter(Boolean);
    const calculable = banners.some((row) => row.cited_rule && row.cited_rule.calculable === true);
    return {
      ...meta,
      game: id,
      timeline_only: !calculable,
      pull_math: calculable ? "cited_summons" : "timeline_only",
      banners,
      calendar: calendarRows,
      codes,
    };
  }).filter((game) => game.banners.length || game.calendar.length || game.codes.length);

  const doc = {
    ok: true,
    derived: true,
    stored: false,
    today: day,
    timezone: "Asia/Shanghai",
    day_basis:
      "Days use the YYYY-MM-DD prefix stored on the row, minus Asia/Shanghai today. Offsets are not rewritten. Prose dates are not parsed.",
    pull_math:
      "shortfall is set only when that banner note states 首个 N 次征集内必得. Other games stay on the timeline. Code rewards are not converted into pulls.",
    games,
  };
  if (resources && typeof resources === "object") return applyResources(doc, resources);
  return doc;
}

export async function assemblePlanner(readJson, { today, game = "", resources = null } = {}) {
  const filter = String(game || "").trim();
  if (filter && !slug(filter)) return fail("bad_game", "game 需要是小写 slug。");
  const guidesIndex = (await readJson("/v1/guides/index.json")) || { games: [] };
  const calendar = (await readJson("/v1/calendar.json")) || { events: [] };
  const ids = new Set();
  for (const row of guidesIndex.games || []) {
    const id = slug(row && row.id);
    if (id) ids.add(id);
  }
  for (const event of calendar.events || []) {
    const id = slug(event && event.game);
    if (id) ids.add(id);
  }
  const selected = filter ? [slug(filter)] : [...ids];
  const bannersByGame = {};
  const codesByGame = {};
  for (const id of selected) {
    bannersByGame[id] = await readJson(`/v1/guides/${id}/banners.json`);
    codesByGame[id] = await readJson(`/v1/guides/${id}/codes.json`);
  }
  const scopedIndex = filter
    ? { ...guidesIndex, games: (guidesIndex.games || []).filter((row) => row && row.id === filter) }
    : guidesIndex;
  const scopedCalendar = filter
    ? { ...calendar, events: (calendar.events || []).filter((event) => slug(event && event.game) === filter) }
    : calendar;
  return buildPlanner({
    guidesIndex: scopedIndex,
    bannersByGame,
    codesByGame,
    calendar: scopedCalendar,
    today,
    resources: resources || undefined,
  });
}

function gameLabel(game) {
  return displayGameName(game) || game.name_zh || game.name || game.game || game.id || "";
}

function dayPhrase(kind, days) {
  if (days == null) return "";
  if (kind === "end") {
    if (days > 0) return tx(`离开卡池还有 ${days} 天`, `${days} days until the banner leaves`, `終了まであと ${days} 日`);
    if (days === 0) return tx("出处上的结束日是今天", "The sourced end date is today", "出典の終了日は今日");
    return tx(`出处上的结束日已过 ${-days} 天`, `The sourced end date was ${-days} days ago`, `出典の終了日から ${-days} 日`);
  }
  if (days > 0) return tx(`还有 ${days} 天开池`, `${days} days until it starts`, `開始まであと ${days} 日`);
  if (days === 0) return tx("出处上的开始日是今天", "The sourced start date is today", "出典の開始日は今日");
  return tx(`出处上的开始日已过 ${-days} 天`, `The sourced start date was ${-days} days ago`, `出典の開始日から ${-days} 日`);
}

function whenLine(row) {
  const bits = [];
  const start = row.start_text || row.start || "";
  const end = row.end_text || row.end || "";
  if (start || end) bits.push([start, end].filter(Boolean).join(" → "));
  if (!row.start && row.start_text) bits.push(tx("开始日没有写成可计算的日期", "The start is not a calculable date", "開始日は計算できる日付ではない"));
  if (!row.end && (row.end_text || row.status === "current" || row.status === "upcoming")) {
    bits.push(tx("结束日没有写成可计算的日期", "The end is not a calculable date", "終了日は計算できる日付ではない"));
  }
  if (row.precision === "month") bits.push(tx("出处只精确到月，不计算天数", "The source is only precise to the month, so no day count", "出典は月まで。日数は出さない"));
  if (row.timezone) bits.push(row.timezone);
  const leave = dayPhrase("end", row.days_until_end);
  const open = dayPhrase("start", row.days_until_start);
  if (open) bits.push(open);
  if (leave) bits.push(leave);
  return bits.filter(Boolean).join(" · ");
}

function ruleLine(rule, savings) {
  if (!rule) {
    return `<p class="meta">${esc(tx(
      "这张卡池没有写明抽数或保底次数，只显示时间线。",
      "This banner does not state a pull count or pity, so only the timeline is shown.",
      "このガチャに回数や天井の記載はない。時間だけを出す。"
    ))}</p>`;
  }
  const quote = `<q>${esc(rule.quote)}</q>`;
  const source = rule.source
    ? ` <a href="${esc(rule.source)}" rel="noopener noreferrer">${esc(tx("规则出处", "Rule source", "規則の出典"))}</a>`
    : "";
  if (!rule.calculable) {
    return `<p class="rule">${esc(tx("出处写了规则，但没有次数，不算差额。", "The source states a rule and no count, so there is no shortfall.", "出典に規則はあるが回数はない。差は出さない。"))} ${quote}${source}</p>`;
  }
  const also = (rule.also || []).length
    ? `<span class="meta"> ${esc(tx("同一句里还有：", "The same note also says: ", "同じ注記："))}${esc(rule.also.join("；"))}</span>`
    : "";
  let math = `<p class="meta">${esc(tx(
    `按出处，目标是 ${rule.pulls} ${rule.unit}（${rule.guarantee}）。填的数量若不是「${rule.unit}」，这个差不成立。`,
    `The source target is ${rule.pulls} ${rule.unit} (${rule.guarantee}). The gap only holds if your number uses that same unit.`,
    `出典の目標は ${rule.pulls} ${rule.unit}（${rule.guarantee}）。入力の単位が同じときだけ差が成り立つ。`
  ))}</p>`;
  if (savings && savings.have != null && savings.shortfall != null) {
    math += `<p class="savings">${esc(tx(
      `已填 ${savings.have} ${savings.unit}，还差 ${savings.shortfall}。`,
      `Entered ${savings.have} ${savings.unit}; ${savings.shortfall} short.`,
      `入力 ${savings.have} ${savings.unit}、あと ${savings.shortfall}。`
    ))}</p>`;
  }
  return `<p class="rule">${quote}${source}${also}</p>${math}`;
}

function characterChecks(banner, wanted) {
  const keyed = new Set((wanted || []).map((row) => `${row.game}:${row.id}`));
  const boxes = (banner.up_characters || []).map((character) => {
    const key = `${banner.game}:${character.id}`;
    const on = keyed.has(key);
    const name = character.name || character.label || character.id;
    return `<label class="check"><input type="checkbox" data-planner-toggle="1" data-game="${esc(banner.game)}" data-id="${esc(character.id)}" data-name="${esc(name)}"${on ? " checked" : ""}/> ${esc(name)} <code>${esc(character.id)}</code></label>`;
  });
  const unnamed = (banner.up || []).filter((name) => {
    return !(banner.up_characters || []).some((character) => character.name === name || character.label === name);
  });
  const extra = unnamed.length
    ? `<p class="meta">${esc(tx("公告里的名字，没有角色 id，不能勾进规划：", "Names in the notice have no character id, so they cannot be planned:", "告知の名前に id がなく、計画に入れられない："))} ${esc(unnamed.join("、"))}</p>`
    : "";
  return `${boxes.length ? `<div class="checks">${boxes.join("")}</div>` : ""}${extra}`;
}

function bannerArticle(banner, wanted) {
  const status = banner.status
    ? `<span class="flag ${banner.status === "current" ? "deep" : "gap"}">${esc(banner.status)}</span>`
    : "";
  const server = banner.server ? ` <span class="tag">${esc(banner.server)}</span>` : "";
  return `<article class="planner-banner">
<h3>${esc(banner.name || banner.id || tx("卡池", "Banner", "ガチャ"))} ${status}${server}</h3>
<p class="meta">${esc(whenLine(banner))}</p>
${banner.source ? `<p><a href="${esc(banner.source)}" rel="noopener noreferrer">${esc(tx("卡池出处", "Banner source", "ガチャの出典"))}</a></p>` : ""}
${characterChecks(banner, wanted)}
${ruleLine(banner.cited_rule, banner.savings)}
</article>`;
}

function calendarArticle(row) {
  return `<article class="planner-banner">
<h3>${esc(row.title || row.name || tx("日程", "Calendar", "日程"))} <span class="flag gap">calendar</span></h3>
<p class="meta">${esc(whenLine(row))}</p>
${row.note ? `<p>${esc(row.note)}</p>` : ""}
<p><a href="${esc(row.source)}" rel="noopener noreferrer">${esc(tx("日程出处", "Calendar source", "日程の出典"))}</a></p>
<p class="meta">${esc(tx("这是 calendar 里的 banner 条目，没有接上角色 id。", "This calendar banner has no character id attached.", "この日程の banner にキャラ id はない。"))}</p>
</article>`;
}

function codeList(codes) {
  if (!codes.length) return `<p class="meta">${esc(tx("没有未过期、且写了出处的兑换码。", "No unexpired code with a source.", "期限内で出典のあるコードはない。"))}</p>`;
  return `<ul class="planner-codes">${codes
    .map((row) => `<li><code>${esc(row.code)}</code> <span class="tag">${esc(row.status || tx("未标状态", "no status", "状態なし"))}</span><div>${esc(row.rewards || tx("出处未写奖励", "The source does not list a reward", "出典に報酬の記載なし"))}</div><div class="meta">${row.expires ? esc(row.expires) : esc(tx("没有可计算的到期日", "No calculable expiry", "計算できる期限はない"))} · <a href="${esc(row.source)}" rel="noopener noreferrer">${esc(tx("出处", "Source", "出典"))}</a></div></li>`)
    .join("")}</ul>`;
}

function resourceField(game, state) {
  const value = Object.prototype.hasOwnProperty.call(state.resources, game.game) ? String(state.resources[game.game]) : "";
  const label = game.timeline_only
    ? tx(
        "当前资源数量（只保存在这台浏览器。本游戏没有写明抽数，不计算差额）",
        "Current resources (this browser only). This game states no pull count, so no shortfall is calculated.",
        "現在の資源（このブラウザだけ）。このゲームに回数の記載はなく、差は出さない。"
      )
    : tx(
        "当前「次征集」数量（只保存在这台浏览器。单位必须和出处一致）",
        "Current summon count (this browser only). The unit must match the source.",
        "現在の「次征集」数（このブラウザだけ）。単位は出典と揃える。"
      );
  return `<label class="resource">${esc(label)} <input id="resource-${esc(game.game)}" data-planner-resource="${esc(game.game)}" inputmode="numeric" pattern="[0-9]*" value="${esc(value)}"/></label>`;
}

function wantedSection(doc, state) {
  const rows = wantedPlan(doc, state);
  if (!rows.length) {
    return `<p class="meta">${esc(tx("还没有勾选想抽的角色。", "No characters selected yet.", "まだキャラを選んでいない。"))}</p>`;
  }
  return `<ul class="follow-list">${rows
    .map((row) => {
      const name = row.name || row.id;
      const hits = row.banners.length
        ? row.banners
            .map((banner) => {
              const leave = dayPhrase("end", banner.days_until_end) || tx("没有可计算的结束日", "No calculable end date", "計算できる終了日はない");
              const gap = banner.savings && banner.savings.shortfall != null
                ? tx(`还差 ${banner.savings.shortfall} ${banner.savings.unit}`, `${banner.savings.shortfall} ${banner.savings.unit} short`, `あと ${banner.savings.shortfall} ${banner.savings.unit}`)
                : tx("不计算攒取数量", "No savings figure", "貯蓄数は出さない");
              return `${banner.name || banner.id} · ${leave} · ${gap}`;
            })
            .join("；")
        : tx("当前和未来卡池没有对上这个角色。", "No current or future banner lists this character.", "現行・今後のガチャにこのキャラはない。");
      return `<li><strong>${esc(name)}</strong> <code>${esc(`${row.game}:${row.id}`)}</code><div class="meta">${esc(hits)}</div> <button type="button" class="action" data-planner-toggle="1" data-game="${esc(row.game)}" data-id="${esc(row.id)}">${esc(tx("移出规划", "Remove", "外す"))}</button></li>`;
    })
    .join("")}</ul>`;
}

function followImport(follows, state) {
  const chars = (follows && follows.chars) || [];
  if (!chars.length) {
    return `<p class="meta">${esc(tx(
      "这台浏览器还没有关注角色。可以先到角色页点关注，再回到这里一键加入。",
      "This browser is not following any characters yet. Follow one on a character page, then add it here.",
      "このブラウザはまだキャラをフォローしていない。キャラページでフォローしてからここに入れる。"
    ))} <a href="${esc(localizePath("/me/"))}">${esc(tx("我的关注", "Following", "フォロー"))}</a></p>`;
  }
  const have = new Set(state.wanted.map((row) => `${row.game}:${row.id}`));
  const pending = chars.filter((row) => row && !have.has(`${row.game}:${row.id}`));
  return `<p><button type="button" class="action" data-planner-action="add-follows">${esc(tx(
    "把关注的角色加入规划",
    "Add followed characters to the plan",
    "フォロー中のキャラを計画に入れる"
  ))}</button> <a href="${esc(localizePath("/me/"))}">${esc(tx("打开我的关注", "Open Following", "フォローを開く"))}</a></p>${
    pending.length
      ? `<p class="meta">${esc(tx(`还有 ${pending.length} 名关注角色不在规划里。`, `${pending.length} followed characters are not in the plan.`, `フォロー中 ${pending.length} 名が計画にいない。`))}</p>`
      : `<p class="meta">${esc(tx("关注的角色都已经在规划里。", "Every followed character is already in the plan.", "フォロー中のキャラはすべて計画にある。"))}</p>`
  }`;
}

export function renderPlanner(doc, opts = {}) {
  if (!doc || doc.ok === false) {
    return `<h1>${esc(tx("抽卡规划", "Pull planner", "ガチャ計画"))}</h1><p class="error">${esc((opts && opts.message) || tx("无法整理卡池时间线", "Could not build the banner timeline", "ガチャの時間をまとめられない"))}</p>`;
  }
  const state = parsePlannerState(opts.state);
  const viewed = applyResources(doc, state.resources);
  const games = viewed.games || [];
  const body = games.length
    ? games
        .map((game) => {
          const label = gameLabel(game);
          const mode = game.timeline_only
            ? tx("只显示时间线。卡池规则没有写明可计算的抽数。", "Timeline only. The banner notes do not state a calculable pull count.", "時間だけ。ガチャ注記に計算できる回数はない。")
            : tx("部分卡池写了「次征集」次数，只按那句计算。", "Some banners state a summon count. Only that sentence is calculated.", "一部のガチャに回数の記載がある。その文だけを計算する。");
          return `<section class="planner-game"><h2>${esc(label)} <code>${esc(game.game)}</code></h2><p class="rule">${esc(mode)}</p>${resourceField(game, state)}${(game.banners || []).map((banner) => bannerArticle(banner, state.wanted)).join("") || `<p class="meta">${esc(tx("没有当前或未来的卡池。", "No current or future banner.", "現行・今後のガチャはない。"))}</p>`}<h3>${esc(tx("日程里的卡池", "Calendar banners", "日程のガチャ"))}</h3>${(game.calendar || []).map(calendarArticle).join("") || `<p class="meta">${esc(tx("没有未结束的 calendar banner。", "No open calendar banner.", "終わっていない calendar banner はない。"))}</p>`}<h3>${esc(tx("兑换码里写明的奖励", "Rewards written on redeem codes", "引き換えコードに書かれた報酬"))}</h3><p class="meta">${esc(tx("奖励原文照列，不换算成抽数。", "Rewards are quoted. They are not converted into pulls.", "報酬は原文のまま。回数には換算しない。"))}</p>${codeList(game.codes || [])}</section>`;
        })
        .join("")
    : `<p class="meta">${esc(tx("已发布的卡池、日程和兑换码里没有可展示的当前或未来条目。", "Published banners, calendar, and codes have no current or future rows to show.", "公開データに、出す現行・今後の行はない。"))}</p>`;
  return `<h1>${esc(tx("抽卡规划", "Pull planner", "ガチャ計画"))}</h1>
<p class="lede">${esc(tx(
    "按已发布的 banners、calendar、codes 排当前和未来卡池。日期只用 JSON 里已有的 YYYY-MM-DD。不编造保底或概率。",
    "Current and future banners come from published banners, calendar, and codes. Dates are YYYY-MM-DD values already in the JSON. Pity and rates are not invented.",
    "現行と今後のガチャは公開済みの banners、calendar、codes から。日付は JSON にある YYYY-MM-DD だけ。天井や確率は作らない。"
  ))}</p>
<p class="meta">${esc(tx(`上海日期 ${viewed.today}。名单和资源数量只留在这台浏览器，不会发给 /v1/planner。`, `Shanghai date ${viewed.today}. The list and resource counts stay in this browser and are not sent to /v1/planner.`, `上海の日付 ${viewed.today}。リストと資源数はこのブラウザだけ。/v1/planner には送らない。`))}</p>
${opts.note ? `<p class="meta" id="planner-status" role="status">${esc(opts.note)}</p>` : `<p class="meta" id="planner-status" role="status"></p>`}
${followImport(opts.follows, state)}
<section><h2>${esc(tx("想抽的角色", "Characters to pull", "引きたいキャラ"))}</h2>${wantedSection(viewed, state)}</section>
<form id="planner-form">${body}</form>
<p class="meta">JSON：<a href="/v1/planner"><code>/v1/planner</code></a></p>`;
}
