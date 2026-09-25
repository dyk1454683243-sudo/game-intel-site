export * from "./index-lib-07.js";
export {
  digestGame,
  CAL_BODY_FETCH_CAP,
  CAL_BODY_CONCURRENCY,
  CAL_BODY_SNIPPET_CHARS,
  CAL_DATE_BLOB_CHARS,
} from "./index-lib-08a.js";
import {
  digestGame,
  CAL_BODY_FETCH_CAP,
  CAL_BODY_CONCURRENCY,
  CAL_BODY_SNIPPET_CHARS,
  CAL_DATE_BLOB_CHARS,
} from "./index-lib-08a.js";
import {
  withCache,
  passesDigestGameGate,
  BAHAMUT_BSN,
  BAHAMUT_QUERY_PREF,
  PRYDWEN_ORIGIN,
  INVEN_PREF_GAMES,
  isNoise,
  truncate,
  stripHtml,
  itemDateMs,
  dedupeByUrlOrTitle,
  applyDigestDiff,
  pickAlias,
  pickQuery,
  fetchText,
  searchGamekee,
  getArticle,
  searchTaptap,
  searchInven,
  searchSteam,
  searchBahamut,
  isNikkeContext,
  searchPrydwen,
  parseBd2NoticeId,
  isBd2NewsViewUrl,
  fetchBd2NoticeDetail,
  isBd2ComicSubject,
  preferBd2OfficialForDigest,
  searchOfficial,
  attachDigestSummaries,
} from "./index-lib-07.js";

import {
  parseDatesFromText,
  eventNeedsDateEnrichment,
  bumpEventConfidence,
  TYPED_EVENT_RANK,
} from "./calendar-parse.js";


