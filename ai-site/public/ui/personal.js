/**
 * Stateless personal filter over published feed, digest, banners, and codes.
 * No account, no storage. The same function serves the page, /v1/personal, and MCP.
 */
export const MAX_GAMES = 24;
export const MAX_CHARS = 48;
export const EXPIRING_DAYS = 21;
export const NEW_CODE_DAYS = 45;
export const CODE_PREFIX = "gi1.";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TEXT = 1800;
const NIKKE_ALIAS_PARTS = [1, 2, 3, 4];
const STATUS_RANK = { current: 0, upcoming: 1, ended: 2 };

export function shanghaiToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function calendarDay(value) {
  const s = String(value ?? "").trim();
  const match = s.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/
  );
  if (!match) return "";
  if (!match[2]) return match[1];
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) return match[1];
  return shanghaiToday(new Date(parsed));
}

function dayNumber(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

function fail(error) {
  return { ok: false, error, status: 400 };
}

function tokens(value) {
  if (Array.isArray(value)) return value.flatMap((item) => tokens(item));
  if (value && typeof value === "object") {
    if (value.game && value.id) return [`${value.game}:${value.id}`];
    return [];
  }
  return String(value ?? "")
    .split(/[\s,，]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitChar(token) {
  const match = String(token || "")
    .trim()
    .toLowerCase()
    .match(/^([a-z0-9][a-z0-9_-]{0,63})[:/]([a-z0-9][a-z0-9_-]{0,63})$/);
  if (!match || !SLUG.test(match[1]) || !SLUG.test(match[2])) return null;
  return { game: match[1], id: match[2] };
}

export function parseFollows(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  if (typeof source.code === "string" && source.code.trim()) {
    return decodeShareCode(source.code);
  }
  const gamesText = Array.isArray(source.games) ? source.games.join(",") : String(source.games ?? "");
  const charsText = Array.isArray(source.chars) ? JSON.stringify(source.chars) : String(source.chars ?? "");
  if (gamesText.length > MAX_TEXT || charsText.length > MAX_TEXT) return fail("bad_follow");

  const games = [];
  for (const token of tokens(source.games)) {
    const id = token.toLowerCase();
    if (!SLUG.test(id)) return fail("bad_follow");
    if (!games.includes(id)) games.push(id);
  }
  if (games.length > MAX_GAMES) return fail("too_many_games");

  const chars = [];
  const seen = new Set();
  for (const token of tokens(source.chars)) {
    const row = splitChar(token);
    if (!row) return fail("bad_follow");
    const key = `${row.game}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chars.push(row);
  }
  if (chars.length > MAX_CHARS) return fail("too_many_chars");
  return { ok: true, follows: { games, chars }, status: 200 };
}

export function canonicalQuery(follows) {
  const parsed = follows && follows.games && follows.chars ? { ok: true, follows } : parseFollows(follows);
  if (!parsed.ok) return "";
  const parts = [];
  if (parsed.follows.games.length) {
    parts.push(`games=${[...parsed.follows.games].sort().join(",")}`);
  }
  if (parsed.follows.chars.length) {
    parts.push(
      `chars=${parsed.follows.chars
        .map((row) => `${row.game}:${row.id}`)
        .sort()
        .join(",")}`
    );
  }
  return parts.join("&");
}

function bytesToB64Url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(text) {
  const pad = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeShareCode(follows) {
  const parsed = follows && follows.games && follows.chars ? { ok: true, follows } : parseFollows(follows);
  if (!parsed.ok) return "";
  const query = canonicalQuery(parsed.follows);
  if (!query) return "";
  return CODE_PREFIX + bytesToB64Url(new TextEncoder().encode(query));
}

export function decodeShareCode(code) {
  const raw = String(code ?? "").trim();
  const body = raw.startsWith(CODE_PREFIX)
    ? raw.slice(CODE_PREFIX.length)
    : raw.startsWith("gi1:")
      ? raw.slice(4)
      : "";
  if (!body || !/^[A-Za-z0-9_-]+$/.test(body) || body.length > 4000) return fail("bad_code");
  let text = "";
  try {
    text = new TextDecoder().decode(b64UrlToBytes(body));
  } catch {
    return fail("bad_code");
  }
  if (text.length > MAX_TEXT || (!/(^|&)games=/.test(text) && !/(^|&)chars=/.test(text))) return fail("bad_code");
  const params = new URLSearchParams(text);
  return parseFollows({ games: params.get("games") || "", chars: params.get("chars") || "" });
}

export function importFollowText(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return fail("empty");
  if (text.length > 4000) return fail("bad_follow");
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) {
    try {
      const url = new URL(text, "https://game-intel.local");
      return parseFollows({
        games: url.searchParams.get("games") || "",
        chars: url.searchParams.get("chars") || "",
        code: url.searchParams.get("code") || "",
      });
    } catch {
      return fail("bad_follow");
    }
  }
  if (text.startsWith(CODE_PREFIX) || text.startsWith("gi1:")) return decodeShareCode(text);
  if (text.includes("=")) {
    const params = new URLSearchParams(text.replace(/^[?#]/, ""));
    return parseFollows({
      games: params.get("games") || "",
      chars: params.get("chars") || "",
      code: params.get("code") || "",
    });
  }
  if (text.includes(":") || text.includes("/")) return parseFollows({ chars: text });
  return parseFollows({ games: text });
}

export function toggleFollow(follows, kind, game, id) {
  const parsed = parseFollows(follows && follows.games ? follows : follows || {});
  if (!parsed.ok) return parsed;
  const next = {
    games: [...parsed.follows.games],
    chars: parsed.follows.chars.map((row) => ({ ...row })),
  };
  if (kind === "game") {
    const gid = String(game || "").trim().toLowerCase();
    if (!SLUG.test(gid)) return fail("bad_follow");
    if (next.games.includes(gid)) next.games = next.games.filter((item) => item !== gid);
    else if (next.games.length >= MAX_GAMES) return fail("too_many_games");
    else next.games.push(gid);
    return { ok: true, follows: next, status: 200 };
  }
  const row = splitChar(`${game}:${id}`);
  if (!row) return fail("bad_follow");
  const key = `${row.game}:${row.id}`;
  const exists = next.chars.some((item) => `${item.game}:${item.id}` === key);
  if (exists) next.chars = next.chars.filter((item) => `${item.game}:${item.id}` !== key);
  else if (next.chars.length >= MAX_CHARS) return fail("too_many_chars");
  else next.chars.push(row);
  return { ok: true, follows: next, status: 200 };
}

function addName(set, value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if ([...text].length >= 2) set.add(text);
}

export function namesFromIndexAndAliases(id, indexDoc, aliasDocs) {
  const rows = (indexDoc && indexDoc.characters) || [];
  const row = rows.find((item) => item && item.id === id) || null;
  const names = new Set();
  if (row) {
    addName(names, row.name_zh);
    addName(names, row.name);
  }
  if (id.length >= 4) addName(names, id);
  for (const doc of aliasDocs || []) {
    const aliases = doc && doc.aliases;
    if (!aliases || typeof aliases !== "object") continue;
    for (const [key, entry] of Object.entries(aliases)) {
      if (!entry || entry.id !== id) continue;
      if (entry.kind && entry.kind !== "character") continue;
      addName(names, key);
      addName(names, entry.name);
    }
  }
  const aliases = [...names].sort((a, b) => [...b].length - [...a].length).slice(0, 24);
  return {
    name: (row && row.name) || "",
    name_zh: (row && row.name_zh) || "",
    aliases,
  };
}

export async function assemblePersonal(follows, readJson, today) {
  const feed = await readJson("/v1/feed.json");
  const digest = await readJson("/v1/digest.json");
  const games = new Set(follows.games);
  for (const row of follows.chars) games.add(row.game);
  const bannersByGame = {};
  const codesByGame = {};
  for (const game of games) {
    bannersByGame[game] = await readJson(`/v1/guides/${game}/banners.json`);
    codesByGame[game] = await readJson(`/v1/guides/${game}/codes.json`);
  }
  const namesByKey = {};
  const charGames = [...new Set(follows.chars.map((row) => row.game))];
  for (const game of charGames) {
    const index = await readJson(`/v1/guides/${game}/index.json`);
    const aliasDocs = [];
    const main = await readJson(`/v1/guides/${game}/aliases.json`);
    if (main) aliasDocs.push(main);
    if (game === "nikke") {
      for (const part of NIKKE_ALIAS_PARTS) {
        const doc = await readJson(`/v1/guides/nikke/aliases.p${part}.json`);
        if (doc) aliasDocs.push(doc);
      }
    }
    for (const row of follows.chars) {
      if (row.game !== game) continue;
      namesByKey[`${row.game}:${row.id}`] = namesFromIndexAndAliases(row.id, index, aliasDocs);
    }
  }
  return buildPersonal({
    follows,
    feed,
    digest,
    bannersByGame,
    codesByGame,
    namesByKey,
    today: today || shanghaiToday(),
  });
}

function safeUrl(url) {
  const text = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  if (/[\s<>"']/.test(text)) return "";
  return text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text, needles) {
  const hay = String(text || "");
  if (!hay) return false;
  for (const needle of needles || []) {
    const name = String(needle || "").trim();
    if ([...name].length < 2) continue;
    if (/^[a-z0-9][a-z0-9 .:'+-]*$/i.test(name)) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}([^a-z0-9]|$)`, "i");
      if (pattern.test(hay)) return true;
      continue;
    }
    if (hay.includes(name)) return true;
  }
  return false;
}

function itemText(item) {
  return [item && item.title, item && item.summary, item && item.why].filter(Boolean).join("\n");
}

function needlesFor(row, namesByKey) {
  const info = namesByKey[`${row.game}:${row.id}`] || {};
  return info.aliases || [];
}

function keepText(game, item, follows, namesByKey) {
  if (game && follows.games.includes(game)) return true;
  const pool = game ? follows.chars.filter((row) => row.game === game) : follows.chars;
  if (!pool.length) return false;
  const text = itemText(item);
  return pool.some((row) => mentions(text, needlesFor(row, namesByKey)));
}

function presentItem(item, game) {
  const url = safeUrl(item.url);
  if (!url || !item.title) return null;
  const out = {
    title: String(item.title),
    url,
    game_id: game || null,
    source: item.source ? String(item.source) : "",
  };
  if (item.platform) out.platform = String(item.platform);
  if (item.published_at) out.published_at = item.published_at;
  if (item.summary) out.summary = String(item.summary);
  if (typeof item.is_new === "boolean") out.is_new = item.is_new;
  if (item.why) out.why = String(item.why);
  return out;
}

function rerunIndex(text) {
  const match = /复刻|復刻|rerun/i.exec(String(text || ""));
  return match ? match.index : -1;
}

function bannerMark(row, char, info) {
  if (row.kind === "rerun") return "rerun";
  const up = (row.up_characters || []).find((item) => item && item.id === char.id) || {};
  const own = [up.label, up.costume, up.name].filter(Boolean).join(" ");
  if (/复刻|復刻|\brerun\b/i.test(own)) return "rerun";
  const title = String(row.name || "");
  const index = rerunIndex(title);
  if (index >= 0) {
    const after = title.slice(index);
    const names = [info.name_zh, info.name, up.name, up.label].filter((name) => name && [...String(name)].length >= 2);
    if (names.some((name) => after.includes(name))) return "rerun";
  }
  return "up";
}

function presentBanner(game, row, matched) {
  const out = {
    game,
    id: row.id ? String(row.id) : "",
    name: row.name ? String(row.name) : "",
    kind: row.kind ? String(row.kind) : "",
    status: row.status ? String(row.status) : "",
    up: Array.isArray(row.up) ? row.up.filter(Boolean).map(String) : [],
    matched,
    marks: [...new Set(matched.map((item) => item.mark))],
  };
  for (const key of ["start", "end", "start_text", "end_text", "timezone", "as_of", "note"]) {
    if (row[key]) out[key] = String(row[key]);
  }
  const source = safeUrl(row.source);
  if (source) out.source = source;
  return out;
}

function judgeCode(row, today) {
  const expires = calendarDay(row && row.expires);
  const start = calendarDay((row && (row.starts || row.released || row.start)) || "");
  const status = String((row && row.status) || "");
  const expired = status === "expired" || Boolean(expires && expires < today);
  const marks = [];
  let daysLeft = null;
  if (expires) daysLeft = dayNumber(expires) - dayNumber(today);
  if (expired) {
    marks.push("expired");
    return { marks, daysLeft };
  }
  if (daysLeft != null && daysLeft >= 0 && daysLeft <= EXPIRING_DAYS) marks.push("expiring");
  if (start) {
    const age = dayNumber(today) - dayNumber(start);
    if (age >= 0 && age <= NEW_CODE_DAYS) marks.push("new");
  }
  return { marks, daysLeft };
}

function presentCode(game, row, today) {
  const judged = judgeCode(row, today);
  const out = {
    game,
    code: row.code ? String(row.code) : "",
    rewards: row.rewards ? String(row.rewards) : "",
    status: row.status ? String(row.status) : "",
    marks: judged.marks,
  };
  if (judged.daysLeft != null) out.days_left = judged.daysLeft;
  for (const key of ["expires", "expires_text", "timezone", "note", "checked"]) {
    if (row[key]) out[key] = String(row[key]);
  }
  const source = safeUrl(row.source);
  if (source) out.source = source;
  return out;
}

function codeRank(row) {
  if (row.marks.includes("expiring")) return 0;
  if (row.marks.includes("new")) return 1;
  if (row.marks.includes("expired")) return 3;
  return 2;
}

function gameLabel(digest, game) {
  const rows = (digest && digest.digests) || [];
  const row = rows.find((item) => item && item.game === game);
  return (row && (row.name_zh || row.name)) || game;
}

export function buildPersonal({
  follows,
  feed,
  digest,
  bannersByGame = {},
  codesByGame = {},
  namesByKey = {},
  today,
} = {}) {
  const parsed = parseFollows(follows || {});
  if (!parsed.ok) return parsed;
  const list = parsed.follows;
  const day = today || shanghaiToday();
  const missing = [];
  if (!feed) missing.push("feed");
  if (!digest) missing.push("digest");

  const feedItems = [];
  for (const item of (feed && feed.items) || []) {
    const game = typeof item.game_id === "string" ? item.game_id : "";
    if (!keepText(game, item, list, namesByKey)) continue;
    const presented = presentItem(item, game);
    if (presented) feedItems.push(presented);
  }

  const digests = [];
  for (const row of (digest && digest.digests) || []) {
    const game = row && typeof row.game === "string" ? row.game : "";
    if (!game) continue;
    const interested = list.games.includes(game) || list.chars.some((item) => item.game === game);
    if (!interested) continue;
    const items = [];
    for (const item of row.items || []) {
      if (!keepText(game, item, list, namesByKey)) continue;
      const presented = presentItem(item, game);
      if (presented) items.push(presented);
    }
    if (!list.games.includes(game) && !items.length) continue;
    digests.push({
      game,
      name: row.name ? String(row.name) : "",
      name_zh: row.name_zh ? String(row.name_zh) : "",
      ok: row.ok !== false,
      count: items.length,
      items,
    });
  }

  const banners = [];
  for (const [game, doc] of Object.entries(bannersByGame)) {
    if (!doc) {
      missing.push(`banners:${game}`);
      continue;
    }
    const gameFollowed = list.games.includes(game);
    const chars = list.chars.filter((item) => item.game === game);
    for (const row of doc.banners || []) {
      const matched = [];
      for (const char of chars) {
        const up = (row.up_characters || []).find((item) => item && item.id === char.id);
        if (!up) continue;
        const info = namesByKey[`${char.game}:${char.id}`] || {};
        matched.push({
          game: char.game,
          id: char.id,
          name: info.name_zh || info.name || up.name || char.id,
          mark: bannerMark(row, char, info),
        });
      }
      if (!gameFollowed && !matched.length) continue;
      banners.push(presentBanner(game, row, matched));
    }
  }
  banners.sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      String(a.game).localeCompare(String(b.game))
  );

  const codes = [];
  for (const [game, doc] of Object.entries(codesByGame)) {
    const interested = list.games.includes(game) || list.chars.some((item) => item.game === game);
    if (!interested) continue;
    if (!doc) {
      missing.push(`codes:${game}`);
      continue;
    }
    for (const row of doc.codes || []) {
      if (!row || !row.code) continue;
      codes.push(presentCode(game, row, day));
    }
  }
  codes.sort((a, b) => codeRank(a) - codeRank(b) || String(a.game).localeCompare(String(b.game)));

  const highlightBanners = banners.filter((row) => row.matched.length);
  const codesNew = codes.filter((row) => row.marks.includes("new"));
  const codesExpiring = codes.filter((row) => row.marks.includes("expiring"));
  const labels = { games: {}, chars: {} };
  const labelGames = new Set([...list.games, ...list.chars.map((row) => row.game)]);
  for (const game of labelGames) labels.games[game] = gameLabel(digest, game);
  for (const row of list.chars) {
    const info = namesByKey[`${row.game}:${row.id}`] || {};
    labels.chars[`${row.game}:${row.id}`] = info.name_zh || info.name || row.id;
  }
  const query = canonicalQuery(list);
  const hasFollows = list.games.length > 0 || list.chars.length > 0;

  return {
    ok: true,
    stateless: true,
    stored: false,
    follows: list,
    labels,
    meta: {
      timezone: "Asia/Shanghai",
      today: day,
      source: "published /v1; stateless filter; follows are not stored",
      missing,
      rules: {
        expiring_days: EXPIRING_DAYS,
        new_code_days: NEW_CODE_DAYS,
        banner:
          "A followed character in up_characters is UP. kind rerun, or the character name after 复刻/復刻/rerun in the banner name, is 复刻.",
        code_new: `Not expired, and starts/released is an ISO date within the previous ${NEW_CODE_DAYS} Shanghai days.`,
        code_expiring: `Not expired, and expires is an ISO date within the next ${EXPIRING_DAYS} Shanghai days, including today.`,
        feed: "A followed game keeps its items. A character follow keeps items from that game whose title or summary contains a published name or alias.",
        codes_scope: "Codes come from followed games and from the games of followed characters. This list does not redeem them.",
      },
    },
    share: {
      query,
      code: encodeShareCode(list),
      page: hasFollows ? `/me/?${query}` : "/me/",
      atom: hasFollows ? `/v1/personal.atom?${query}` : "/v1/personal.atom",
    },
    highlights: {
      banners: highlightBanners,
      codes_new: codesNew,
      codes_expiring: codesExpiring,
    },
    feed: { count: feedItems.length, items: feedItems },
    digest: { count: digests.length, digests },
    banners,
    codes,
  };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fnv(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function personalAtom(doc, selfUrl) {
  const today = (doc.meta && doc.meta.today) || shanghaiToday();
  const updated = `${today}T12:00:00+08:00`;
  const entries = [];
  const push = (kind, title, href, summary) => {
    if (entries.length >= 40) return;
    entries.push({ kind, title, href: safeUrl(href), summary: summary || "" });
  };
  for (const row of (doc.highlights && doc.highlights.banners) || []) {
    const marks = row.marks.includes("rerun") && row.marks.includes("up")
      ? "UP·复刻"
      : row.marks.includes("rerun")
        ? "复刻"
        : "UP";
    const who = (row.matched || []).map((item) => item.name).filter(Boolean).join("、");
    push("banner", `【${marks}】${row.name || row.id}`, row.source, [who, row.status, row.note].filter(Boolean).join(" · "));
  }
  const seenCodes = new Set();
  for (const row of [
    ...((doc.highlights && doc.highlights.codes_new) || []),
    ...((doc.highlights && doc.highlights.codes_expiring) || []),
  ]) {
    const key = `${row.game}:${row.code}`;
    if (seenCodes.has(key)) continue;
    seenCodes.add(key);
    const bits = [];
    if (row.marks.includes("new")) bits.push("新码");
    if (row.marks.includes("expiring")) bits.push("即将过期");
    const left = row.days_left != null ? `还有 ${row.days_left} 天` : "";
    push("code", `【${bits.join("·")}】${row.game} ${row.code}`, row.source, [row.rewards, left, row.expires_text].filter(Boolean).join(" · "));
  }
  for (const item of (doc.feed && doc.feed.items) || []) {
    push("feed", item.title, item.url, item.summary || item.source || "");
  }
  const self = xmlEscape(selfUrl || (doc.share && doc.share.atom) || "/v1/personal.atom");
  const page = xmlEscape((doc.share && doc.share.page) || "/me/");
  const body = entries
    .map((entry, index) => {
      const link = entry.href ? `\n    <link href="${xmlEscape(entry.href)}" rel="alternate"/>` : "";
      const summary = entry.summary ? `\n    <summary>${xmlEscape(entry.summary)}</summary>` : "";
      return `  <entry>
    <title>${xmlEscape(entry.title)}</title>
    <id>tag:game-intel.local,2026:personal:${entry.kind}:${index}:${fnv(entry.title + entry.href)}</id>
    <updated>${updated}</updated>${link}${summary}
  </entry>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>game-intel 我的关注</title>
  <subtitle>无账号。查询参数即订阅，服务端不保存这份名单。</subtitle>
  <id>tag:game-intel.local,2026:personal:${fnv((doc.share && doc.share.query) || "")}</id>
  <updated>${updated}</updated>
  <link href="${self}" rel="self"/>
  <link href="${page}" rel="alternate"/>
${body}
</feed>
`;
}
