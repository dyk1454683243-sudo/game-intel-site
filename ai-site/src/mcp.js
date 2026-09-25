import {
  LEGACY_PROTOCOLS,
  MODERN_PROTOCOL,
  PROTOCOL_VERSIONS,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_VERSION,
} from "./discovery.js";
import { clipText, isSlug, readPublic, resolveAlias } from "./public-json.js";
import { listClaims } from "./claims.js";

const META_VERSION = "io.modelcontextprotocol/protocolVersion";

export const TOOLS = [
  {
    name: "list_games",
    description: "Game catalog index from /v1/games/index.json. Published JSON only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_game",
    description: "One game entity from /v1/games/{id}.json. Do not invent prices or scores.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Catalog id, e.g. hw" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "watchlist",
    description: "Watchlist JSON from /v1/watchlist.json.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "digest",
    description: "Digest headlines from /v1/digest.json. Optional game id filter.",
    inputSchema: {
      type: "object",
      properties: { game: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "radar",
    description: "New-game radar from /v1/radar.json.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "calendar",
    description: "Event calendar from /v1/calendar.json. game=hw also reads /v1/calendar-hw.json.",
    inputSchema: {
      type: "object",
      properties: { game: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } },
      additionalProperties: false,
    },
  },
  {
    name: "feed",
    description: "Recent intel items from /v1/feed.json.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_guides",
    description: "Guide coverage from /v1/guides/index.json, or one game's /v1/guides/{game}/index.json.",
    inputSchema: {
      type: "object",
      properties: { game: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_guide",
    description: "Character card from /v1/guides/{game}/characters/{id}.json. Keep sources and stub flags.",
    inputSchema: {
      type: "object",
      properties: { game: { type: "string" }, id: { type: "string" } },
      required: ["game", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_alias",
    description: "Nickname lookup in /v1/guides/{game}/aliases.json (nikke includes p1–p4).",
    inputSchema: {
      type: "object",
      properties: { game: { type: "string" }, q: { type: "string" } },
      required: ["game", "q"],
      additionalProperties: false,
    },
  },
  {
    name: "read_llms",
    description: "Agent route map from /llms.txt.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_public_json",
    description: "Fetch one allowlisted public path (/v1/…, /llms.txt, /openapi.json). No HTML.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_claims",
    description: "Public read-only claims mirror from the same data as GET /v1/claims.json.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function toolText(payload, isError = false) {
  const clipped = clipText(typeof payload === "string" ? payload : JSON.stringify(payload));
  return {
    resultType: "complete",
    content: [{ type: "text", text: clipped.text }],
    isError,
  };
}

export async function callTool(env, origin, name, args = {}) {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "list_games":
      return jsonTool(await readPublic(env, origin, "/v1/games/index.json"));
    case "get_game":
      if (!isSlug(a.id)) return toolText({ ok: false, error: "bad_id" }, true);
      return jsonTool(await readPublic(env, origin, `/v1/games/${a.id}.json`));
    case "watchlist":
      return jsonTool(await readPublic(env, origin, "/v1/watchlist.json"));
    case "digest": {
      const got = await readPublic(env, origin, "/v1/digest.json");
      if (!got.ok || !a.game) return jsonTool(got);
      if (!isSlug(a.game)) return toolText({ ok: false, error: "bad_game" }, true);
      const digests = (got.data.digests || []).filter((d) => d.game === a.game);
      return toolText({ ...got.data, count: digests.length, digests, filtered_game: a.game });
    }
    case "radar":
      return jsonTool(await readPublic(env, origin, "/v1/radar.json"));
    case "calendar": {
      const path = a.game === "hw" ? "/v1/calendar-hw.json" : "/v1/calendar.json";
      const got = await readPublic(env, origin, path);
      if (!got.ok) return jsonTool(got);
      let events = got.data.events || [];
      if (a.game && a.game !== "hw") {
        if (!isSlug(a.game)) return toolText({ ok: false, error: "bad_game" }, true);
        events = events.filter((e) => e.game === a.game);
      }
      const limit = Number.isInteger(a.limit) ? Math.min(30, Math.max(1, a.limit)) : events.length;
      events = events.slice(0, limit);
      return toolText({ ...got.data, path, count: events.length, events });
    }
    case "feed":
      return jsonTool(await readPublic(env, origin, "/v1/feed.json"));
    case "list_guides":
      if (!a.game) return jsonTool(await readPublic(env, origin, "/v1/guides/index.json"));
      if (!isSlug(a.game)) return toolText({ ok: false, error: "bad_game" }, true);
      return jsonTool(await readPublic(env, origin, `/v1/guides/${a.game}/index.json`));
    case "get_guide":
      if (!isSlug(a.game) || !isSlug(a.id)) return toolText({ ok: false, error: "bad_id" }, true);
      return jsonTool(
        await readPublic(env, origin, `/v1/guides/${a.game}/characters/${a.id}.json`)
      );
    case "resolve_alias":
      return toolText(await resolveAlias(env, origin, a.game, a.q), false);
    case "read_llms": {
      const got = await readPublic(env, origin, "/llms.txt");
      if (!got.ok) return toolText(got, true);
      return toolText(got.text);
    }
    case "read_public_json": {
      const path = typeof a.path === "string" ? a.path : "";
      const got = await readPublic(env, origin, path);
      if (!got.ok) return toolText({ ok: false, error: got.error, path }, true);
      return got.data !== undefined ? toolText({ path, data: got.data }) : toolText(got.text);
    }
    case "list_claims":
      return toolText(await listClaims(env));
    default:
      return null;
  }
}

function jsonTool(got) {
  if (!got.ok) return toolText({ ok: false, error: got.error || "not_found", path: got.path }, true);
  return toolText({ path: got.path, data: got.data });
}

export function listToolsResult() {
  return { resultType: "complete", tools: TOOLS };
}

export function discoverResult() {
  return {
    resultType: "complete",
    supportedVersions: PROTOCOL_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    },
    instructions: SERVER_DESCRIPTION,
    ttlMs: 3600000,
    cacheScope: "public",
  };
}

function decodeHeaderValue(value) {
  if (typeof value !== "string") return "";
  if (value.startsWith("=?base64?") && value.endsWith("?=")) {
    const b64 = value.slice("=?base64?".length, -2);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return value;
}

function rpcError(id, code, message, data, status) {
  const body = { jsonrpc: "2.0", error: { code, message } };
  if (id !== undefined) body.id = id;
  if (data !== undefined) body.error.data = data;
  return { status, body };
}

export async function handleMcp(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "DELETE") {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32600, message: "Method not allowed" } },
      405,
      { allow: "POST, OPTIONS" }
    );
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders({ allow: "POST, OPTIONS" }) });
  }
  if (request.method !== "POST" || url.pathname !== "/mcp") {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32600, message: "Not found" } },
      404
    );
  }

  const originHeader = request.headers.get("origin");
  if (originHeader && !originAllowed(originHeader, url.host)) {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32600, message: "Origin not allowed" } },
      403
    );
  }

  const raw = await request.text();
  if (raw.length > 64 * 1024) {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32600, message: "Body too large" } },
      400
    );
  }
  let msg;
  try {
    msg = raw ? JSON.parse(raw) : null;
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
      400
    );
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return jsonResponse(
      { jsonrpc: "2.0", error: { code: -32600, message: "Invalid request" } },
      400
    );
  }

  const headerVersion = request.headers.get("mcp-protocol-version");
  const bodyVersion = msg.params?._meta?.[META_VERSION];
  const modern =
    headerVersion === MODERN_PROTOCOL || bodyVersion === MODERN_PROTOCOL;

  if (modern) {
    const validated = validateModern(request, msg, headerVersion, bodyVersion);
    if (validated) {
      return jsonResponse(validated.body, validated.status);
    }
  } else if (headerVersion && !LEGACY_PROTOCOLS.includes(headerVersion) && !bodyVersion) {
    return jsonResponse(
      rpcError(msg.id ?? null, -32022, "Unsupported protocol version", {
        supported: PROTOCOL_VERSIONS,
        requested: headerVersion,
      }).body,
      400
    );
  }

  if (msg.id === undefined && msg.method) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  const result = await dispatch(env, url.origin, msg, modern ? MODERN_PROTOCOL : legacyVersion(headerVersion, msg));
  if (result.status === 202) return new Response(null, { status: 202, headers: corsHeaders() });
  return jsonResponse(result.body, result.status);
}

