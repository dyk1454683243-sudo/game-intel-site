/**
 * OpenAPI 3.1 for the public read API. One document is served at
 * /v1/openapi.json and /openapi.json. Schemas are copied from ai-site/schema
 * so a single GET is enough for a client. POST /v1/claims stays keyless.
 */
import aliasesSchema from "../schema/aliases.schema.json" with { type: "json" };
import calendarSchema from "../schema/calendar.schema.json" with { type: "json" };
import catalogAliasesSchema from "../schema/catalog-aliases.schema.json" with { type: "json" };
import characterCardSchema from "../schema/character-card.schema.json" with { type: "json" };
import claimSchema from "../schema/claim.schema.json" with { type: "json" };
import claimsIndexSchema from "../schema/claims-index.schema.json" with { type: "json" };
import digestSchema from "../schema/digest.schema.json" with { type: "json" };
import feedSchema from "../schema/feed.schema.json" with { type: "json" };
import gameSchema from "../schema/game.schema.json" with { type: "json" };
import gamesIndexSchema from "../schema/games-index.schema.json" with { type: "json" };
import guidesIndexSchema from "../schema/guides-index.schema.json" with { type: "json" };
import personalSchema from "../schema/personal.schema.json" with { type: "json" };
import watchlistSchema from "../schema/watchlist.schema.json" with { type: "json" };
import { DEEP_GAMES, PUBLIC_ORIGIN } from "./deep-games.js";
import { ANON_LIMIT, API_VERSION, KEY_LIMIT, LIMIT_PERIOD } from "./public-limit.js";

export const SCHEMA_FILES = Object.freeze([
  "aliases.schema.json",
  "calendar.schema.json",
  "catalog-aliases.schema.json",
  "character-card.schema.json",
  "claim.schema.json",
  "claims-index.schema.json",
  "digest.schema.json",
  "feed.schema.json",
  "game.schema.json",
  "games-index.schema.json",
  "guides-index.schema.json",
  "personal.schema.json",
  "watchlist.schema.json",
]);

const DEEP = DEEP_GAMES.join(", ");
const SLUG = "^[a-z0-9][a-z0-9_-]{0,63}$";

const gameParam = {
  name: "game",
  in: "path",
  required: true,
  description: `Game id. Deep coverage / 深耕: ${DEEP}.`,
  schema: { type: "string", pattern: SLUG },
};
const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Slug id.",
  schema: { type: "string", pattern: SLUG },
};
const plannerQuery = [
  {
    name: "game",
    in: "query",
    required: false,
    description: "Optional game id. Omit to list every game that has a current or future row.",
    schema: { type: "string", pattern: SLUG },
  },
  {
    name: "resources",
    in: "query",
    required: false,
    description: "Optional game:count pairs, comma-separated. Applied only to banners whose note states 首个 N 次征集. Nothing is stored.",
    schema: { type: "string" },
  },
];
const compareQuery = [
  {
    name: "ids",
    in: "query",
    required: true,
    description: "2 to 4 game:id pairs from the same game, comma-separated. 同一游戏 2 到 4 张卡。",
    schema: { type: "string" },
  },
];
const personalQuery = [
  {
    name: "games",
    in: "query",
    required: false,
    description: "Comma-separated game ids, max 24. Ignored when code is set. 逗号分隔的游戏 id，最多 24 个。",
    schema: { type: "string" },
  },
  {
    name: "chars",
    in: "query",
    required: false,
    description: "Comma-separated game:id, max 48. Ignored when code is set. 逗号分隔的 game:id，最多 48 个。",
    schema: { type: "string" },
  },
  {
    name: "code",
    in: "query",
    required: false,
    description: "Share code gi1.… When present, games and chars are ignored. 分享码。出现时忽略 games 和 chars。",
    schema: { type: "string", pattern: "^gi1[.:][A-Za-z0-9_-]+$" },
  },
];

function embed(schema) {
  const copy = structuredClone(schema);
  delete copy.$schema;
  delete copy.$id;
  return copy;
}

