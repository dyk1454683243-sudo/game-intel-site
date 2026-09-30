import { formatShanghai, shanghaiYmd } from "./time.js";
import { isSlug } from "./public-json.js";

/**
 * Public POST /v1/claims abuse caps. No API key.
 * Counts are best-effort Workers KV read-modify-write (not a lock).
 * Per IP: 10 posts per Asia/Shanghai hour (`rl:{sha256(ip)[0:16]}:{YYYY-MM-DDTHH}`, TTL 2h).
 * Global: 100 posts per Asia/Shanghai calendar day (`rl:global:{YYYY-MM-DD}`, TTL 48h).
 * Body: 16384 bytes. Statement: 2000 chars. Sources: 1–8 https URLs, each ≤ 500 chars.
 * IP is `cf-connecting-ip` (Cloudflare). `x-forwarded-for` is only a local fallback.
 */
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_STATEMENT = 2000;
export const MAX_SOURCES = 8;
export const MAX_URL = 500;
export const MAX_SUBMITTER = 80;
export const MAX_STORED = 200;
export const RATE_LIMIT_PER_IP = 10;
export const RATE_LIMIT_GLOBAL_DAY = 100;
export const GLOBAL_RATE_PREFIX = "rl:global:";
export const INDEX_KEY = "claims:index";

/** DNS labels that mark a placeholder, docs, or fake host. */
const PLACEHOLDER_LABELS = new Set([
  "example",
  "invalid",
  "localhost",
  "placeholder",
  "changeme",
  "fake",
]);

const RESERVED_SUFFIXES = [".example", ".invalid", ".localhost", ".test", ".local", ".localdomain"];

