export * from "./index-lib-06.js";
export { officialEarlyLookup } from "./index-lib-07a.js";
import { officialEarlyLookup } from "./index-lib-07a.js";
import {
  withCache,
  includesCI,
  truncate,
  clampLimit,
  readWatchlist,
  resolveGameEntry,
  getArticle,
  usesBd2OfficialApi,
  usesSmilegateNewsroom,
  usesStarOfficial,
  usesLo2Official,
  usesAsoraOfficial,
  STAR_OFFICIAL_SEED,
  LO2_OFFICIAL_SEED,
  ASORA_OFFICIAL_SEED,
  searchStarOfficial,
  searchLo2Official,
  searchAsoraOfficial,
  fetchOfficialViaJina,
  matchesMiresiOfficial,
} from "./index-lib-06.js";

async function searchOfficial({
  game,
  query,
  limit = 5,
  locale,
  forDigest = false,
} = {}) {
  const lim = clampLimit(limit, 5, 8);
  const entry = game ? resolveGameEntry(game) : null;
  const entryId = entry?.id || (game ? String(game).toLowerCase().trim() : null);
  const q = String(query || "").trim();
  if (!entryId && !q) {
    return { ok: false, error: "need_game_or_query", items: [] };
  }

  const wlEntry = entry || (entryId ? readWatchlist()[entryId] : null) || {};
  const steamAppid =
    wlEntry.steam_appid != null && String(wlEntry.steam_appid).trim() !== ""
      ? String(wlEntry.steam_appid).trim()
      : null;
  const officialUrl = wlEntry.official_url
    ? String(wlEntry.official_url).trim()
    : null;
  const officialApi = wlEntry.official_api
    ? String(wlEntry.official_api).trim()
    : null;
  const useBd2 =
    officialApi === "bd2_notices" || usesBd2OfficialApi(entryId, officialUrl);
  const useSmilegate = !useBd2 && usesSmilegateNewsroom(entryId, officialApi);
  const useStar =
    !useBd2 && !useSmilegate && usesStarOfficial(entryId, officialApi);
  const useLo2 =
    !useBd2 && !useSmilegate && !useStar && usesLo2Official(entryId, officialApi);
  const useAsora =
    !useBd2 &&
    !useSmilegate &&
    !useStar &&
    !useLo2 &&
    usesAsoraOfficial(entryId, officialApi);

  return withCache(
    "searchOfficial",
    {
      game: entryId || null,
      query: q || null,
      limit: lim,
      steam_appid: steamAppid,
      official_url: officialUrl,
      official_api: useBd2
        ? "bd2_notices"
        : useSmilegate
          ? "smilegate_newsroom"
          : useStar
            ? "star_official"
            : useLo2
              ? "lo2_official"
              : useAsora
                ? "asora_official"
                : officialApi || null,
      forDigest: !!forDigest,
      locale: locale || null,
    },
    async () => {
      const early = await officialEarlyLookup({
        lim,
        entryId,
        q,
        steamAppid,
        officialUrl,
        useBd2,
        useSmilegate,
        wlEntry,
        forDigest,
        locale,
      });
      if (early) return early;
      // 4) Azur Promilia / star — live scrape+Jina + curated seed (never no_official_config)
      if (useStar) {
        try {
          const kwHints = [
            ...(Array.isArray(wlEntry.keywords) ? wlEntry.keywords : []),
            wlEntry.name,
            wlEntry.name_zh,
            "Azur Promilia",
            "蓝色星原",
            "旅谣",
          ].filter(Boolean);
          const fetched = await searchStarOfficial({
            limit: lim,
            filterKeywords: kwHints,
          });
          let items = fetched.items || [];
          if (q && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            const nameHints = kwHints.map((x) => String(x).toLowerCase());
            const qIsGameName =
              !q ||
              nameHints.includes(q.toLowerCase()) ||
              q.toLowerCase() === entryId;
            if (filtered.length) items = filtered;
            else if (!qIsGameName) items = filtered;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: fetched.via || "star_official",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(fetched.scrape_error
              ? { scrape_error: fetched.scrape_error }
              : {}),
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          // Still return seed on unexpected throw
          const seeds = STAR_OFFICIAL_SEED.slice(0, lim).map((it) => ({
            title: it.title,
            url: it.url,
            source: "official",
          }));
          return {
            ok: seeds.length > 0,
            game: entryId,
            query: q || null,
            via: "star_seed",
            official_url: officialUrl,
            count: seeds.length,
            items: seeds,
            scrape_error: truncate(e.message, 80),
          };
        }
      }

      // 5) Last Origin 2 — VALOFE scrape + curated publisher seed
      if (useLo2) {
        try {
          const kwHints = [
            ...(Array.isArray(wlEntry.keywords) ? wlEntry.keywords : []),
            wlEntry.name,
            wlEntry.name_zh,
            "VALOFE",
            "Last Origin 2",
            "라스트오리진2",
          ].filter(Boolean);
          const fetched = await searchLo2Official({
            limit: lim,
            filterKeywords: kwHints,
          });
          let items = fetched.items || [];
          if (q && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            const nameHints = kwHints.map((x) => String(x).toLowerCase());
            const qIsGameName =
              !q ||
              nameHints.includes(q.toLowerCase()) ||
              q.toLowerCase() === entryId;
            if (filtered.length) items = filtered;
            else if (!qIsGameName) items = filtered;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: fetched.via || "lo2_official",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(fetched.scrape_error
              ? { scrape_error: fetched.scrape_error }
              : {}),
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          const seeds = LO2_OFFICIAL_SEED.slice(0, lim).map((it) => ({
            title: it.title,
            url: it.url,
            source: "official",
          }));
          return {
            ok: seeds.length > 0,
            game: entryId,
            query: q || null,
            via: "lo2_seed",
            official_url: officialUrl,
            count: seeds.length,
            items: seeds,
            scrape_error: truncate(e.message, 80),
          };
        }
      }

      // 6) Astrae Oratio / asora — plaync + NC Soft TW scrape + curated seed
      if (useAsora) {
        try {
          const kwHints = [
            ...(Array.isArray(wlEntry.keywords) ? wlEntry.keywords : []),
            wlEntry.name,
            wlEntry.name_zh,
            "阿索拉",
            "Astrae Oratio",
            "astraeoratio",
            "NCSOFT",
            "Dynamis One",
          ].filter(Boolean);
          const fetched = await searchAsoraOfficial({
            limit: lim,
            filterKeywords: kwHints,
          });
          let items = fetched.items || [];
          if (q && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            const nameHints = kwHints.map((x) => String(x).toLowerCase());
            const qIsGameName =
              !q ||
              nameHints.includes(q.toLowerCase()) ||
              q.toLowerCase() === entryId;
            if (filtered.length) items = filtered;
            else if (!qIsGameName) items = filtered;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: fetched.via || "asora_official",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(fetched.scrape_error
              ? { scrape_error: fetched.scrape_error }
              : {}),
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          const seeds = ASORA_OFFICIAL_SEED.slice(0, lim).map((it) => ({
            title: it.title,
            url: it.url,
            source: "official",
          }));
          return {
            ok: seeds.length > 0,
            game: entryId,
            query: q || null,
            via: "asora_seed",
            official_url: officialUrl,
            count: seeds.length,
            items: seeds,
            scrape_error: truncate(e.message, 80),
          };
        }
      }

      // 7) official_url via Jina (nikke / others — not bd2 SPA)
      if (officialUrl) {
        try {
          const fetched = await fetchOfficialViaJina(officialUrl, lim);
          // Optional query filter
          let items = fetched.items || [];
          if (q && items.length) {
            const filtered = items.filter(
              (it) => includesCI(it.title, q) || includesCI(it.url, q)
            );
            if (filtered.length) items = filtered;
          }
          // Miraesi / Smilegate boards mix other games — keep MIRESI-ish only
          if (
            entryId === "miraesi" ||
            /newsroom\.smilegate\.com/i.test(String(officialUrl))
          ) {
            const kwHints = [
              ...(Array.isArray(wlEntry.keywords) ? wlEntry.keywords : []),
              wlEntry.name,
              wlEntry.name_zh,
              "MIRESI",
              "미래시",
              "Invisible Future",
            ].filter(Boolean);
            const mir = items.filter((it) =>
              matchesMiresiOfficial(it.title, it.url, kwHints)
            );
            if (mir.length) items = mir;
          }
          return {
            ok: items.length > 0,
            game: entryId,
            query: q || null,
            via: "official_url",
            official_url: officialUrl,
            count: items.length,
            items,
            ...(items.length ? {} : { error: fetched.error || "no_official" }),
          };
        } catch (e) {
          return {
            ok: false,
            game: entryId,
            query: q || null,
            via: "official_url",
            official_url: officialUrl,
            count: 0,
            items: [],
            error: truncate(e.message, 80),
          };
        }
      }

      // No official_url / steam_appid configured
      return {
        ok: false,
        game: entryId,
        query: q || null,
        count: 0,
        items: [],
        error: "no_official_config",
      };
    }
  );
}

async function attachDigestSummaries(items, entryId, maxN = 2) {
  let attached = 0;
  for (const it of items) {
    if (attached >= maxN) break;
    const src = String(it?.source || "").toLowerCase();
    const can =
      (src === "gamekee" && (it.id != null || /gamekee\.com/i.test(it.url || ""))) ||
      /gamekee\.com/i.test(String(it?.url || ""));
    if (!can) continue;
    try {
      const art = await getArticle({
        url: it.url,
        id: it.id,
        game: entryId,
      });
      if (art?.ok && art.summary) {
        it.summary = truncate(art.summary, 240);
        attached += 1;
      }
    } catch {
      /* don't fail digest */
    }
  }
  return attached;
}

export {
  searchOfficial,
  attachDigestSummaries,
};