/**
 * Public operations. `example` is a live URL the consistency test requests.
 * `skipLive` marks writes. Paths here are the OpenAPI path set.
 */
export const API_ROUTES = [
  { method: "get", path: "/v1/health", operationId: "getHealth", summary: "Liveness. Does not check KV. 健康检查，不依赖 KV。", schema: "Health", example: "/v1/health" },
  { method: "get", path: "/v1/openapi.json", operationId: "getOpenApi", summary: "This OpenAPI 3.1 document.", schema: "OpenApiDocument", example: "/v1/openapi.json" },
  { method: "get", path: "/openapi.json", operationId: "getOpenApiAlias", summary: "Same document as /v1/openapi.json.", schema: "OpenApiDocument", example: "/openapi.json" },
  { method: "get", path: "/v1/games/index.json", operationId: "getGamesIndex", summary: "Game catalog index. Stubs are identity-only. 游戏目录。", schema: "GamesIndex", example: "/v1/games/index.json" },
  { method: "get", path: "/v1/games/{id}.json", operationId: "getGame", summary: "One game entity.", schema: "Game", params: [idParam], example: "/v1/games/hw.json" },
  { method: "get", path: "/v1/catalog-aliases.json", operationId: "getCatalogAliases", summary: "Catalog nickname → game id. Not character aliases. 目录别名。", schema: "CatalogAliases", example: "/v1/catalog-aliases.json" },
  { method: "get", path: "/v1/feed.json", operationId: "getFeed", summary: "Cross-game headlines already present in digest or radar.", schema: "Feed", example: "/v1/feed.json" },
  { method: "get", path: "/v1/watchlist.json", operationId: "getWatchlist", summary: "Watchlist. meta.fixture true is sample data. 观察名单。", schema: "Watchlist", example: "/v1/watchlist.json" },
  { method: "get", path: "/v1/digest.json", operationId: "getDigest", summary: "Per-game headlines. Best-effort daily. 摘要。", schema: "Digest", example: "/v1/digest.json" },
  { method: "get", path: "/v1/radar.json", operationId: "getRadar", summary: "New-game / CBT scan. Not a second catalog. 新作雷达。", schema: "Radar", example: "/v1/radar.json" },
  { method: "get", path: "/v1/calendar.json", operationId: "getCalendar", summary: "Dated events.", schema: "Calendar", example: "/v1/calendar.json" },
  { method: "get", path: "/v1/calendar-hw.json", operationId: "getCalendarHw", summary: "Horizon Walker calendar export.", schema: "Calendar", example: "/v1/calendar-hw.json" },
  { method: "get", path: "/v1/guides/index.json", operationId: "getGuidesIndex", summary: "Which games have guide cards.", schema: "GuidesIndex", example: "/v1/guides/index.json" },
  { method: "get", path: "/v1/guides/{game}/index.json", operationId: "getGuideGame", summary: "Character index for one game, plus banners and codes links.", schema: "GuideGameIndex", params: [gameParam], example: "/v1/guides/hw/index.json" },
  { method: "get", path: "/v1/guides/{game}/aliases.json", operationId: "getGuideAliases", summary: "Character nicknames for one game.", schema: "Aliases", params: [gameParam], example: "/v1/guides/hw/aliases.json" },
  { method: "get", path: "/v1/guides/nikke/aliases.p1.json", operationId: "getNikkeAliasesP1", summary: "NIKKE alias part 1 of 4.", schema: "Aliases", example: "/v1/guides/nikke/aliases.p1.json" },
  { method: "get", path: "/v1/guides/nikke/aliases.p2.json", operationId: "getNikkeAliasesP2", summary: "NIKKE alias part 2 of 4.", schema: "Aliases", example: "/v1/guides/nikke/aliases.p2.json" },
  { method: "get", path: "/v1/guides/nikke/aliases.p3.json", operationId: "getNikkeAliasesP3", summary: "NIKKE alias part 3 of 4.", schema: "Aliases", example: "/v1/guides/nikke/aliases.p3.json" },
  { method: "get", path: "/v1/guides/nikke/aliases.p4.json", operationId: "getNikkeAliasesP4", summary: "NIKKE alias part 4 of 4.", schema: "Aliases", example: "/v1/guides/nikke/aliases.p4.json" },
  { method: "get", path: "/v1/guides/{game}/characters/{id}.json", operationId: "getCharacter", summary: "Character card. Non-stub rows include https sources and as_of.", schema: "CharacterCard", params: [gameParam, idParam], example: "/v1/guides/hw/characters/ai_mi_li_ya.json" },
  { method: "get", path: "/v1/guides/{game}/banners.json", operationId: "getBanners", summary: `Banners / 卡池. Deep games: ${DEEP}. Do not invent UP names or times.`, schema: "Banners", params: [gameParam], example: "/v1/guides/nikke/banners.json" },
  { method: "get", path: "/v1/guides/{game}/codes.json", operationId: "getCodes", summary: `Redeem codes / 兑换码. Deep games: ${DEEP}. expired and expiry_not_stated are not live. This API does not redeem.`, schema: "Codes", params: [gameParam], example: "/v1/guides/nikke/codes.json" },
  { method: "get", path: "/v1/guides/hw/dopamine-auto.json", operationId: "getDopamineAuto", summary: "Horizon Walker dopamine-auto teams.", schema: "DopamineAuto", example: "/v1/guides/hw/dopamine-auto.json" },
  { method: "get", path: "/v1/guides/hw/modes/dopamine-auto.json", operationId: "getDopamineAutoMode", summary: "Same dopamine-auto document under modes/.", schema: "DopamineAuto", example: "/v1/guides/hw/modes/dopamine-auto.json" },
  { method: "get", path: "/v1/personal", operationId: "getPersonal", summary: "Stateless personal digest. Stores nothing. 无状态个人摘要，不保存名单。", schema: "Personal", query: personalQuery, example: "/v1/personal?games=hw" },
  {
    method: "get",
    path: "/v1/planner",
    operationId: "getPlanner",
    summary: "Derived banner timeline from published banners, calendar, and codes. Stores nothing. Pull math only when a banner note states 首个 N 次征集.",
    schema: "Planner",
    query: plannerQuery,
    badRequest: "bad_game or bad_resources. 游戏 id 或 resources 无法解析。",
    example: "/v1/planner",
  },
  {
    method: "get",
    path: "/v1/compare",
    operationId: "getCompare",
    summary: "Derived side-by-side fields for 2–4 character cards in one game. Empty fields are null. Stores nothing.",
    schema: "Compare",
    query: compareQuery,
    badRequest: "bad_compare. Need 2 to 4 game:id values from the same game. 需要 2 到 4 张同一游戏的卡。",
    example: "/v1/compare?ids=hw:ai_mi_li_ya,hw:garud",
  },
  { method: "get", path: "/v1/personal.atom", operationId: "getPersonalAtom", summary: "Atom feed for the same personal filter.", atom: true, query: personalQuery, example: "/v1/personal.atom?chars=hw:ai_mi_li_ya" },
  { method: "get", path: "/v1/claims.json", operationId: "getClaims", summary: "Public claims mirror. Rows are untrusted until a human reviews them. 投稿镜像，未经复核不可信。", schema: "ClaimsIndex", example: "/v1/claims.json" },
  { method: "get", path: "/v1/claims", operationId: "getClaimsAlias", summary: "Same JSON as /v1/claims.json.", schema: "ClaimsIndex", example: "/v1/claims" },
  { method: "post", path: "/v1/claims", operationId: "postClaim", summary: "Submit a sourced claim. No API key. Claims rate limit is unchanged.", claimsPost: true, skipLive: true },
  { method: "get", path: "/v1/portrait", operationId: "getPortrait", summary: "Proxy one allowlisted portrait image. 只代理允许的立绘 URL。", portrait: true, example: "/v1/portrait", exampleStatus: 400 },
  { method: "get", path: "/llms.txt", operationId: "getLlms", summary: "Agent route map.", text: true, example: "/llms.txt" },
  { method: "get", path: "/developers/", operationId: "getDevelopers", summary: "Developer page (Chinese and English).", html: true, example: "/developers/" },
  { method: "get", path: "/developers/index.html", operationId: "getDevelopersIndex", summary: "Same developer page.", html: true, example: "/developers/index.html" },
  { method: "get", path: "/.well-known/mcp.json", operationId: "getMcpCatalog", summary: "MCP discovery. Same document as /.well-known/ai-catalog.json.", schema: "AiCatalog", example: "/.well-known/mcp.json" },
  { method: "get", path: "/.well-known/ai-catalog.json", operationId: "getAiCatalog", summary: "MCP AI Catalog.", schema: "AiCatalog", example: "/.well-known/ai-catalog.json" },
  { method: "get", path: "/mcp/server-card", operationId: "getServerCard", summary: "MCP server card.", schema: "ServerCard", example: "/mcp/server-card" },
  { method: "get", path: "/server-card", operationId: "getServerCardAlias", summary: "MCP server card alias.", schema: "ServerCard", example: "/server-card" },
  { method: "post", path: "/mcp", operationId: "postMcp", summary: "Read-only MCP streamable HTTP. Tools include list_banners, list_codes, and personal_digest.", mcpPost: true, example: "/mcp", exampleStatus: 200 },
  { method: "get", path: "/claims/index.html", operationId: "getClaimsHtml", summary: "Human claims mirror.", html: true, example: "/claims/index.html" },
];

