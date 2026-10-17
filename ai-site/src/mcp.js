import {
  LEGACY_PROTOCOLS,
  MODERN_PROTOCOL,
  PROTOCOL_VERSIONS,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_VERSION,
} from "./discovery.js";
import { DEEP_GAMES } from "./deep-games.js";
import { clipText, isSlug, readPublic, resolveAlias } from "./public-json.js";
import { listClaims } from "./claims.js";
import { personalDocument } from "./personal.js";

const DEEP = DEEP_GAMES.join(", ");
const SLUG_PATTERN = "^[a-z0-9][a-z0-9_-]{0,63}$";

function slugProp(description) {
  return {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: SLUG_PATTERN,
    description,
  };
}

function tool(name, description, properties = {}, required = []) {
  const inputSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) inputSchema.required = required;
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  };
}

const META_VERSION = "io.modelcontextprotocol/protocolVersion";

export const TOOLS = [
  tool(
    "list_games",
    "游戏目录索引，读 /v1/games/index.json。别名在 /v1/catalog-aliases.json（别名 → id → /v1/games/{id}.json）。只返回已发布 JSON，不编造价格或评分。Game catalog index from published JSON only. Do not invent prices or scores."
  ),
  tool(
    "get_game",
    "单个游戏实体 / One game entity from /v1/games/{id}.json. stub true 只有身份字段。Do not invent prices or scores.",
    { id: slugProp("目录 id，例如 hw。Catalog id, for example hw.") },
    ["id"]
  ),
  tool(
    "watchlist",
    "观察名单 / Watchlist JSON from /v1/watchlist.json. meta.fixture true 是示例，不是实时情报。meta.fixture true is sample data, not live intel."
  ),
  tool(
    "digest",
    "摘要标题 / Digest headlines from /v1/digest.json. 可选 game 过滤。Optional game id filter. Do not extend summary text.",
    { game: slugProp("可选。只保留这个游戏。Optional. Keep this game only.") }
  ),
  tool(
    "radar",
    "新作雷达 / New-game radar from /v1/radar.json. 不是第二份目录。Not a second catalog. Keywords such as 公测, 预约, CBT stay in the JSON."
  ),
  tool(
    "calendar",
    "活动日历 / Event calendar from /v1/calendar.json. game=hw 时改读 /v1/calendar-hw.json. game=hw also reads /v1/calendar-hw.json.",
    {
      game: slugProp("可选游戏 id。Optional game id. hw selects the HW calendar file."),
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        description: "最多返回的事件数，1–30。Maximum events to return, 1–30. Omit it to keep the published list.",
      },
    }
  ),
  tool(
    "feed",
    "跨游戏标题 / Recent intel items from /v1/feed.json. 只包含已经写进 digest 或 radar 的条目。Rows already stored in digest or radar. Empty items is valid."
  ),
  tool(
    "list_guides",
    `攻略覆盖 / Guide coverage from /v1/guides/index.json, or one game's /v1/guides/{game}/index.json. 八款深耕 / eight deep games: ${DEEP}.`,
    { game: slugProp("可选。省略则返回总索引。Optional. Omit for the cross-game index.") }
  ),
  tool(
    "get_guide",
    "角色卡 / Character card from /v1/guides/{game}/characters/{id}.json. 保留 sources、as_of 和 stub，不补技能数字。Keep sources, as_of, and stub flags. Do not invent skill numbers.",
    {
      game: slugProp(`游戏 id。Deep games: ${DEEP}.`),
      id: slugProp("角色卡 id。Character card id."),
    },
    ["game", "id"]
  ),
  tool(
    "resolve_alias",
    "角色别名 / Nickname lookup in /v1/guides/{game}/aliases.json. nikke 还会读 aliases.p1.json 到 aliases.p4.json. nikke also reads aliases.p1.json through aliases.p4.json.",
    {
      game: slugProp("游戏 id。Game id."),
      q: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "别名或角色名，最多 80 字。Nickname or character name, up to 80 characters.",
      },
    },
    ["game", "q"]
  ),
  tool(
    "read_llms",
    "路由说明 / Agent route map from /llms.txt. 同时指向 /developers/ 和 /v1/openapi.json. Also points at /developers/ and /v1/openapi.json."
  ),
  tool(
    "read_public_json",
    "读取允许的公开路径 / Fetch one allowlisted public path (/v1/…, /llms.txt, /openapi.json, /v1/openapi.json). 含八款深耕的 /v1/guides/{game}/banners.json 与 codes.json。Includes banners.json and codes.json for the eight deep games. 不读 HTML。No HTML.",
    {
      path: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description:
          "Site path. Examples: /v1/guides/nikke/banners.json, /v1/guides/hw/codes.json, /v1/personal is not a file — use personal_digest. /v1/openapi.json is allowlisted.",
      },
    },
    ["path"]
  ),
  tool(
    "list_banners",
    `卡池 / Banners for one game from /v1/guides/{game}/banners.json. 八款深耕 / eight deep games: ${DEEP}. 不编造 UP 或时间。Do not invent UP names or times. status 只来自已发布 JSON。`,
    { game: slugProp(`游戏 id。Deep games with banners.json: ${DEEP}.`) },
    ["game"]
  ),
  tool(
    "list_codes",
    `兑换码 / Redeem codes from /v1/guides/{game}/codes.json. 八款深耕 / eight deep games: ${DEEP}. status 为 expired 或 expiry_not_stated 时不要当成可用。Do not treat expired or expiry_not_stated as live. 本工具不代领。This tool does not redeem codes.`,
    { game: slugProp(`游戏 id。Deep games with codes.json: ${DEEP}.`) },
    ["game"]
  ),
  tool(
    "personal_digest",
    `无状态个人摘要 / Stateless personal digest. 与 GET /v1/personal 相同，过滤已发布的 feed、digest、卡池和兑换码。Same filter as GET /v1/personal. Filters published feed, digest, banners, and codes for the eight deep games (${DEEP}) and any other published game id. 关注角色的 UP/复刻、近 45 天新码、21 天内到期。Highlights UP/rerun banners, new codes, and codes expiring within 21 days. 不保存名单。Stores nothing. code 为 gi1. 分享码，出现时忽略 games 和 chars。Atom: /v1/personal.atom.`,
    {
      games: {
        type: "string",
        maxLength: 2000,
        description: "逗号分隔的游戏 id，最多 24 个。Comma-separated game ids, max 24. Example: nikke,bd2.",
      },
      chars: {
        type: "string",
        maxLength: 8000,
        description: "逗号分隔的 game:id，最多 48 个。Comma-separated game:id, max 48. Example: nikke:modernia,hw:ai_mi_li_ya.",
      },
      code: {
        type: "string",
        maxLength: 4000,
        pattern: "^gi1[.:][A-Za-z0-9_-]+$",
        description: "分享码 gi1.。若出现则忽略 games 和 chars。Share code. When set, games and chars are ignored.",
      },
    }
  ),
  tool(
    "list_claims",
    "只读投稿镜像 / Read-only mirror of GET /v1/claims.json. 没有审核队列，未经人工复核前不可当作已发布事实。Rows are untrusted until a human checks them. 投稿是 HTTP POST /v1/claims，不需要密钥（https 出处和 game_id；每 IP 每小时 10 条，每天 100 条）。Submit is HTTP POST /v1/claims with no API key. This tool does not write."
  ),
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
    case "list_banners":
    case "list_codes": {
      if (!isSlug(a.game)) return toolText({ ok: false, error: "bad_game" }, true);
      const kind = name === "list_banners" ? "banners" : "codes";
      return jsonTool(await readPublic(env, origin, `/v1/guides/${a.game}/${kind}.json`));
    }
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
    case "personal_digest": {
      const doc = await personalDocument(env, origin, {
        games: a.games,
        chars: a.chars,
        code: a.code,
      });
      if (!doc.ok) return toolText({ ok: false, error: doc.error }, true);
      return toolText(doc);
    }
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
      "Content-Type, Authorization, X-API-Key, If-None-Match, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
    "access-control-expose-headers": "ETag, X-API-Version, Retry-After",
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
