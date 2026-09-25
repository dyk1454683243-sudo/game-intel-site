import { aiCatalog, serverCard } from "./discovery.js";
import {
  MAX_BODY_BYTES,
  authorize,
  claimsHtml,
  enforceRateLimit,
  listClaims,
  normalizeClaim,
  saveClaim,
} from "./claims.js";
import { corsHeaders, handleMcp, jsonResponse } from "./mcp.js";

const DISCOVERY_PATHS = new Set([
  "/.well-known/mcp.json",
  "/.well-known/ai-catalog.json",
]);

export default {
  async fetch(request, env) {
    const routed = await route(request, env);
    if (routed) return routed;
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/mcp") return handleMcp(request, env);

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

async function postClaim(request, env) {
  const auth = authorize(request, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const limited = await enforceRateLimit(env, request);
  if (!limited.ok) return jsonResponse({ ok: false, error: limited.error }, limited.status);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "body_too_large" }, 413);
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