for (const file of SCHEMA_FILES) {
  API_ROUTES.push({
    method: "get",
    path: `/schema/${file}`,
    operationId: `getSchema_${file.replace(/[^a-z0-9]+/gi, "_")}`,
    summary: `JSON Schema ${file}.`,
    schema: "JsonSchemaDocument",
    example: `/schema/${file}`,
  });
}

function segmentMatch(actual, template) {
  if (!template.includes("{")) return actual === template;
  const pattern = template
    .replace(/[.*+?^$|()[\]\\]/g, "\\$&")
    .replace(/\{[^}]+\}/g, "[a-z0-9][a-z0-9_-]{0,80}");
  return new RegExp(`^${pattern}$`).test(actual);
}

export function pathMatchesTemplate(pathname, template) {
  const left = pathname.split("/").filter(Boolean);
  const right = template.split("/").filter(Boolean);
  if (left.length !== right.length) return false;
  return left.every((part, i) => segmentMatch(part, right[i]));
}

export function matchApiRoute(pathname, method) {
  const verb = String(method || "GET").toLowerCase();
  return API_ROUTES.find((route) => route.method === verb && pathMatchesTemplate(pathname, route.path)) || null;
}

function jsonHeaders() {
  return {
    "X-API-Version": { $ref: "#/components/headers/ApiVersion" },
    ETag: { $ref: "#/components/headers/ETag" },
    "Access-Control-Allow-Origin": { $ref: "#/components/headers/AllowOrigin" },
  };
}

