import { aiCatalog, serverCard } from "./discovery.js";
import {
  MAX_BODY_BYTES,
  claimsHtml,
  enforceRateLimit,
  listClaims,
  normalizeClaim,
  saveClaim,
} from "./claims.js";
import { corsHeaders, handleMcp, jsonResponse } from "./mcp.js";
import { openApiDocument } from "./openapi.js";
import { personalDocument } from "./personal.js";
import {
  API_VERSION,
  CACHE_LONG,
  apiError,
  cachePolicy,
  decoratePublicResponse,
  enforcePublicLimit,
  healthDocument,
  isPublicSurface,
  isRateLimitedSurface,
} from "./public-limit.js";
import { personalAtom } from "../public/ui/personal.js";
import { servePortrait } from "../public/ui/portrait.js";

const DISCOVERY_PATHS = new Set([
  "/.well-known/mcp.json",
  "/.well-known/ai-catalog.json",
]);

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

function cacheStore() {
  try {
    if (typeof caches === "undefined" || !caches || !caches.default) return null;
    return caches.default;
  } catch {
    return null;
  }
}

function isStaticJson(pathname) {
  return pathname.startsWith("/v1/") && pathname.endsWith(".json") && pathname !== "/v1/openapi.json";
}

async function fetchStatic(request, env, pathname) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const cache = cacheStore();
  if (cache && request.method === "GET" && isStaticJson(pathname)) {
    try {
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch {
      /* a missing cache must not fail the request */
    }
  }
  let asset;
  try {
    asset = await env.ASSETS.fetch(request);
  } catch {
    return null;
  }
  if (cache && request.method === "GET" && isStaticJson(pathname) && asset && asset.status === 200) {
    try {
      await cache.put(request, asset.clone());
    } catch {
      /* ignore */
    }
  }
  return asset;
}

export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname;

  if (request.method === "OPTIONS" && isPublicSurface(path)) {
    const allow = path === "/mcp" || path.startsWith("/mcp/") ? "POST, OPTIONS" : "GET, HEAD, POST, OPTIONS";
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders({ allow }), "x-api-version": API_VERSION },
    });
  }

  if (request.method !== "OPTIONS" && isRateLimitedSurface(path)) {
    const limited = await enforcePublicLimit(request, env);
    if (limited) return limited;
  }

  const effective = request.method === "HEAD" ? new Request(request, { method: "GET" }) : request;
  let response = await route(effective, env);
  if (!response) {
    if (path.startsWith("/v1/") || path === "/v1") {
      if (effective.method !== "GET") return apiError(405, "method_not_allowed");
      response = await fetchStatic(effective, env, path);
      if (!response || response.status === 404) return apiError(404, "not_found");
    } else if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      response = await env.ASSETS.fetch(effective);
    } else {
      return new Response("Not found", { status: 404 });
    }
  }

  if (isPublicSurface(path) || path === "/llms.txt" || path === "/developers" || path.startsWith("/developers/")) {
    response = await decoratePublicResponse(response, effective, cachePolicy(path, effective.method, response.status));
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/v1/health") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed");
    return jsonResponse(healthDocument(env), 200);
  }

  if ((path === "/v1/openapi.json" || path === "/openapi.json") && request.method === "GET") {
    return new Response(JSON.stringify(openApiDocument()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": CACHE_LONG,
        "x-api-version": API_VERSION,
        ...corsHeaders(),
      },
    });
  }

  if (path === "/mcp") return handleMcp(request, env);

  if (path === "/v1/personal" || path === "/v1/personal.atom") {
    return respondPersonal(request, env, path);
  }

  if (path === "/v1/portrait") {
    if (request.method !== "GET") return new Response("method", { status: 405 });
    return servePortrait(url.searchParams.get("u"));
  }

  if (request.method === "OPTIONS" && (DISCOVERY_PATHS.has(path) || path === "/mcp/server-card" || path.startsWith("/v1/claims"))) {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method === "GET" && DISCOVERY_PATHS.has(path)) {
    return catalogResponse(aiCatalog(url.origin));
  }
  if (request.method === "GET" && (path === "/mcp/server-card" || path === "/server-card")) {
    return cardResponse(serverCard(url.origin));
  }

  if (path === "/v1/claims" && request.method === "POST") {
    return postClaim(request, env);
  }
  if ((path === "/v1/claims.json" || path === "/v1/claims") && request.method === "GET") {
    const mirror = await listClaims(env);
    return jsonResponse(mirror, 200);
  }
  if ((path === "/claims" || path === "/claims/" || path === "/claims/index.html") && request.method === "GET") {
    const mirror = await listClaims(env);
    return new Response(claimsHtml(mirror), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...corsHeaders(),
      },
    });
  }
  return null;
}

async function respondPersonal(request, env, path) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") return jsonResponse({ ok: false, error: "method" }, 405);
  const url = new URL(request.url);
  const doc = await personalDocument(env, url.origin, {
    games: url.searchParams.get("games") || "",
    chars: url.searchParams.get("chars") || "",
    code: url.searchParams.get("code") || "",
  });
  if (!doc.ok) return jsonResponse({ ok: false, error: doc.error }, doc.status || 400);
  if (path === "/v1/personal.atom") {
    return new Response(personalAtom(doc, url.href), {
      status: 200,
      headers: {
        "content-type": "application/atom+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        ...corsHeaders(),
      },
    });
  }
  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...corsHeaders(),
    },
  });
}

async function postClaim(request, env) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "body_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "body_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  }

  const limited = await enforceRateLimit(env, request);
  if (!limited.ok) {
    const body = { ok: false, error: limited.error };
    if (limited.scope) body.scope = limited.scope;
    if (limited.limit) body.limit = limited.limit;
    return jsonResponse(body, limited.status);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }
  const normalized = normalizeClaim(body);
  if (!normalized.ok) {
    return jsonResponse({ ok: false, error: normalized.error }, normalized.status);
  }
  const saved = await saveClaim(env, normalized.claim);
  return jsonResponse({ ok: true, claim: saved }, 201);
}

function catalogResponse(doc) {
  const body = JSON.stringify(doc);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/ai-catalog+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      etag: etag(body),
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, If-None-Match",
      "access-control-expose-headers": "ETag",
    },
  });
}

function cardResponse(doc) {
  const body = JSON.stringify(doc);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/mcp-server-card+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      etag: etag(body),
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, If-None-Match",
      "access-control-expose-headers": "ETag",
    },
  });
}

function etag(body) {
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `"${(h >>> 0).toString(16)}"`;
}