function legacyVersion(headerVersion, msg) {
  const requested = headerVersion || msg.params?.protocolVersion;
  if (LEGACY_PROTOCOLS.includes(requested)) return requested;
  return "2025-11-25";
}

function validateModern(request, msg, headerVersion, bodyVersion) {
  if (!headerVersion || headerVersion !== MODERN_PROTOCOL) {
    return rpcError(msg.id ?? null, -32022, "Unsupported protocol version", {
      supported: PROTOCOL_VERSIONS,
      requested: headerVersion || bodyVersion || "",
    }, 400);
  }
  if (bodyVersion !== headerVersion) {
    return rpcError(
      msg.id ?? null,
      -32020,
      "Header mismatch: MCP-Protocol-Version does not match _meta protocolVersion",
      undefined,
      400
    );
  }
  const methodHeader = request.headers.get("mcp-method");
  if (!methodHeader || methodHeader !== msg.method) {
    return rpcError(
      msg.id ?? null,
      -32020,
      "Header mismatch: Mcp-Method does not match method",
      undefined,
      400
    );
  }
  if (msg.method === "tools/call") {
    const nameHeader = decodeHeaderValue(request.headers.get("mcp-name") || "");
    const bodyName = msg.params?.name;
    if (!nameHeader || nameHeader !== bodyName) {
      return rpcError(
        msg.id ?? null,
        -32020,
        "Header mismatch: Mcp-Name does not match params.name",
        undefined,
        400
      );
    }
  }
  return null;
}