function jsonContent(schemaName) {
  return {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  };
}

function gateResponses() {
  return {
    "401": { $ref: "#/components/responses/InvalidKey" },
    "429": { $ref: "#/components/responses/RateLimited" },
  };
}

function operationFor(route) {
  if (route.claimsPost) return claimsPostOperation(route);
  if (route.mcpPost) return mcpPostOperation(route);
  if (route.portrait) return portraitOperation(route);
  const op = {
    operationId: route.operationId,
    summary: route.summary,
    parameters: [...(route.params || []), ...(route.query || [])],
    responses: {
      "200": route.atom
        ? { description: "application/atom+xml", headers: jsonHeaders(), content: { "application/atom+xml": { schema: { type: "string" } } } }
        : route.text
          ? { description: "text/plain", headers: jsonHeaders(), content: { "text/plain": { schema: { type: "string" } } } }
          : route.html
            ? { description: "text/html", headers: jsonHeaders(), content: { "text/html": { schema: { type: "string" } } } }
            : { description: "OK", headers: jsonHeaders(), content: jsonContent(route.schema) },
      "404": { $ref: "#/components/responses/NotFound" },
      ...gateResponses(),
    },
  };
  if (!op.parameters.length) delete op.parameters;
  if (route.badRequest) {
    op.responses["400"] = {
      description: route.badRequest,
      content: jsonContent("Error"),
    };
  }
  return op;
}