/** Syntactic https check only. Do not fetch the URL (that would be an SSRF). */
export function isHttpsSource(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length < 12 || text.length > MAX_URL) return false;
  if (/[\s<>"']/.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return !isBlockedHost(url.hostname);
}

function isBlockedHost(hostname) {
  let host = String(hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host || host === "localhost" || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (host.includes(":")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  for (const suffix of RESERVED_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
  }
  const labels = host.split(".");
  if (labels.length < 2) return true;
  if (labels.some((label) => PLACEHOLDER_LABELS.has(label))) return true;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld)) return true;
  return labels.some((label) => !isHostnameLabel(label));
}

function isHostnameLabel(label) {
  return label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

export function normalizeClaim(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const statement = String(body.statement ?? body.claim ?? "").trim();
  if (!statement) return { ok: false, status: 400, error: "statement_required" };
  if (statement.length > MAX_STATEMENT) {
    return { ok: false, status: 400, error: "statement_too_long" };
  }
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return { ok: false, status: 400, error: "sources_required" };
  }
  if (body.sources.length > MAX_SOURCES) {
    return { ok: false, status: 400, error: "too_many_sources" };
  }
  const sources = [];
  for (const raw of body.sources) {
    if (!isHttpsSource(raw)) return { ok: false, status: 400, error: "invalid_source" };
    const url = String(raw).trim();
    if (!sources.includes(url)) sources.push(url);
  }
  const claim = {
    id: crypto.randomUUID(),
    statement,
    sources,
    timezone: "Asia/Shanghai",
    submitted_at: formatShanghai(now),
  };
  const asOf = body.as_of == null || body.as_of === "" ? shanghaiYmd(now) : String(body.as_of).trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(asOf)) {
    return { ok: false, status: 400, error: "invalid_as_of" };
  }
  claim.as_of = asOf;
  const game = body.game_id ?? body.game;
  if (game == null || String(game).trim() === "") {
    return { ok: false, status: 400, error: "game_id_required" };
  }
  const gameId = String(game).trim();
  if (!isSlug(gameId)) return { ok: false, status: 400, error: "invalid_game_id" };
  claim.game_id = gameId;
  const character = body.character_id ?? body.character;
  if (character != null && character !== "") {
    const characterId = String(character).trim();
    if (!isSlug(characterId)) {
      return { ok: false, status: 400, error: "invalid_character_id" };
    }
    claim.character_id = characterId;
  }
  if (body.submitter != null && body.submitter !== "") {
    const submitter = String(body.submitter).trim();
    if (!submitter || submitter.length > MAX_SUBMITTER) {
      return { ok: false, status: 400, error: "invalid_submitter" };
    }
    claim.submitter = submitter;
  }
  return { ok: true, claim };
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function countOf(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function enforceRateLimit(env, request, now = new Date()) {
  if (!env.CLAIMS) return { ok: false, status: 503, error: "claims_kv_unconfigured" };
  const stamp = formatShanghai(now);
  const hour = stamp.slice(0, 13);
  const day = stamp.slice(0, 10);
  const hash = (await sha256Hex(clientIp(request))).slice(0, 16);
  const ipKey = `rl:${hash}:${hour}`;
  const globalKey = `${GLOBAL_RATE_PREFIX}${day}`;
  const prevIp = countOf(await env.CLAIMS.get(ipKey));
  if (prevIp >= RATE_LIMIT_PER_IP) {
    return { ok: false, status: 429, error: "rate_limited", scope: "ip", limit: RATE_LIMIT_PER_IP };
  }
  const prevGlobal = countOf(await env.CLAIMS.get(globalKey));
  if (prevGlobal >= RATE_LIMIT_GLOBAL_DAY) {
    return { ok: false, status: 429, error: "rate_limited", scope: "day", limit: RATE_LIMIT_GLOBAL_DAY };
  }
  await env.CLAIMS.put(ipKey, String(prevIp + 1), { expirationTtl: 60 * 60 * 2 });
  await env.CLAIMS.put(globalKey, String(prevGlobal + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true };
}

export async function readIndex(env) {
  if (!env.CLAIMS) return [];
  const raw = await env.CLAIMS.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function saveClaim(env, claim) {
  await env.CLAIMS.put(`claim:${claim.id}`, JSON.stringify(claim));
  const ids = [claim.id, ...(await readIndex(env))];
  const kept = ids.slice(0, MAX_STORED);
  const dropped = ids.slice(MAX_STORED);
  await env.CLAIMS.put(INDEX_KEY, JSON.stringify(kept));
  await Promise.all(dropped.map((id) => env.CLAIMS.delete(`claim:${id}`)));
  return claim;
}

export async function listClaims(env) {
  const ids = await readIndex(env);
  const claims = [];
  for (const id of ids) {
    const raw = await env.CLAIMS.get(`claim:${id}`);
    if (!raw) continue;
    try {
      claims.push(JSON.parse(raw));
    } catch {
      /* skip corrupt row */
    }
  }
  return {
    ok: true,
    count: claims.length,
    timezone: "Asia/Shanghai",
    claims,
  };
}

export function claimsHtml(mirror) {
  const rows = (mirror.claims || [])
    .map((c) => {
      const sources = (c.sources || [])
        .map((u) => `<li><a href="${esc(u)}" rel="noopener noreferrer">${esc(u)}</a></li>`)
        .join("");
      const who = c.submitter ? `<span class="meta">${esc(c.submitter)}</span>` : "";
      const game = c.game_id ? `<code>${esc(c.game_id)}</code>` : "";
      const character = c.character_id ? `<code>${esc(c.character_id)}</code>` : "";
      return `<article>
<h2>${esc(c.statement)}</h2>
<p class="meta">${esc(c.submitted_at || "")} · as_of ${esc(c.as_of || "")} ${who} ${game} ${character}</p>
<ul>${sources}</ul>
</article>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>核对墙 · game-intel claims</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111}
    a{color:#06c} code{background:#f4f4f4;padding:.1em .35em;border-radius:4px}
    .meta{color:#666;font-size:.9rem} article{border-top:1px solid #ddd;padding:1rem 0}
    ul{padding-left:1.2rem}
  </style>
</head>
<body>
<h1>核对墙 Claims</h1>
<p class="meta">公开提交，没有审核队列。列出的陈述在人工复核前不可信。只读镜像，必须带 https 出处，不是论坛。JSON：<a href="/v1/claims.json"><code>/v1/claims.json</code></a></p>
<p class="meta">${mirror.count} accepted · ${esc(mirror.timezone || "Asia/Shanghai")}</p>
${rows || "<p>还没有已接受的核对。</p>"}
<p><a href="/">← 首页</a></p>
</body>
</html>`;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
