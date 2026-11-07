/**
 * Stateless freshness and coverage snapshot derived from published /v1 JSON.
 * Stores nothing. Helps humans and MCP agents (e.g. Grok bot) inspect recent
 * site updates, feed timestamps, and deep-game coverage in one read.
 */
import { DEEP_GAMES } from "./deep-games.js";
import { shanghaiYmd } from "./time.js";

const LIVE_CODE_STATUSES = new Set(["active", "reported_working", "listed_permanent"]);
const UNSTATED_CODE_STATUSES = new Set(["expiry_not_stated", "window_stated_without_year"]);

function ymdPrefix(val) {
  if (typeof val !== "string") return "";
  const m = val.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function summarizeBanners(bannersDoc, today) {
  const rows = Array.isArray(bannersDoc?.banners) ? bannersDoc.banners : [];
  let current_count = 0;
  let upcoming_count = 0;
  for (const b of rows) {
    const status = String(b?.status || "").trim();
    const start = ymdPrefix(b?.start);
    const end = ymdPrefix(b?.end);
    if (status === "ended" || (end && end < today)) continue;
    if (status === "upcoming" || (start && start > today)) {
      upcoming_count += 1;
    } else {
      current_count += 1;
    }
  }
  return {
    as_of: bannersDoc?.as_of || null,
    count: rows.length,
    current_count,
    upcoming_count,
  };
}

function summarizeCodes(codesDoc) {
  const rows = Array.isArray(codesDoc?.codes) ? codesDoc.codes : [];
  let live_count = 0;
  let expired_count = 0;
  let unstated_count = 0;
  for (const c of rows) {
    const st = String(c?.status || "").trim();
    if (LIVE_CODE_STATUSES.has(st)) live_count += 1;
    else if (st === "expired") expired_count += 1;
    else if (UNSTATED_CODE_STATUSES.has(st)) unstated_count += 1;
  }
  return {
    as_of: codesDoc?.as_of || null,
    checked: codesDoc?.checked || null,
    count: rows.length,
    live_count,
    expired_count,
    unstated_count,
  };
}

function summarizeDigestForGame(digestDoc, gameId) {
  const entry = (digestDoc?.digests || []).find((d) => (d.game || d.alias) === gameId);
  const items = Array.isArray(entry?.items) ? entry.items : [];
  let latest_date = null;
  for (const it of items) {
    const d = ymdPrefix(it?.updated || it?.date || it?.published_at || "");
    if (d && (!latest_date || d > latest_date)) latest_date = d;
  }
  return {
    count: items.length,
    latest_date,
    sources: Array.isArray(entry?.sources) ? entry.sources : [],
  };
}

export async function assembleStatus(readJson, options = {}) {
  const today = options.today || shanghaiYmd();
  const rawGame = typeof options.game === "string" ? options.game.trim() : "";
  if (rawGame && !DEEP_GAMES.includes(rawGame)) {
    return {
      ok: false,
      status: 400,
      error: "bad_game",
      message: `Unknown deep game: ${rawGame}. Expected one of: ${DEEP_GAMES.join(", ")}.`,
    };
  }

  const [digestDoc, radarDoc, calendarDoc, calendarHwDoc, feedDoc, gamesIdx, guidesIdx] = await Promise.all([
    readJson("/v1/digest.json"),
    readJson("/v1/radar.json"),
    readJson("/v1/calendar.json"),
    readJson("/v1/calendar-hw.json"),
    readJson("/v1/feed.json"),
    readJson("/v1/games/index.json"),
    readJson("/v1/guides/index.json"),
  ]);

  const targetGames = rawGame ? [rawGame] : [...DEEP_GAMES];
  const guideMap = new Map(
    (Array.isArray(guidesIdx?.games) ? guidesIdx.games : []).map((g) => [g.id, g])
  );

  const deep_games = await Promise.all(
    targetGames.map(async (id) => {
      const [guideGameIdx, bannersDoc, codesDoc] = await Promise.all([
        readJson(`/v1/guides/${id}/index.json`),
        readJson(`/v1/guides/${id}/banners.json`),
        readJson(`/v1/guides/${id}/codes.json`),
      ]);
      const gRow = guideMap.get(id) || {};
      const chars = Array.isArray(guideGameIdx?.characters) ? guideGameIdx.characters : [];
      const stub_characters = chars
        .filter((c) => c && c.stub === true && c.id)
        .map((c) => ({
          id: String(c.id),
          name: String(c.name || c.id),
          name_zh: String(c.name_zh || c.name || c.id),
        }));
      return {
        game: id,
        name: gRow.name || guideGameIdx?.name || id,
        name_zh: gRow.name_zh || guideGameIdx?.name_zh || gRow.name || id,
        character_count: gRow.character_count ?? guideGameIdx?.character_count ?? chars.length,
        rich_count: gRow.rich_count ?? guideGameIdx?.rich_count ?? 0,
        stub_count: gRow.stub_count ?? guideGameIdx?.stub_count ?? stub_characters.length,
        conclusion_stub_count: guideGameIdx?.conclusion_stub_count ?? 0,
        stub_characters,
        banners: summarizeBanners(bannersDoc, today),
        codes: summarizeCodes(codesDoc),
        digest: summarizeDigestForGame(digestDoc, id),
      };
    })
  );

  const allGuideGames = Array.isArray(guidesIdx?.games) ? guidesIdx.games : [];
  const character_total = allGuideGames.reduce((sum, g) => sum + (g.character_count || 0), 0);
  const rich_total = allGuideGames.reduce((sum, g) => sum + (g.rich_count || 0), 0);
  const stub_total = allGuideGames.reduce((sum, g) => sum + (g.stub_count || 0), 0);
  const conclusion_stub_total = deep_games.reduce((sum, g) => sum + (g.conclusion_stub_count || 0), 0);

  const digestList = Array.isArray(digestDoc?.digests) ? digestDoc.digests : [];
  const digestItemCount = digestList.reduce(
    (sum, d) => sum + (Array.isArray(d.items) ? d.items.length : 0),
    0
  );

  return {
    ok: true,
    derived: true,
    stored: false,
    today,
    timezone: "Asia/Shanghai",
    feeds: {
      digest: {
        generated_at: digestDoc?.meta?.generated_at || null,
        note: digestDoc?.meta?.note || null,
        game_count: digestList.length,
        item_count: digestItemCount,
      },
      radar: {
        generated_at: radarDoc?.meta?.generated_at || radarDoc?.as_of || null,
        count: Array.isArray(radarDoc?.items) ? radarDoc.items.length : (radarDoc?.count ?? 0),
      },
      calendar: {
        generated_at: calendarDoc?.meta?.generated_at || calendarDoc?.as_of || null,
        count: Array.isArray(calendarDoc?.events) ? calendarDoc.events.length : (calendarDoc?.count ?? 0),
      },
      calendar_hw: {
        generated_at: calendarHwDoc?.meta?.generated_at || calendarHwDoc?.as_of || null,
        count: Array.isArray(calendarHwDoc?.events) ? calendarHwDoc.events.length : (calendarHwDoc?.count ?? 0),
      },
      feed: {
        generated_at: feedDoc?.meta?.generated_at || null,
        as_of: feedDoc?.meta?.as_of || null,
        count: Array.isArray(feedDoc?.items) ? feedDoc.items.length : (feedDoc?.meta?.count ?? 0),
      },
    },
    catalog: {
      as_of: gamesIdx?.as_of || null,
      count: gamesIdx?.count ?? 0,
      watchlist_count: gamesIdx?.watchlist_count ?? 0,
      stub_count: gamesIdx?.stub_count ?? 0,
    },
    guides: {
      as_of: guidesIdx?.as_of || null,
      total_games: allGuideGames.length,
      deep_count: DEEP_GAMES.length,
      character_total,
      rich_total,
      stub_total,
      conclusion_stub_total,
    },
    deep_games,
  };
}