function claimsPostOperation(route) {
  return {
    operationId: route.operationId,
    summary: route.summary,
    description:
      "No API key. Authorization and X-API-Key are ignored and do not change the quota. Requires statement (1–2000 chars), 1–8 https sources, and game_id. Body max 16384 bytes. Rate limit is the existing CLAIMS KV limiter: 10 posts per IP per Asia/Shanghai hour and 100 per calendar day. This limiter is not the public /v1 read limiter. Stored rows are untrusted until a human reviews them. There is no pending queue.",
    security: [],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimInput" } } },
    },
    responses: {
      "201": {
        description: "Stored. Untrusted until a human reviews it.",
        headers: { "X-API-Version": { $ref: "#/components/headers/ApiVersion" } },
        content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimCreated" } } },
      },
      "400": {
        description: "Missing or invalid statement, game_id, or source.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimsError" } } },
      },
      "413": {
        description: "Body too large (max 16384 bytes).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimsError" } } },
      },
      "429": {
        description: "Claims limiter: 10 per IP per hour, or 100 per day. Body keeps scope and limit. Not the public read limiter.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimsError" } } },
      },
      "503": {
        description: "Claims KV binding is not configured.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ClaimsError" } } },
      },
    },
  };
}

function mcpPostOperation(route) {
  return {
    operationId: route.operationId,
    summary: route.summary,
    description:
      "Streamable HTTP JSON-RPC. Protocol errors stay JSON-RPC. HTTP 401 and 429 from the public gate use the unified Error body, not a JSON-RPC envelope. Tools are read-only and include list_banners, list_codes, and personal_digest for the eight deep games.",
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcRequest" } } },
    },
    responses: {
      "200": {
        description: "JSON-RPC result.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } },
      },
      "400": { description: "JSON-RPC parse or protocol error." },
      "401": { $ref: "#/components/responses/InvalidKey" },
      "403": { description: "Origin not allowed." },
      "405": { description: "GET is not an SSE stream. Use POST." },
      "429": { $ref: "#/components/responses/RateLimited" },
    },
  };
}

function portraitOperation(route) {
  return {
    operationId: route.operationId,
    summary: route.summary,
    parameters: [
      {
        name: "u",
        in: "query",
        required: true,
        description: "Absolute https image URL on an allowlisted host. Query strings are rejected.",
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": {
        description: "Image bytes.",
        headers: jsonHeaders(),
        content: {
          "image/png": { schema: { type: "string", format: "binary" } },
          "image/jpeg": { schema: { type: "string", format: "binary" } },
          "image/webp": { schema: { type: "string", format: "binary" } },
          "image/gif": { schema: { type: "string", format: "binary" } },
        },
      },
      "400": { description: "rejected_url. text/plain, not the JSON error body.", content: { "text/plain": { schema: { type: "string" } } } },
      "405": { description: "POST is rejected." },
      ...gateResponses(),
    },
  };
}

function buildPaths() {
  const paths = {};
  for (const route of API_ROUTES) {
    const item = paths[route.path] || {};
    item[route.method] = operationFor(route);
    paths[route.path] = item;
  }
  return paths;
}

let cached;

