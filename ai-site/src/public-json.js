/** Allowlisted reads of published JSON/text. No HTML scraping. */

export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const NIKKE_PARTS = ["aliases.p1.json", "aliases.p2.json", "aliases.p3.json", "aliases.p4.json"];

export function isSlug(value) {
  return typeof value === "string" && SLUG.test(value);
}

export async function readAsset(env, origin, pathname) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return { ok: false, status: 404, path: pathname, error: "assets_unconfigured" };
  }
  const res = await env.ASSETS.fetch(new Request(`${origin}${pathname}`));
  if (!res.ok) {
    return { ok: false, status: res.status, path: pathname, error: "not_found" };
  }
  const text = await res.text();
  return { ok: true, status: 200, path: pathname, text };
}

export async function readJson(env, origin, pathname) {
  const got = await readAsset(env, origin, pathname);
  if (!got.ok) return got;
  try {
    return { ...got, data: JSON.parse(got.text) };
  } catch {
    return { ok: false, status: 502, path: pathname, error: "invalid_json" };
  }
}

export function resolvePublicPath(pathname) {
  if (pathname === "/llms.txt" || pathname === "/openapi.json") return pathname;
  if (pathname === "/v1/games/index.json") return pathname;
  if (pathname === "/v1/digest.json") return pathname;
  if (pathname === "/v1/radar.json") return pathname;
  if (pathname === "/v1/feed.json") return pathname;
  if (pathname === "/v1/watchlist.json") return pathname;
  if (pathname === "/v1/calendar.json") return pathname;
  if (pathname === "/v1/calendar-hw.json") return pathname;
  if (pathname === "/v1/guides/index.json") return pathname;
  if (pathname === "/v1/guides/hw/dopamine-auto.json") return pathname;

  let m = pathname.match(/^\/v1\/games\/([a-z0-9][a-z0-9_-]{0,63})\.json$/);
  if (m && isSlug(m[1])) return pathname;

  m = pathname.match(/^\/v1\/guides\/([a-z0-9][a-z0-9_-]{0,63})\/index\.json$/);
  if (m && isSlug(m[1])) return pathname;

  m = pathname.match(
    /^\/v1\/guides\/([a-z0-9][a-z0-9_-]{0,63})\/aliases(?:\.p[1-4])?\.json$/
  );
  if (m && isSlug(m[1])) return pathname;

  m = pathname.match(
    /^\/v1\/guides\/([a-z0-9][a-z0-9_-]{0,63})\/characters\/([a-z0-9][a-z0-9_-]{0,63})\.json$/
  );
  if (m && isSlug(m[1]) && isSlug(m[2])) return pathname;

  return null;
}

export async function readPublic(env, origin, pathname) {
  const safe = resolvePublicPath(pathname);
  if (!safe) return { ok: false, status: 400, path: pathname, error: "path_not_allowed" };
  if (safe === "/llms.txt") return readAsset(env, origin, safe);
  return readJson(env, origin, safe);
}

export function clipText(text, max = 24000) {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `${text.slice(0, max)}\n…truncated`,
    truncated: true,
  };
}

export async function resolveAlias(env, origin, game, q) {
  if (!isSlug(game)) return { ok: false, error: "bad_game" };
  const query = String(q || "").trim();
  if (!query || query.length > 80) return { ok: false, error: "bad_query" };
  const paths = [`/v1/guides/${game}/aliases.json`];
  if (game === "nikke") {
    for (const part of NIKKE_PARTS) paths.push(`/v1/guides/nikke/${part}`);
  }
  const tried = [];
  for (const path of paths) {
    const got = await readJson(env, origin, path);
    tried.push(path);
    if (!got.ok) continue;
    const aliases = got.data && got.data.aliases;
    if (!aliases || typeof aliases !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(aliases, query)) {
      return { ok: true, game, q: query, match: aliases[query], path };
    }
    const lower = query.toLowerCase();
    const key = Object.keys(aliases).find((k) => k.toLowerCase() === lower);
    if (key) return { ok: true, game, q: query, match: aliases[key], path, key };
  }
  return { ok: false, error: "not_found", game, q: query, tried };
}
