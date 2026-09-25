import { formatShanghai, shanghaiYmd } from "./time.js";
import { isSlug } from "./public-json.js";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_STATEMENT = 2000;
export const MAX_SOURCES = 8;
export const MAX_URL = 500;
export const MAX_SUBMITTER = 80;
export const MAX_STORED = 200;
export const RATE_LIMIT = 30;
export const INDEX_KEY = "claims:index";

export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  const len = Math.max(aa.length, bb.length);
  let out = aa.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    out |= (aa[i] || 0) ^ (bb[i] || 0);
  }
  return out === 0;
}

export function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : "";
}

export function authorize(request, env) {
  const expected = env && env.CLAIMS_API_KEY;
  if (!expected) return { ok: false, status: 503, error: "claims_api_unconfigured" };
  const got = bearerToken(request);
  if (!got || !timingSafeEqual(got, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}

export function isHttpsSource(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > MAX_URL) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password;
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
    if (!sources.includes(raw)) sources.push(raw);
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
  if (game != null && game !== "") {
    if (!isSlug(String(game))) return { ok: false, status: 400, error: "invalid_game_id" };
    claim.game_id = String(game);
  }
  const character = body.character_id ?? body.character;
  if (character != null && character !== "") {
    if (!isSlug(String(character))) {
      return { ok: false, status: 400, error: "invalid_character_id" };
    }
    claim.character_id = String(character);
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

export async function enforceRateLimit(env, request, now = new Date()) {
  if (!env.CLAIMS) return { ok: false, status: 503, error: "claims_kv_unconfigured" };
  const bucket = formatShanghai(now).slice(0, 13);
  const hash = (await sha256Hex(clientIp(request))).slice(0, 16);
  const key = `rl:${hash}:${bucket}`;
  const prev = Number((await env.CLAIMS.get(key)) || "0");
  if (prev >= RATE_LIMIT) return { ok: false, status: 429, error: "rate_limited" };
  await env.CLAIMS.put(key, String(prev + 1), { expirationTtl: 60 * 60 * 2 });
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
<p class="meta">只读镜像。带 https 出处的陈述，不是论坛。JSON：<a href="/v1/claims.json"><code>/v1/claims.json</code></a></p>
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
