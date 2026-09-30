import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { route } from "../src/worker.js";
import { formatShanghai } from "../src/time.js";
import {
  GLOBAL_RATE_PREFIX,
  MAX_BODY_BYTES,
  RATE_LIMIT_GLOBAL_DAY,
  RATE_LIMIT_PER_IP,
} from "../src/claims.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const origin = "http://127.0.0.1:8787";

function assets() {
  return {
    async fetch(req) {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) return new Response("no", { status: 403 });
      try {
        const buf = await readFile(file);
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

function env() {
  return { ASSETS: assets(), CLAIMS: memoryKv(), CLAIMS_API_KEY: "test-key-not-real" };
}

async function jsonOf(res) {
  return JSON.parse(await res.text());
}

test("discovery alias matches the AI catalog", async () => {
  const e = env();
  const mcp = await route(new Request(`${origin}/.well-known/mcp.json`), e);
  const cat = await route(new Request(`${origin}/.well-known/ai-catalog.json`), e);
  assert.equal(mcp.status, 200);
  assert.equal(mcp.headers.get("content-type"), "application/ai-catalog+json; charset=utf-8");
  const body = await jsonOf(mcp);
  assert.deepEqual(body, await jsonOf(cat));
  assert.equal(body.entries[0].type, "application/mcp-server-card+json");
  assert.equal(body.entries[0].url, `${origin}/mcp/server-card`);
});

test("server card points at streamable HTTP /mcp", async () => {
  const res = await route(new Request(`${origin}/mcp/server-card`), env());
  const card = await jsonOf(res);
  assert.equal(res.headers.get("content-type"), "application/mcp-server-card+json; charset=utf-8");
  assert.equal(card.name, "ai.game-intel/public");
  assert.equal(card.remotes[0].type, "streamable-http");
  assert.equal(card.remotes[0].url, `${origin}/mcp`);
  assert.ok(card.remotes[0].supportedProtocolVersions.includes("2026-07-28"));
});

test("legacy initialize and tools/list", async () => {
  const e = env();
  const init = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    }),
    e
  );
  const initBody = await jsonOf(init);
  assert.equal(initBody.result.protocolVersion, "2025-11-25");
  assert.equal(initBody.result.capabilities.tools.listChanged, false);

  const list = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }),
    e
  );
  const tools = (await jsonOf(list)).result.tools.map((t) => t.name);
  assert.ok(tools.includes("digest"));
  assert.ok(tools.includes("get_guide"));
  assert.ok(!tools.includes("add_watch"));
});

test("modern tools/call reads published game JSON", async () => {
  const res = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "get_game",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_game",
          arguments: { id: "hw" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }),
    env()
  );
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  const data = JSON.parse(body.result.content[0].text);
  assert.equal(data.data.id, "hw");
  assert.equal(data.path, "/v1/games/hw.json");
});

test("modern header mismatch is rejected", async () => {
  const res = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "digest",
          _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
        },
      }),
    }),
    env()
  );
  assert.equal(res.status, 400);
  assert.equal((await jsonOf(res)).error.code, -32020);
});

test("GET /mcp is not an SSE stream", async () => {
  const res = await route(new Request(`${origin}/mcp`), env());
  assert.equal(res.status, 405);
});

function claimBody(overrides = {}) {
  return {
    statement: "HW card lists sources",
    sources: ["https://www.gamekee.com/hw/634407.html"],
    game_id: "hw",
    character_id: "a_la_ha",
    as_of: "2026-09-25",
    submitter: "example-agent",
    ...overrides,
  };
}

function postClaim(body, headers = {}) {
  return new Request(`${origin}/v1/claims`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("claims: public submit, hard sources, then read-only mirror", async () => {
  const e = { ASSETS: assets(), CLAIMS: memoryKv() };
  const anon = await route(postClaim(claimBody()), e);
  assert.equal(anon.status, 201);
  const created = await jsonOf(anon);
  assert.equal(created.claim.timezone, "Asia/Shanghai");
  assert.equal(created.claim.game_id, "hw");
  assert.ok(created.claim.submitted_at.endsWith("+08:00"));

  const ignoredKey = await route(
    postClaim(claimBody({ statement: "Bearer is ignored" }), {
      authorization: "Bearer wrong-key",
    }),
    { ...e, CLAIMS_API_KEY: "test-key-not-real" }
  );
  assert.equal(ignoredKey.status, 201);

  const mirror = await route(new Request(`${origin}/v1/claims.json`), e);
  const listed = await jsonOf(mirror);
  assert.equal(listed.count, 2);
  assert.equal(listed.claims[0].statement, "Bearer is ignored");
  assert.equal(listed.claims[1].statement, "HW card lists sources");

  const page = await route(new Request(`${origin}/claims/index.html`), e);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  const html = await page.text();
  assert.match(html, /HW card lists sources/);
  assert.match(html, /不可信/);

  const listedTool = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_claims", arguments: {} } }),
    }),
    e
  );
  const toolBody = await jsonOf(listedTool);
  const toolData = JSON.parse(toolBody.result.content[0].text);
  assert.equal(toolData.count, 2);
  assert.equal(toolData.claims[1].statement, "HW card lists sources");
});

