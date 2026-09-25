import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { route } from "../src/worker.js";

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

test("claims: unauthorized, missing sources, then mirror", async () => {
  const e = env();
  const unauth = await route(
    new Request(`${origin}/v1/claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "x", sources: ["https://example.com/a"] }),
    }),
    e
  );
  assert.equal(unauth.status, 401);

  const bad = await route(
    new Request(`${origin}/v1/claims`, {
      method: "POST",
      headers: { authorization: "Bearer test-key-not-real", "content-type": "application/json" },
      body: JSON.stringify({ statement: "no sources" }),
    }),
    e
  );
  assert.equal(bad.status, 400);
  assert.equal((await jsonOf(bad)).error, "sources_required");

  const ok = await route(
    new Request(`${origin}/v1/claims`, {
      method: "POST",
      headers: { authorization: "Bearer test-key-not-real", "content-type": "application/json" },
      body: JSON.stringify({
        statement: "HW card lists sources",
        sources: ["https://www.gamekee.com/hw/634407.html"],
        game_id: "hw",
        character_id: "a_la_ha",
        as_of: "2026-09-25",
        submitter: "example-agent",
      }),
    }),
    e
  );
  assert.equal(ok.status, 201);
  const created = await jsonOf(ok);
  assert.equal(created.claim.timezone, "Asia/Shanghai");
  assert.ok(created.claim.submitted_at.endsWith("+08:00"));

  const mirror = await route(new Request(`${origin}/v1/claims.json`), e);
  const listed = await jsonOf(mirror);
  assert.equal(listed.count, 1);
  assert.equal(listed.claims[0].statement, "HW card lists sources");

  const page = await route(new Request(`${origin}/claims/index.html`), e);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await page.text(), /HW card lists sources/);
});

test("static asset paths are not swallowed", async () => {
  const res = await route(new Request(`${origin}/llms.txt`), env());
  assert.equal(res, null);
});