async function dispatch(env, origin, msg, protocolVersion) {
  const { method, id, params } = msg;
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return { status: 202 };
  }
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    const version = LEGACY_PROTOCOLS.includes(requested) ? requested : "2025-11-25";
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "game-intel", version: SERVER_VERSION },
          instructions: SERVER_DESCRIPTION,
        },
      },
    };
  }
  if (method === "server/discover") {
    return { status: 200, body: { jsonrpc: "2.0", id, result: discoverResult() } };
  }
  if (method === "ping") {
    return { status: 200, body: { jsonrpc: "2.0", id, result: {} } };
  }
  if (method === "tools/list") {
    return { status: 200, body: { jsonrpc: "2.0", id, result: listToolsResult() } };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const called = await callTool(env, origin, name, params?.arguments || {});
    if (!called) {
      return rpcError(id, -32602, `Unknown tool: ${name || ""}`, undefined, 200);
    }
    return { status: 200, body: { jsonrpc: "2.0", id, result: called } };
  }
  if (protocolVersion === MODERN_PROTOCOL) {
    return rpcError(id ?? null, -32601, "Method not found", undefined, 404);
  }
  return rpcError(id ?? null, -32601, "Method not found", undefined, 200);
}

function originAllowed(origin, host) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === "null") return false;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.host === host) return true;
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;
  if (parsed.hostname.endsWith(".workers.dev")) return true;
  return false;
}

export function corsHeaders(extra = {}) {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": extra.allow || "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
    "access-control-expose-headers": "ETag",
  };
  if (extra.allow) headers.allow = extra.allow;
  return headers;
}

export function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(extra),
    },
  });
}