test("claims: reject missing game, bad sources, and oversized bodies", async () => {
  const e = env();
  const cases = [
    [{ statement: "no sources", game_id: "hw" }, 400, "sources_required"],
    [{ statement: "no game", sources: ["https://www.gamekee.com/hw/634407.html"] }, 400, "game_id_required"],
    [claimBody({ sources: [""] }), 400, "invalid_source"],
    [claimBody({ sources: ["javascript:alert(1)"] }), 400, "invalid_source"],
    [claimBody({ sources: ["data:text/html,hi"] }), 400, "invalid_source"],
    [claimBody({ sources: ["http://store.steampowered.com/app/2379780/"] }), 400, "invalid_source"],
    [claimBody({ sources: ["https://example.com/source"] }), 400, "invalid_source"],
    [claimBody({ sources: ["https://localhost/a"] }), 400, "invalid_source"],
    [claimBody({ sources: ["https://127.0.0.1/a"] }), 400, "invalid_source"],
    [claimBody({ sources: ["https://user:pass@www.gamekee.com/hw/634407.html"] }), 400, "invalid_source"],
    [claimBody({ statement: "" }), 400, "statement_required"],
    [claimBody({ game_id: "Not A Slug" }), 400, "invalid_game_id"],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [body, status, error] = cases[i];
    const res = await route(postClaim(body, { "cf-connecting-ip": `203.0.113.${i + 1}` }), e);
    assert.equal(res.status, status, error);
    assert.equal((await jsonOf(res)).error, error);
  }

  const huge = await route(postClaim(`{"statement":"${"a".repeat(MAX_BODY_BYTES)}"}`), e);
  assert.equal(huge.status, 413);
  assert.equal((await jsonOf(huge)).error, "body_too_large");

  const mirror = await route(new Request(`${origin}/v1/claims.json`), e);
  assert.equal((await jsonOf(mirror)).count, 0);
});

test("claims: per-IP and global daily rate limits", async () => {
  const e = env();
  for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
    const res = await route(postClaim(claimBody({ statement: `n${i}` })), e);
    assert.equal(res.status, 201, `post ${i}`);
  }
  const limited = await route(postClaim(claimBody({ statement: "over ip" })), e);
  assert.equal(limited.status, 429);
  const limitedBody = await jsonOf(limited);
  assert.equal(limitedBody.error, "rate_limited");
  assert.equal(limitedBody.scope, "ip");
  assert.equal(limitedBody.limit, RATE_LIMIT_PER_IP);

  const otherIp = await route(
    postClaim(claimBody({ statement: "other ip" }), { "cf-connecting-ip": "203.0.113.9" }),
    e
  );
  assert.equal(otherIp.status, 201);

  const day = formatShanghai(new Date()).slice(0, 10);
  const capped = { ASSETS: assets(), CLAIMS: memoryKv() };
  await capped.CLAIMS.put(`${GLOBAL_RATE_PREFIX}${day}`, String(RATE_LIMIT_GLOBAL_DAY));
  const globalHit = await route(
    postClaim(claimBody(), { "cf-connecting-ip": "203.0.113.10" }),
    capped
  );
  assert.equal(globalHit.status, 429);
  const globalBody = await jsonOf(globalHit);
  assert.equal(globalBody.error, "rate_limited");
  assert.equal(globalBody.scope, "day");
  assert.equal(globalBody.limit, RATE_LIMIT_GLOBAL_DAY);
  assert.equal((await jsonOf(await route(new Request(`${origin}/v1/claims.json`), capped))).count, 0);
});

test("claims: KV required, API key is not", async () => {
  const missing = await route(postClaim(claimBody()), { ASSETS: assets() });
  assert.equal(missing.status, 503);
  assert.equal((await jsonOf(missing)).error, "claims_kv_unconfigured");
});

test("static asset paths are not swallowed", async () => {
  const res = await route(new Request(`${origin}/llms.txt`), env());
  assert.equal(res, null);
});

test("portrait route only fetches allowlisted GameKee images", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const allowed = "https://cdnimg-v2.gamekee.com/wiki2.0/images/w_1/h_1/1.png";
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, allowed);
    assert.equal(init.headers.Referer, "https://www.gamekee.com/");
    assert.equal(init.redirect, "manual");
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  };
  try {
    const foreign = await route(
      new Request(`${origin}/v1/portrait?u=${encodeURIComponent("https://evil.example/a.png")}`),
      env()
    );
    assert.equal(foreign.status, 400);
    assert.equal(await foreign.text(), "rejected_url");

    const queried = await route(
      new Request(
        `${origin}/v1/portrait?u=${encodeURIComponent("https://cdnimg-v2.gamekee.com/wiki2.0/images/a.png?x=1")}`
      ),
      env()
    );
    assert.equal(queried.status, 400);

    const posted = await route(new Request(`${origin}/v1/portrait?u=${encodeURIComponent(allowed)}`, { method: "POST" }), env());
    assert.equal(posted.status, 405);

    const ok = await route(new Request(`${origin}/v1/portrait?u=${encodeURIComponent(allowed)}`), env());
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.match(ok.headers.get("cache-control"), /max-age=86400/);
    const body = new Uint8Array(await ok.arrayBuffer());
    assert.equal(body[0], 0x89);
  } finally {
    globalThis.fetch = original;
  }
});