export function openApiDocument() {
  if (cached) return cached;
  cached = {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "game-intel",
      version: API_VERSION,
      summary: "Public read API and remote MCP for published game-intel JSON.",
      description: [
        "Anonymous reads are allowed. An optional API key (X-API-Key or Authorization: Bearer) raises the /v1 and /mcp limit.",
        `Anonymous: ${ANON_LIMIT} requests per ${LIMIT_PERIOD} seconds per IP. Key: ${KEY_LIMIT} per ${LIMIT_PERIOD} seconds per key.`,
        "Limits are enforced only when the Worker rate-limit bindings exist, and counters are per Cloudflare location. Over limit: HTTP 429 and Retry-After.",
        "A presented key that is not in the GAME_INTEL_API_KEYS secret is HTTP 401. The secret is not in the repository.",
        "POST /v1/claims ignores that key and keeps its own KV limiter (10 per IP per Asia/Shanghai hour, 100 per day). CLAIMS_API_KEY is not required.",
        "Responses send X-API-Version: 1. Published JSON bodies are not wrapped. Health and gate errors include api_version.",
        "Gate errors are {ok:false, error, message, api_version, status}. Claims submission errors keep their existing body. MCP protocol errors stay JSON-RPC.",
        `Deep games / 深耕: ${DEEP}. Banners and codes keep the source URL and an explicit status. Do not invent rates, prices, or skill numbers.`,
        "Source priority: official > review sites > forums. If the JSON does not support a claim, say 未见可靠出处.",
        "MIT covers this site's code. Facts, names, and portraits stay attributed to the https sources stored on each row.",
        "Developer page: /developers/.",
      ].join(" "),
    },
    servers: [{ url: PUBLIC_ORIGIN, description: "Hosted Worker" }],
    security: [{}, { apiKey: [] }, { bearer: [] }],
    tags: [
      { name: "meta" },
      { name: "catalog" },
      { name: "intel" },
      { name: "guides" },
      { name: "personal" },
      { name: "claims" },
      { name: "mcp" },
    ],
    paths: buildPaths(),
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Optional. Higher /v1 and /mcp limit. Not used by POST /v1/claims." },
        bearer: { type: "http", scheme: "bearer", description: "Optional. Same keys as X-API-Key. Not used by POST /v1/claims." },
      },
      headers: {
        ApiVersion: { description: "Public API version.", schema: { type: "string", const: API_VERSION }, required: true },
        ETag: { description: "Strong validator for GET JSON and other 200 responses.", schema: { type: "string" } },
        AllowOrigin: { schema: { type: "string", const: "*" } },
        RetryAfter: { description: "Seconds to wait. Equals the rate-limit period.", schema: { type: "integer", const: LIMIT_PERIOD } },
      },
      responses: {
        InvalidKey: {
          description: "A key was sent and it is not in GAME_INTEL_API_KEYS.",
          headers: { "X-API-Version": { $ref: "#/components/headers/ApiVersion" } },
          content: jsonContent("Error"),
        },
        RateLimited: {
          description: `Public limiter. Retry-After is ${LIMIT_PERIOD}. Not used for POST /v1/claims.`,
          headers: {
            "Retry-After": { $ref: "#/components/headers/RetryAfter" },
            "X-API-Version": { $ref: "#/components/headers/ApiVersion" },
          },
          content: jsonContent("Error"),
        },
        NotFound: {
          description: "No published document at this path.",
          content: jsonContent("Error"),
        },
      },
      schemas: {
        Error: {
          type: "object",
          additionalProperties: true,
          required: ["ok", "error", "message", "api_version", "status"],
          properties: {
            ok: { const: false },
            error: { type: "string", examples: ["rate_limited", "invalid_api_key", "not_found", "method_not_allowed"] },
            message: { type: "string" },
            api_version: { const: API_VERSION },
            status: { type: "integer" },
            tier: { enum: ["anonymous", "key"] },
            limit: { type: "integer" },
            retry_after: { type: "integer" },
          },
        },
        ClaimsError: {
          type: "object",
          additionalProperties: true,
          required: ["ok", "error"],
          description: "Existing claims submission error. Unchanged. 429 includes scope and limit.",
          properties: {
            ok: { const: false },
            error: { type: "string" },
            scope: { enum: ["ip", "day"] },
            limit: { type: "integer" },
            max_bytes: { type: "integer" },
          },
        },
        Health: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "api_version", "service", "timezone", "openapi", "developers", "mcp", "rate_limit"],
          properties: {
            ok: { const: true },
            api_version: { const: API_VERSION },
            service: { const: "game-intel" },
            timezone: { const: "Asia/Shanghai" },
            openapi: { const: "/v1/openapi.json" },
            developers: { const: "/developers/" },
            mcp: { const: "/mcp" },
            rate_limit: { enum: ["active", "partial", "degraded"], description: "degraded means a rate-limit binding is missing and requests are allowed." },
          },
        },
        OpenApiDocument: { type: "object", additionalProperties: true, description: "This document." },
        JsonSchemaDocument: { type: "object", additionalProperties: true },
        ClaimInput: embed(claimSchema),
        ClaimsIndex: embed(claimsIndexSchema),
        ClaimCreated: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "claim"],
          properties: {
            ok: { const: true },
            claim: { $ref: "#/components/schemas/StoredClaim" },
          },
        },
        StoredClaim: {
          type: "object",
          additionalProperties: true,
          required: ["id", "statement", "sources", "game_id", "as_of", "submitted_at", "timezone"],
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
            sources: { type: "array", items: { type: "string", format: "uri" } },
            game_id: { type: "string" },
            character_id: { type: "string" },
            as_of: { type: "string" },
            submitted_at: { type: "string" },
            timezone: { const: "Asia/Shanghai" },
            submitter: { type: "string" },
          },
        },
        Game: embed(gameSchema),
        GamesIndex: embed(gamesIndexSchema),
        CatalogAliases: embed(catalogAliasesSchema),
        Feed: embed(feedSchema),
        Watchlist: embed(watchlistSchema),
        Digest: embed(digestSchema),
        Calendar: embed(calendarSchema),
        GuidesIndex: embed(guidesIndexSchema),
        CharacterCard: embed(characterCardSchema),
        Aliases: embed(aliasesSchema),
        Personal: embed(personalSchema),
        Planner: {
          type: "object",
          additionalProperties: true,
          required: ["ok", "derived", "stored", "today", "timezone", "games"],
          properties: {
            ok: { const: true },
            derived: { const: true },
            stored: { const: false },
            today: { type: "string", description: "Asia/Shanghai YYYY-MM-DD used as day zero." },
            timezone: { const: "Asia/Shanghai" },
            day_basis: { type: "string" },
            pull_math: { type: "string" },
            games: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["game", "timeline_only", "banners", "calendar", "codes"],
                properties: {
                  game: { type: "string" },
                  name: { type: "string" },
                  name_zh: { type: "string" },
                  timeline_only: { type: "boolean", description: "True when no current or future banner states a summon count." },
                  pull_math: { enum: ["timeline_only", "cited_summons"] },
                  banners: { type: "array", items: { type: "object", additionalProperties: true } },
                  calendar: { type: "array", items: { type: "object", additionalProperties: true } },
                  codes: { type: "array", items: { type: "object", additionalProperties: true } },
                },
              },
            },
          },
        },
        Compare: {
          type: "object",
          additionalProperties: true,
          required: ["ok", "derived", "stored", "game", "count", "gap", "columns", "rows"],
          properties: {
            ok: { const: true },
            derived: { const: true },
            stored: { const: false },
            game: { type: "string" },
            count: { type: "integer", minimum: 2, maximum: 4 },
            gap: { const: "暂无出处", description: "Phrase for an empty field. Cell values stay null instead of being filled." },
            columns: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["game", "id", "name"],
                properties: {
                  game: { type: "string" },
                  id: { type: "string" },
                  name: { type: "string" },
                  path: { type: "string" },
                },
              },
            },
            rows: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["section", "key", "cells"],
                properties: {
                  section: { enum: ["attributes", "rating", "teams", "skills"] },
                  key: { type: "string" },
                  cells: { type: "array" },
                },
              },
            },
          },
        },
        GuideGameIndex: {
          type: "object",
          additionalProperties: true,
          required: ["game", "as_of", "characters"],
          properties: {
            game: { type: "string" },
            name: { type: "string" },
            name_zh: { type: "string" },
            as_of: { type: "string" },
            timezone: { type: "string" },
            character_count: { type: "integer", minimum: 0 },
            links: {
              type: "object",
              additionalProperties: true,
              properties: {
                banners: { type: "string" },
                codes: { type: "string" },
              },
            },
            characters: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["id", "name"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  name_zh: { type: "string" },
                  stub: { type: "boolean" },
                  sources: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        Banners: {
          type: "object",
          additionalProperties: true,
          required: ["game", "as_of", "banners"],
          properties: {
            game: { type: "string" },
            as_of: { type: "string" },
            timezone_note: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            banners: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["name"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  kind: { type: "string" },
                  status: { type: "string", description: "Known values include current, upcoming, ended." },
                  up: { type: "array", items: { type: "string" } },
                  up_characters: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: true,
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        label: { type: "string" },
                      },
                    },
                  },
                  start: { type: "string" },
                  end: { type: "string" },
                  source: { type: "string" },
                  as_of: { type: "string" },
                },
              },
            },
          },
        },
        Codes: {
          type: "object",
          additionalProperties: true,
          required: ["game", "as_of", "codes"],
          properties: {
            game: { type: "string" },
            as_of: { type: "string" },
            checked: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            redeem_url: { type: "string", description: "Publisher page, when one was published. This API does not redeem." },
            codes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  code: { type: "string" },
                  rewards: { type: "string" },
                  status: {
                    type: "string",
                    description: "Known values: active, reported_working, listed_permanent, expired, expiry_not_stated, window_stated_without_year. Do not treat expired or expiry_not_stated as live.",
                  },
                  expires: {},
                  source: { type: "string" },
                  checked: { type: "string" },
                },
              },
            },
          },
        },
        Radar: {
          type: "object",
          additionalProperties: true,
          properties: {
            ok: { type: "boolean" },
            count: { type: "integer" },
            keywords: { type: "array", items: { type: "string" } },
            meta: { type: "object", additionalProperties: true },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  source: { type: "string" },
                  why: { type: "string" },
                },
              },
            },
          },
        },
        DopamineAuto: {
          type: "object",
          additionalProperties: true,
          required: ["id", "game", "teams"],
          properties: {
            id: { type: "string" },
            game: { const: "hw" },
            name: { type: "string" },
            as_of: { type: "string" },
            teams: { type: "array" },
          },
        },
        AiCatalog: {
          type: "object",
          additionalProperties: false,
          required: ["specVersion", "entries"],
          properties: {
            specVersion: { const: "1.0" },
            entries: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["identifier", "type", "url"],
                properties: {
                  identifier: { type: "string" },
                  type: { const: "application/mcp-server-card+json" },
                  url: { type: "string" },
                },
              },
            },
          },
        },
        ServerCard: {
          type: "object",
          additionalProperties: true,
          required: ["name", "version", "title", "description", "remotes"],
          properties: {
            name: { type: "string" },
            version: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            websiteUrl: { type: "string" },
            remotes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["type", "url"],
                properties: {
                  type: { const: "streamable-http" },
                  url: { type: "string" },
                  supportedProtocolVersions: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        JsonRpcRequest: {
          type: "object",
          additionalProperties: true,
          required: ["jsonrpc", "method"],
          properties: {
            jsonrpc: { const: "2.0" },
            id: {},
            method: { type: "string" },
            params: { type: "object", additionalProperties: true },
          },
        },
        JsonRpcResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            jsonrpc: { const: "2.0" },
            id: {},
            result: {},
            error: {},
          },
        },
      },
    },
  };
  return cached;
}
