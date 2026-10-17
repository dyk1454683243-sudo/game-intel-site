/**
 * Public read limiter for /v1 and /mcp.
 * Does not run on POST /v1/claims. Claims keep enforceRateLimit in claims.js
 * and do not read GAME_INTEL_API_KEYS or CLAIMS_API_KEY.
 *
 * Bindings (wrangler.toml [[ratelimits]], created on a later deploy):
 *   RATE_LIMIT_ANON — 120 / 60s per IP hash
 *   RATE_LIMIT_KEY  — 1200 / 60s per API-key hash
 * Counters are per Cloudflare location. A missing or throwing binding allows
 * the request. No new KV namespace is required.
 */
import { corsHeaders } from "./mcp.js";

export const API_VERSION = "1";
export const ANON_LIMIT = 120;
export const KEY_LIMIT = 1200;
export const LIMIT_PERIOD = 60;
export const ANON_BINDING = "RATE_LIMIT_ANON";
export const KEY_BINDING = "RATE_LIMIT_KEY";
export const API_KEYS_ENV = "GAME_INTEL_API_KEYS";

export const CACHE_STATIC = "public, max-age=300, stale-while-revalidate=86400";
export const CACHE_PERSONAL = "public, max-age=300";
export const CACHE_LONG = "public, max-age=3600";
export const CACHE_PORTRAIT = "public, max-age=86400";
export const CACHE_NONE = "no-store";

const MESSAGES = {
  rate_limited: "Too many requests. Wait for Retry-After, then retry. 请求过多，请按 Retry-After 再试。",
  invalid_api_key:
    "API key was not recognized. Omit the key to use the anonymous limit. 密钥无法识别；不带密钥则走匿名额度。",
  not_found: "No published document at this path. 这个路径没有已发布文档。",
  method_not_allowed: "Method not allowed. 不允许该方法。",
};

export function isClaimsSubmission(request) {
  if (!request || request.method !== "POST") return false;
  try {
    return new URL(request.url).pathname === "/v1/claims";
  } catch {
    return false;
  }
}

export function isPublicSurface(pathname) {
  return (
    pathname.startsWith("/v1/") ||
    pathname === "/v1" ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/openapi.json" ||
    pathname === "/server-card" ||
    pathname.startsWith("/.well-known/")
  );
}

export function isRateLimitedSurface(pathname) {
  return pathname.startsWith("/v1/") || pathname === "/v1" || pathname === "/mcp" || pathname.startsWith("/mcp/");
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function presentedKey(request) {
  const header = request.headers.get("x-api-key");
  if (header && header.trim()) return header.trim().slice(0, 256);
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(\S+)/i);
  return match ? match[1].slice(0, 256) : "";
}

export function configuredKeys(env) {
  const raw = env && env[API_KEYS_ENV];
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function keyMatches(presented, keys) {
  if (!presented || !Array.isArray(keys) || keys.length === 0) return false;
  let matched = 0;
  for (const key of keys) {
    matched |= timingSafeEqual(presented, key) ? 1 : 0;
  }
  return matched === 1;
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

function bindingReady(env, name) {
  return Boolean(env && env[name] && typeof env[name].limit === "function");
}

async function sha256Prefix(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function healthDocument(env) {
  const anon = bindingReady(env, ANON_BINDING);
  const keyed = bindingReady(env, KEY_BINDING);
  const rate_limit = anon && keyed ? "active" : anon || keyed ? "partial" : "degraded";
  return {
    ok: true,
    api_version: API_VERSION,
    service: "game-intel",
    timezone: "Asia/Shanghai",
    openapi: "/v1/openapi.json",
    developers: "/developers/",
    mcp: "/mcp",
    rate_limit,
  };
}

export function errorBody(status, error, extra = {}) {
  const body = {
    ok: false,
    error,
    message: extra.message || MESSAGES[error] || error,
    api_version: API_VERSION,
    status,
  };
  if (extra.tier) body.tier = extra.tier;
  if (extra.limit != null) body.limit = extra.limit;
  if (extra.retry_after != null) body.retry_after = extra.retry_after;
  return body;
}

export function apiError(status, error, extra = {}) {
  const headers = {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": CACHE_NONE,
    "x-api-version": API_VERSION,
    "x-content-type-options": "nosniff",
  };
  if (extra.retry_after != null) headers["retry-after"] = String(extra.retry_after);
  return new Response(JSON.stringify(errorBody(status, error, extra)), { status, headers });
}

export async function enforcePublicLimit(request, env) {
  if (isClaimsSubmission(request)) return null;
  const presented = presentedKey(request);
  let tier = "anonymous";
  if (presented) {
    if (!keyMatches(presented, configuredKeys(env))) return apiError(401, "invalid_api_key");
    tier = "key";
  }
  const bindingName = tier === "key" ? KEY_BINDING : ANON_BINDING;
  if (!bindingReady(env, bindingName)) return null;
  let token = "";
  try {
    const raw = tier === "key" ? `key:${presented}` : `ip:${clientIp(request)}`;
    token = await sha256Prefix(raw);
  } catch {
    return null;
  }
  let result;
  try {
    result = await env[bindingName].limit({ key: token });
  } catch {
    return null;
  }
  if (!result || result.success !== false) return null;
  const limit = tier === "key" ? KEY_LIMIT : ANON_LIMIT;
  return apiError(429, "rate_limited", { tier, limit, retry_after: LIMIT_PERIOD });
}

export function cachePolicy(pathname, method, status) {
  if (method !== "GET" && method !== "HEAD") return { cache: CACHE_NONE, etag: false, json: false };
  if (status !== 200) return { cache: CACHE_NONE, etag: false, json: pathname.endsWith(".json") };
  if (pathname === "/v1/health" || pathname === "/v1/claims" || pathname === "/v1/claims.json") {
    return { cache: CACHE_NONE, etag: true, json: true };
  }
  if (pathname === "/mcp") return { cache: CACHE_NONE, etag: false, json: false };
  if (pathname === "/v1/personal" || pathname === "/v1/personal.atom") {
    return { cache: CACHE_PERSONAL, etag: true, json: pathname.endsWith(".json") || pathname === "/v1/personal" };
  }
  if (pathname === "/v1/portrait") return { cache: CACHE_PORTRAIT, etag: true, json: false };
  if (
    pathname === "/v1/openapi.json" ||
    pathname === "/openapi.json" ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/mcp/server-card" ||
    pathname === "/server-card"
  ) {
    return { cache: CACHE_LONG, etag: true, json: true };
  }
  if (pathname.startsWith("/v1/") && (pathname.endsWith(".json") || pathname === "/v1/personal")) {
    return { cache: CACHE_STATIC, etag: true, json: true };
  }
  return { cache: null, etag: false, json: false };
}

export function fnvEtag(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return `"${(h >>> 0).toString(16)}"`;
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((part) => {
    const token = part.trim();
    return token === etag || token === `W/${etag}`;
  });
}

export async function decoratePublicResponse(response, request, policy) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  headers.set("x-api-version", API_VERSION);
  headers.set("x-content-type-options", "nosniff");
  if (policy.cache) headers.set("cache-control", policy.cache);
  if (policy.json && !headers.get("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  const method = request.method;
  if (!policy.etag || response.status !== 200 || (method !== "GET" && method !== "HEAD")) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const buf = await response.arrayBuffer();
  const etag = fnvEtag(new Uint8Array(buf));
  headers.set("etag", etag);
  headers.delete("content-length");
  if (method === "GET" && etagMatches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(buf, { status: response.status, headers });
}
