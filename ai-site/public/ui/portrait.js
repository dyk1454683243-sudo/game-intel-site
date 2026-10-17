/**
 * Character portrait URLs for hw / nikke / bd2.
 *
 * GameKee list icons live on cdnimg-v2.gamekee.com. That host returns HTTP 567
 * unless the request Referer is on gamekee.com, so a browser on this site cannot
 * hotlink them. The human UI asks /v1/portrait for those URLs; the worker fetches
 * the stored URL with a GameKee Referer and returns the image bytes.
 * Prydwen character images on cdn.prydwen.gg answer without that check, so the
 * page uses those URLs directly.
 */

export const GAMEKEE_IMAGE_HEADERS = Object.freeze({
  Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
  Referer: "https://www.gamekee.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
});

const RULES = Object.freeze([
  { host: "cdn.prydwen.gg", prefix: "/images/nikke/characters/" },
]);

const MAX_BYTES = 3 * 1024 * 1024;

export function portraitTarget(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (url.search || url.hash) return null;
  if (url.hostname === "cdnimg-v2.gamekee.com") {
    const legacy = url.pathname.startsWith("/wiki2.0/images/");
    const sized = url.pathname.startsWith("/wiki2.0/pro/") && url.pathname.includes("/images/");
    if (!legacy && !sized) return null;
  } else {
    const rule = RULES.find((row) => row.host === url.hostname);
    if (!rule || !url.pathname.startsWith(rule.prefix)) return null;
  }
  if (url.pathname.includes("..") || url.pathname.includes("//") || url.pathname.includes("\\")) return null;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)) return null;
  return url;
}

export function portraitImgSrc(raw) {
  const target = portraitTarget(raw);
  if (!target) return "";
  if (target.hostname === "cdnimg-v2.gamekee.com") {
    return `/v1/portrait?u=${encodeURIComponent(target.href)}`;
  }
  return target.href;
}

export function looksLikeImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 12) return "";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

export async function fetchPortrait(raw, fetchImpl = fetch) {
  let current = portraitTarget(raw);
  if (!current) return { ok: false, status: 400, error: "rejected_url" };
  for (let hop = 0; hop < 3; hop++) {
    const headers =
      current.hostname === "cdnimg-v2.gamekee.com"
        ? GAMEKEE_IMAGE_HEADERS
        : {
            Accept: GAMEKEE_IMAGE_HEADERS.Accept,
            "User-Agent": GAMEKEE_IMAGE_HEADERS["User-Agent"],
          };
    let res;
    try {
      res = await fetchImpl(current.href, { headers, redirect: "manual" });
    } catch {
      return { ok: false, status: 502, error: "fetch_failed" };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      const next = loc ? portraitTarget(new URL(loc, current).href) : null;
      if (!next || next.hostname !== current.hostname) {
        return { ok: false, status: 502, error: "bad_redirect" };
      }
      current = next;
      continue;
    }
    if (!res.ok) return { ok: false, status: 502, error: `upstream_${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES || buf.byteLength < 12) {
      return { ok: false, status: 502, error: "bad_size" };
    }
    const type = looksLikeImage(buf);
    if (!type) return { ok: false, status: 502, error: "not_image" };
    return { ok: true, status: 200, bytes: buf, type, finalUrl: current.href };
  }
  return { ok: false, status: 502, error: "too_many_redirects" };
}

export async function servePortrait(raw, fetchImpl = fetch) {
  const got = await fetchPortrait(raw, fetchImpl);
  if (!got.ok) {
    return new Response(got.error, {
      status: got.status,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  return new Response(got.bytes, {
    status: 200,
    headers: {
      "content-type": got.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