function scrubJinaBodyText(text) {
  let t = String(text || "");
  t = t.replace(/^Title:.*$/gim, "");
  t = t.replace(/^URL Source:.*$/gim, "");
  t = t.replace(/^Published Time:.*$/gim, "");
  t = t.replace(/^Markdown Content:.*$/gim, "");
  t = t.replace(/^Warning:.*$/gim, "");
  // Drop very short nav-ish lines at the top
  const lines = t.split(/\n+/);
  const kept = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (
      kept.length < 4 &&
      /^(HOME|NEWS|ABOUT|MEDIA|LOGIN|SIGN\s*UP|MENU|导航|首頁|首页)$/i.test(s)
    ) {
      continue;
    }
    kept.push(s);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

async function mapPoolLimited(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, list.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= list.length) break;
        results[i] = await fn(list[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Fetch a short body/summary snippet for calendar date enrichment.
 * BD2 official → notices detail API (full content); gamekee → getArticle;
 * else Jina r.jina.ai plain text. Prefer BD2 detail **before** Jina (SPA junk).
 */
async function fetchCalendarBodySnippet(item, gameId) {
  const url = String(item?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const src = String(item?.source || "").toLowerCase();
  const noticeId =
    parseBd2NoticeId(item?.id) ||
    parseBd2NoticeId(url) ||
    null;
  const isBd2 =
    isBd2NewsViewUrl(url) ||
    (src === "official" && noticeId && /browndust2\.com/i.test(url)) ||
    (src === "official" && !!noticeId && String(gameId || item?.game || "").toLowerCase() === "bd2");

  // BD2: always prefer official detail API over short contentPreview / Jina
  if (isBd2 && noticeId) {
    return withCache("calendarBody", { via: "bd2_detail", id: noticeId }, async () => {
      try {
        const detail = await fetchBd2NoticeDetail(noticeId, "en-us");
        if (detail?.ok && detail.content) {
          const plain = stripHtml(String(detail.content)).trim();
          if (plain.length >= 20) {
            return truncate(plain, CAL_BODY_SNIPPET_CHARS);
          }
        }
      } catch {
        /* fall through to attached / jina */
      }
      const attached = item?.summary != null ? String(item.summary).trim() : "";
      if (attached.length >= 40) {
        return truncate(attached, CAL_BODY_SNIPPET_CHARS);
      }
      return null;
    });
  }

  const attached = item?.summary != null ? String(item.summary).trim() : "";
  if (attached.length >= 40) {
    return truncate(attached, CAL_BODY_SNIPPET_CHARS);
  }

  const isGk =
    src === "gamekee" || /gamekee\.com/i.test(url);

  return withCache("calendarBody", { url }, async () => {
    try {
      if (isGk) {
        const art = await getArticle({
          url,
          id: item?.id,
          game: gameId || item?.game,
        });
        if (art?.ok && art.summary) {
          return truncate(String(art.summary), CAL_BODY_SNIPPET_CHARS);
        }
        return null;
      }
      const jinaUrl = `https://r.jina.ai/${url}`;
      const res = await fetchText(jinaUrl, {
        headers: { Accept: "text/plain,text/markdown,*/*" },
        timeoutMs: 20000,
      });
      if (!res.ok || !res.text) return null;
      const scrubbed = scrubJinaBodyText(res.text);
      if (!scrubbed || scrubbed.length < 20) return null;
      return truncate(scrubbed, CAL_BODY_SNIPPET_CHARS);
    } catch {
      return null;
    }
  });
}

/**
 * After initial parse, enrich undated events by re-parsing title+body snippet.
 * Cap: max 6 body fetches per game; typed events preferred; concurrency ≤3.
 */
async function enrichCalendarDates(events, { gameId, itemByUrl } = {}) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return list;

  const candidates = list
    .map((ev, idx) => ({ ev, idx }))
    .filter(({ ev }) => eventNeedsDateEnrichment(ev))
    .filter(({ ev }) => {
      const u = String(ev?.url || "").trim();
      return u && /^https?:\/\//i.test(u);
    });

  candidates.sort((a, b) => {
    const ra = TYPED_EVENT_RANK[a.ev.type] ?? 99;
    const rb = TYPED_EVENT_RANK[b.ev.type] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.idx - b.idx;
  });

  const toFetch = candidates.slice(0, CAL_BODY_FETCH_CAP);
  if (!toFetch.length) return list;

  await mapPoolLimited(toFetch, CAL_BODY_CONCURRENCY, async ({ ev }) => {
    const url = String(ev.url || "").trim();
    const baseItem =
      (itemByUrl && (itemByUrl.get(url) || itemByUrl.get(url.replace(/\/$/, "")))) ||
      {};
    const item = {
      url,
      source: ev.source || baseItem.source,
      id: baseItem.id ?? ev.id,
      game: gameId || ev.game,
      summary: baseItem.summary || "",
    };

    const isBd2Item =
      isBd2NewsViewUrl(url) ||
      (String(item.source || "").toLowerCase() === "official" &&
        (parseBd2NoticeId(item.id) || parseBd2NoticeId(url)));

    let snippet = null;
    const attached = String(item.summary || "").trim();
    // BD2 contentPreview is often too short for event windows — prefer detail API
    if (attached && !isBd2Item) {
      snippet = truncate(attached, CAL_DATE_BLOB_CHARS);
    }
    if (!snippet || snippet.length < 40 || isBd2Item) {
      const fetched = await fetchCalendarBodySnippet(item, gameId || ev.game);
      if (fetched) snippet = fetched;
      else if (!snippet && attached) snippet = truncate(attached, CAL_DATE_BLOB_CHARS);
    }
    if (!snippet) return;

    const blob = `${ev.title || ""} ${snippet}`.slice(
      0,
      160 + CAL_DATE_BLOB_CHARS
    );
    const parsed = parseDatesFromText(blob);
    const { start, end, precision } = parsed;
    if (!start && !end) return;
    if (!ev.start && start) ev.start = start;
    if (!ev.end && end) ev.end = end;
    if (precision === "month") ev.precision = "month";
    bumpEventConfidence(ev);
  });

  return list;
}


function isPrydwenCharacterPage(item) {
  const src = String(item?.source || "").toLowerCase();
  if (src !== "prydwen") return false;
  const url = String(item?.url || "");
  try {
    const u = new URL(url, PRYDWEN_ORIGIN);
    return /\/nikke\/characters?\//i.test(u.pathname || "");
  } catch {
    return /\/nikke\/characters?\//i.test(url);
  }
}

/**
 * Convert a digest/search item into a short calendar event, or null to skip.
 * Uses title + up to ~1200 chars of attached summary for date parse.
 * @param {object} item
 * @param {{id?:string,name?:string,name_zh?:string}} gameMeta
 */

export {
  scrubJinaBodyText,
  mapPoolLimited,
  fetchCalendarBodySnippet,
  enrichCalendarDates,
  isPrydwenCharacterPage,
};
