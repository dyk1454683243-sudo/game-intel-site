import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DEEP_GAMES } from "../src/deep-games.js";
import { TOOLS, callTool } from "../src/mcp.js";
import {
  API_ROUTES,
  SCHEMA_FILES,
  matchApiRoute,
  openApiDocument,
  pathMatchesTemplate,
} from "../src/openapi.js";
import { RATE_LIMIT_GLOBAL_DAY, RATE_LIMIT_PER_IP } from "../src/claims.js";
import {
  ANON_LIMIT,
  API_VERSION,
  KEY_LIMIT,
  LIMIT_PERIOD,
} from "../src/public-limit.js";
import { handleRequest } from "../src/worker.js";
import { DEEP_GAMES as UI_DEEP_GAMES } from "../public/ui/render.js";

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(site, "public");
const origin = "http://127.0.0.1:8787";

function assets() {
  return {
    async fetch(req) {
      let rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) return new Response("no", { status: 403 });
      try {
        const buf = readFileSync(file);
        return new Response(buf, { status: 200 });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  };
}

function memoryKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function limiter(limit, { throwOnLimit = false } = {}) {
  const counts = new Map();
  return {
    async limit({ key }) {
      if (throwOnLimit) throw new Error("binding down");
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

function env(extra = {}) {
  return { ASSETS: assets(), CLAIMS: memoryKv(), ...extra };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

test("deep game list stays aligned with the human UI", () => {
  assert.deepEqual([...DEEP_GAMES], [...UI_DEEP_GAMES]);
  assert.equal(DEEP_GAMES.length, 8);
});

test("openapi 3.1 lists the same operations the worker publishes", () => {
  const doc = openApiDocument();
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, API_VERSION);
  const documented = new Set();
  for (const [pathname, item] of Object.entries(doc.paths)) {
    for (const method of ["get", "post", "put", "delete", "patch", "head", "options"]) {
      if (item[method]) documented.add(`${method} ${pathname}`);
    }
  }
  const expected = new Set(API_ROUTES.map((route) => `${route.method} ${route.path}`));
  assert.deepEqual(documented, expected);
  for (const route of API_ROUTES) {
    if (!route.schema) continue;
    assert.ok(doc.components.schemas[route.schema], route.schema);
  }
  assert.equal(doc.components.schemas.Error.required.includes("api_version"), true);
  assert.equal(doc.paths["/v1/claims"].post.security.length, 0);
  assert.match(doc.paths["/v1/claims"].post.description, /No API key/);
  assert.equal(doc.components.schemas.Health.properties.api_version.const, "1");
  for (const id of DEEP_GAMES) {
    assert.match(doc.info.description, new RegExp(id));
  }
});

test("published openapi files match the generator", () => {
  const pretty = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
  assert.equal(readFileSync(path.join(root, "openapi.json"), "utf8"), pretty);
  assert.equal(readFileSync(path.join(root, "v1", "openapi.json"), "utf8"), pretty);
});

test("every published /v1 and /schema JSON file is in the OpenAPI path set", () => {
  const gets = API_ROUTES.filter((route) => route.method === "get").map((route) => route.path);
  const files = [
    ...walk(path.join(root, "v1")).filter((file) => file.endsWith(".json")),
    ...walk(path.join(root, "schema")).filter((file) => file.endsWith(".json")),
  ];
  const misses = [];
  for (const file of files) {
    const pathname = `/${path.relative(root, file).split(path.sep).join("/")}`;
    if (!gets.some((template) => pathMatchesTemplate(pathname, template))) misses.push(pathname);
  }
  assert.deepEqual(misses, []);
  for (const file of SCHEMA_FILES) {
    assert.equal(matchApiRoute(`/schema/${file}`, "GET").path, `/schema/${file}`);
  }
});

test("live routes answer with the documented status, version, and cache headers", async () => {
  const e = env();
  for (const route of API_ROUTES) {
    if (route.skipLive) continue;
    const expected = route.exampleStatus || 200;
    let request;
    if (route.mcpPost) {
      request = new Request(`${origin}${route.example}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }),
      });
    } else {
      request = new Request(`${origin}${route.example}`);
    }
    const res = await handleRequest(request, e);
    assert.equal(res.status, expected, `${route.method} ${route.path}`);
    if (route.path.startsWith("/v1/") || route.path === "/mcp" || route.path === "/openapi.json") {
      assert.equal(res.headers.get("x-api-version"), API_VERSION, route.path);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    }
    if (expected === 200 && route.schema && route.path.startsWith("/v1/") && route.path.endsWith(".json")) {
      assert.match(res.headers.get("etag") || "", /^"[0-9a-f]+"$/, route.path);
      assert.match(res.headers.get("cache-control") || "", /public|no-store/, route.path);
    }
  }
});

test("health, etag revalidation, unknown paths, and method errors", async () => {
  const e = env();
  const health = await handleRequest(new Request(`${origin}/v1/health`), e);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.api_version, "1");
  assert.equal(body.rate_limit, "degraded");
  assert.equal(body.service, "game-intel");

  const spec = await handleRequest(new Request(`${origin}/v1/openapi.json`), e);
  assert.deepEqual(await spec.json(), openApiDocument());

  const first = await handleRequest(new Request(`${origin}/v1/games/index.json`), e);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.match(first.headers.get("cache-control"), /max-age=300/);
  const again = await handleRequest(
    new Request(`${origin}/v1/games/index.json`, { headers: { "if-none-match": etag } }),
    e
  );
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal(again.headers.get("etag"), etag);

  const missing = await handleRequest(new Request(`${origin}/v1/no-such-document.json`), e);
  assert.equal(missing.status, 404);
  const err = await missing.json();
  assert.equal(err.ok, false);
  assert.equal(err.error, "not_found");
  assert.equal(err.api_version, "1");
  assert.equal(err.status, 404);
  assert.equal(typeof err.message, "string");
  assert.equal(missing.headers.get("cache-control"), "no-store");

  const posted = await handleRequest(new Request(`${origin}/v1/games/index.json`, { method: "POST" }), e);
  assert.equal(posted.status, 405);
  assert.equal((await posted.json()).error, "method_not_allowed");

  const opt = await handleRequest(new Request(`${origin}/v1/health`, { method: "OPTIONS" }), e);
  assert.equal(opt.status, 204);
  assert.match(opt.headers.get("access-control-allow-headers"), /X-API-Key/);
});

test("anonymous rate limit returns 429 and Retry-After; a missing or throwing binding allows the call", async () => {
  const limited = env({ RATE_LIMIT_ANON: limiter(2) });
  const ip = { "cf-connecting-ip": "203.0.113.8" };
  for (let i = 0; i < 2; i++) {
    const res = await handleRequest(new Request(`${origin}/v1/health`, { headers: ip }), limited);
    assert.equal(res.status, 200, `allowed ${i}`);
  }
  const blocked = await handleRequest(new Request(`${origin}/v1/health`, { headers: ip }), limited);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), String(LIMIT_PERIOD));
  const body = await blocked.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "rate_limited");
  assert.equal(body.api_version, "1");
  assert.equal(body.status, 429);
  assert.equal(body.tier, "anonymous");
  assert.equal(body.limit, ANON_LIMIT);
  assert.equal(body.retry_after, LIMIT_PERIOD);
  assert.equal(blocked.headers.get("access-control-allow-origin"), "*");

  const other = await handleRequest(
    new Request(`${origin}/v1/health`, { headers: { "cf-connecting-ip": "203.0.113.9" } }),
    limited
  );
  assert.equal(other.status, 200);

  const open = env();
  for (let i = 0; i < 3; i++) {
    assert.equal((await handleRequest(new Request(`${origin}/v1/health`), open)).status, 200);
  }
  const thrown = env({ RATE_LIMIT_ANON: limiter(1, { throwOnLimit: true }) });
  assert.equal((await handleRequest(new Request(`${origin}/v1/digest.json`), thrown)).status, 200);
});

test("a valid key uses the higher bucket; a bad key is 401 and does not spend the anonymous bucket", async () => {
  const anon = limiter(1);
  const keyed = limiter(3);
  const e = env({
    RATE_LIMIT_ANON: anon,
    RATE_LIMIT_KEY: keyed,
    GAME_INTEL_API_KEYS: "test-key-public-not-real, second-test-key",
  });
  const headers = { "x-api-key": "test-key-public-not-real", "cf-connecting-ip": "198.51.100.4" };
  for (let i = 0; i < 3; i++) {
    const res = await handleRequest(new Request(`${origin}/v1/feed.json`, { headers }), e);
    assert.equal(res.status, 200, `keyed ${i}`);
  }
  const over = await handleRequest(new Request(`${origin}/v1/feed.json`, { headers }), e);
  assert.equal(over.status, 429);
  const overBody = await over.json();
  assert.equal(overBody.tier, "key");
  assert.equal(overBody.limit, KEY_LIMIT);

  const bearer = await handleRequest(
    new Request(`${origin}/v1/radar.json`, {
      headers: { authorization: "Bearer second-test-key", "cf-connecting-ip": "198.51.100.4" },
    }),
    env({
      RATE_LIMIT_ANON: limiter(1),
      RATE_LIMIT_KEY: limiter(1),
      GAME_INTEL_API_KEYS: "second-test-key",
    })
  );
  assert.equal(bearer.status, 200);

  const badEnv = env({ RATE_LIMIT_ANON: limiter(1), GAME_INTEL_API_KEYS: "test-key-public-not-real" });
  const bad = await handleRequest(
    new Request(`${origin}/v1/health`, { headers: { authorization: "Bearer not-the-key", "cf-connecting-ip": "198.51.100.8" } }),
    badEnv
  );
  assert.equal(bad.status, 401);
  const badBody = await bad.json();
  assert.equal(badBody.error, "invalid_api_key");
  assert.equal(badBody.api_version, "1");
  assert.equal(bad.headers.get("retry-after"), null);
  const still = await handleRequest(
    new Request(`${origin}/v1/health`, { headers: { "cf-connecting-ip": "198.51.100.8" } }),
    badEnv
  );
  assert.equal(still.status, 200);
});

test("claims submission ignores the public key and the public limiter", async () => {
  const claimsSrc = readFileSync(path.join(site, "src/claims.js"), "utf8");
  assert.equal(RATE_LIMIT_PER_IP, 10);
  assert.equal(RATE_LIMIT_GLOBAL_DAY, 100);
  assert.doesNotMatch(claimsSrc, /GAME_INTEL_API_KEYS/);
  assert.match(claimsSrc, /RATE_LIMIT_PER_IP = 10/);

  const e = env({
    RATE_LIMIT_ANON: limiter(1),
    GAME_INTEL_API_KEYS: "test-key-public-not-real",
    CLAIMS_API_KEY: "test-key-not-real",
  });
  const first = await handleRequest(new Request(`${origin}/v1/health`, { headers: { "cf-connecting-ip": "203.0.113.20" } }), e);
  assert.equal(first.status, 200);
  const second = await handleRequest(new Request(`${origin}/v1/health`, { headers: { "cf-connecting-ip": "203.0.113.20" } }), e);
  assert.equal(second.status, 429);

  const post = (statement, headers = {}) =>
    new Request(`${origin}/v1/claims`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20", ...headers },
      body: JSON.stringify({
        statement,
        sources: ["https://www.gamekee.com/hw/634407.html"],
        game_id: "hw",
      }),
    });
  const created = await handleRequest(post("Bearer is ignored", { authorization: "Bearer wrong-key" }), e);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.ok, true);
  assert.equal(createdBody.api_version, undefined);
  assert.equal(created.headers.get("x-api-version"), "1");

  const fresh = env();
  for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
    const res = await handleRequest(post(`n${i}`, { "cf-connecting-ip": "203.0.113.21" }), fresh);
    assert.equal(res.status, 201, `claim ${i}`);
  }
  const capped = await handleRequest(post("over", { "cf-connecting-ip": "203.0.113.21" }), fresh);
  assert.equal(capped.status, 429);
  const cappedBody = await capped.json();
  assert.equal(cappedBody.error, "rate_limited");
  assert.equal(cappedBody.scope, "ip");
  assert.equal(cappedBody.limit, RATE_LIMIT_PER_IP);
  assert.equal(cappedBody.message, undefined);
});

test("wrangler declares the public limiters and does not retarget CLAIMS", () => {
  const toml = readFileSync(path.join(site, "wrangler.toml"), "utf8");
  assert.match(toml, /name = "RATE_LIMIT_ANON"/);
  assert.match(toml, /namespace_id = "71001"/);
  assert.match(toml, new RegExp(`limit = ${ANON_LIMIT}\\b`));
  assert.match(toml, /name = "RATE_LIMIT_KEY"/);
  assert.match(toml, /namespace_id = "71002"/);
  assert.match(toml, new RegExp(`limit = ${KEY_LIMIT}\\b`));
  assert.match(toml, /period = 60/);
  assert.match(toml, /GAME_INTEL_API_KEYS/);
  assert.match(toml, /id = "c5d31aef615e4fb19a933f661d5ed72e"/);
  assert.doesNotMatch(toml, /GAME_INTEL_API_KEYS\s*=\s*"[^"]+"/);
});

test("MCP tools are bilingual, schematized, and cover banners, codes, and personal digest", async () => {
  const names = TOOLS.map((tool) => tool.name);
  for (const name of ["list_banners", "list_codes", "personal_digest", "list_games", "get_guide", "list_claims"]) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of TOOLS) {
    assert.match(tool.description, /[\u4e00-\u9fff]/, tool.name);
    assert.match(tool.description, /[A-Za-z]{3,}/, tool.name);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
    for (const prop of Object.values(tool.inputSchema.properties)) {
      assert.equal(typeof prop.type, "string", tool.name);
      assert.equal(typeof prop.description, "string", tool.name);
    }
  }
  const banners = TOOLS.find((tool) => tool.name === "list_banners");
  const codes = TOOLS.find((tool) => tool.name === "list_codes");
  const personal = TOOLS.find((tool) => tool.name === "personal_digest");
  assert.deepEqual(banners.inputSchema.required, ["game"]);
  assert.deepEqual(codes.inputSchema.required, ["game"]);
  assert.ok(personal.inputSchema.properties.code);
  assert.ok(personal.inputSchema.properties.games);
  assert.ok(personal.inputSchema.properties.chars);
  for (const id of DEEP_GAMES) {
    assert.match(banners.description, new RegExp(id));
    assert.match(codes.description, new RegExp(id));
    assert.match(personal.description, new RegExp(id));
    const bannerRes = await callTool(env(), origin, "list_banners", { game: id });
    const bannerData = JSON.parse(bannerRes.content[0].text);
    assert.equal(bannerRes.isError, false, id);
    assert.equal(bannerData.data.game, id);
    assert.ok(Array.isArray(bannerData.data.banners), id);
    const codeRes = await callTool(env(), origin, "list_codes", { game: id });
    const codeData = JSON.parse(codeRes.content[0].text);
    assert.equal(codeRes.isError, false, id);
    assert.equal(codeData.data.game, id);
    assert.ok(Array.isArray(codeData.data.codes), id);
  }
  const digest = await callTool(env(), origin, "personal_digest", { games: "hw", chars: "hw:ai_mi_li_ya" });
  const doc = JSON.parse(digest.content[0].text);
  assert.equal(doc.stored, false);
  assert.equal(doc.ok, true);
});

test("developer page and llms.txt point at the public contract", () => {
  const html = readFileSync(path.join(root, "developers/index.html"), "utf8");
  assert.match(html, /开发者/);
  assert.match(html, /Developers/);
  assert.match(html, /\/v1\/openapi\.json/);
  assert.match(html, /Retry-After/);
  assert.match(html, /X-API-Key/);
  assert.match(html, /mcpServers/);
  assert.match(html, /mcp-remote/);
  assert.match(html, /streamable HTTP|Streamable HTTP/);
  assert.match(html, /未见可靠出处/);
  assert.match(html, /MIT/);
  assert.match(html, /POST \/v1\/claims/);
  assert.doesNotMatch(html, /sk_live_|AKIA[0-9A-Z]{8}/);
  for (const id of DEEP_GAMES) assert.match(html, new RegExp(id));

  const source = readFileSync(path.join(site, "llms.txt"), "utf8");
  const published = readFileSync(path.join(root, "llms.txt"), "utf8");
  assert.equal(source, published);
  assert.match(source, /\/developers\//);
  assert.match(source, /\/v1\/openapi\.json/);
  assert.match(source, /GAME_INTEL_API_KEYS/);
  assert.match(source, /POST \/v1\/claims` does not use this key/);
});
