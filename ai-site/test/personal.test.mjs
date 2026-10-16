import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderCharacter, renderMe } from "../public/ui/render.js";
import {
  buildPersonal,
  calendarDay,
  canonicalQuery,
  decodeShareCode,
  encodeShareCode,
  importFollowText,
  namesFromIndexAndAliases,
  parseFollows,
  personalAtom,
  toggleFollow,
} from "../public/ui/personal.js";
import { personalFromPublic } from "../../mcp-server/personal-public.js";
import { route } from "../src/worker.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = "http://127.0.0.1:8787";
const DAY = "2026-10-16";

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function assets() {
  return {
    async fetch(req) {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) return new Response("no", { status: 403 });
      try {
        return new Response(await fs.promises.readFile(file), { status: 200 });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  };
}

function env() {
  return { ASSETS: assets() };
}

test("share code round-trips and rejects bad ids", () => {
  const follows = {
    games: ["hw", "bd2"],
    chars: [
      { game: "hw", id: "ai_mi_li_ya" },
      { game: "bd2", id: "nevendaria" },
    ],
  };
  const code = encodeShareCode(follows);
  assert.match(code, /^gi1\.[A-Za-z0-9_-]+$/);
  const back = decodeShareCode(code);
  assert.equal(back.ok, true);
  assert.equal(canonicalQuery({ games: [], chars: [{ game: "hw", id: "ai_mi_li_ya" }] }), "chars=hw:ai_mi_li_ya");
  assert.deepEqual(back.follows.games, ["bd2", "hw"]);
  assert.deepEqual(back.follows.chars.map((row) => `${row.game}:${row.id}`), ["bd2:nevendaria", "hw:ai_mi_li_ya"]);
  const imported = importFollowText(`https://game-intel.example/me/?code=${code}`);
  assert.deepEqual(imported.follows.games, back.follows.games);
  assert.equal(parseFollows({ games: "../hw" }).error, "bad_follow");
  assert.equal(parseFollows({ chars: "nikke:<script>" }).error, "bad_follow");
  assert.equal(decodeShareCode("gi1.!!!!").error, "bad_code");
  const tooMany = Array.from({ length: 25 }, (_, i) => `g${i}`).join(",");
  assert.equal(parseFollows({ games: tooMany }).error, "too_many_games");
  const toggled = toggleFollow({ games: [], chars: [] }, "char", "NIKKE", "Modernia");
  assert.deepEqual(toggled.follows.chars, [{ game: "nikke", id: "modernia" }]);
  assert.equal(calendarDay("2026-10-31T14:59:00Z"), "2026-10-31");
  assert.equal(calendarDay("2026-09-30"), "2026-09-30");
});

test("published JSON highlights UP, rerun, new codes, and expiring codes", async () => {
  const doc = await personalFromPublic(
    {
      games: "bd2",
      chars: "bd2:nevendaria,hw:ai_mi_li_ya,hw:you_jie_ni_ya,hw:garud,nikke:belorta-pumpkin-witch,nikke:modernia",
    },
    DAY
  );
  assert.equal(doc.stored, false);
  assert.equal(doc.stateless, true);
  const code = doc.highlights.codes_new.find((row) => row.code === "2026BD2OCT");
  assert.ok(code);
  assert.ok(code.marks.includes("expiring"));
  assert.equal(code.days_left, 15);
  const mummy = doc.highlights.banners.find((row) => row.matched.some((item) => item.id === "nevendaria"));
  assert.equal(mummy.status, "current");
  assert.equal(mummy.matched[0].mark, "up");
  const emilia = doc.highlights.banners.find((row) => row.id === "hw-2026-10-08-rerun");
  assert.equal(emilia.matched.find((item) => item.id === "ai_mi_li_ya").mark, "rerun");
  const mixed = doc.highlights.banners.find((row) => row.id === "hw-2026-09-23-garud");
  assert.equal(mixed.matched.find((item) => item.id === "you_jie_ni_ya").mark, "rerun");
  assert.equal(mixed.matched.find((item) => item.id === "garud").mark, "up");
  const belorta = doc.highlights.banners.find((row) => row.id === "nikke-belorta-pumpkin-witch");
  assert.equal(belorta.matched[0].mark, "up");
  assert.equal(belorta.status, "current");

  const onlyChar = await personalFromPublic({ chars: "nikke:modernia" }, DAY);
  assert.ok(!onlyChar.feed.items.some((item) => item.title.includes("灰姑娘")));
  assert.equal(onlyChar.labels.chars["nikke:modernia"], "Modernia");
  const game = await personalFromPublic({ games: "nikke" }, DAY);
  assert.ok(game.feed.items.some((item) => item.title.includes("灰姑娘")));
  assert.equal(game.highlights.banners.length, 0);

  const names = namesFromIndexAndAliases(
    "modernia",
    readJson("v1/guides/nikke/index.json"),
    [1, 2, 3, 4].map((part) => readJson(`v1/guides/nikke/aliases.p${part}.json`))
  );
  assert.ok(names.aliases.includes("摩登"));
  const aliasHit = buildPersonal({
    follows: { games: [], chars: [{ game: "nikke", id: "modernia" }] },
    feed: {
      items: [
        { title: "摩登活动", url: "https://example.com/m", game_id: "nikke", source: "t" },
        { title: "别的", url: "https://example.com/o", game_id: "nikke", source: "t" },
        { title: "<script>", url: "javascript:alert(1)", game_id: "nikke", source: "t" },
      ],
    },
    digest: { digests: [] },
    namesByKey: { "nikke:modernia": names },
    today: DAY,
  });
  assert.equal(aliasHit.feed.items.length, 1);
  assert.equal(aliasHit.feed.items[0].title, "摩登活动");

  const hw = await personalFromPublic({ games: "hw" }, DAY);
  const expired = hw.codes.find((row) => row.expires === "2026-09-30");
  assert.ok(expired.marks.includes("expired"));
  assert.ok(!expired.marks.includes("new"));
  assert.ok(!expired.marks.includes("expiring"));
});

test("page render escapes hostile rows and shows the highlight labels", async () => {
  const doc = await personalFromPublic({ games: "bd2", chars: "hw:ai_mi_li_ya" }, DAY);
  const html = renderMe(doc);
  assert.match(html, /我的关注/);
  assert.match(html, /复刻/);
  assert.match(html, /2026BD2OCT/);
  assert.match(html, /新码/);
  assert.match(html, /还有 15 天/);
  assert.match(html, /gi1\./);
  assert.match(html, /\/v1\/personal\.atom\?/);
  assert.doesNotMatch(html, /<script>/);
  const hostile = renderMe(
    buildPersonal({
      follows: { games: ["hw"], chars: [] },
      feed: { items: [] },
      digest: { digests: [] },
      bannersByGame: {
        hw: { banners: [{ id: "x", name: "<script>alert(1)</script>", status: "current", up: [], source: "javascript:alert(1)" }] },
      },
      codesByGame: {
        hw: { codes: [{ code: "<b>", rewards: "<i>", status: "active", source: "javascript:alert(1)" }] },
      },
      today: DAY,
    })
  );
  assert.doesNotMatch(hostile, /<script>/);
  assert.doesNotMatch(hostile, /javascript:/);
  assert.match(hostile, /&lt;script&gt;/);
  const thin = renderCharacter("star", null, { id: "someone" });
  assert.match(thin, /关注这个角色/);
  assert.match(thin, /尚无深耕/);
});

test("GET /v1/personal matches the disk filter and Atom stays XML", async () => {
  const query = "games=bd2&chars=hw:ai_mi_li_ya";
  const http = await route(new Request(`${origin}/v1/personal?${query}`), env());
  assert.equal(http.status, 200);
  assert.match(http.headers.get("content-type"), /application\/json/);
  assert.match(http.headers.get("cache-control"), /public/);
  assert.equal(http.headers.get("set-cookie"), null);
  const body = await http.json();
  const disk = await personalFromPublic({ games: "bd2", chars: "hw:ai_mi_li_ya" }, body.meta.today);
  assert.deepEqual(body, disk);
  assert.equal(body.stored, false);
  const viaCode = await route(new Request(`${origin}/v1/personal?code=${encodeShareCode(body.follows)}`), env());
  const coded = await viaCode.json();
  assert.deepEqual(coded.follows, body.follows);

  const bad = await route(new Request(`${origin}/v1/personal?games=../x`), env());
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad_follow");
  const posted = await route(new Request(`${origin}/v1/personal`, { method: "POST" }), env());
  assert.equal(posted.status, 405);
  const opted = await route(new Request(`${origin}/v1/personal`, { method: "OPTIONS" }), env());
  assert.equal(opted.status, 204);
  assert.equal(await route(new Request(`${origin}/me/`), env()), null);

  const atom = await route(new Request(`${origin}/v1/personal.atom?chars=hw:ai_mi_li_ya`), env());
  assert.equal(atom.status, 200);
  assert.match(atom.headers.get("content-type"), /application\/atom\+xml/);
  const xml = await atom.text();
  assert.match(xml, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(xml, /复刻/);
  assert.doesNotMatch(xml, /<script>/);
  const escaped = personalAtom(
    buildPersonal({
      follows: { games: ["hw"], chars: [{ game: "hw", id: "ai_mi_li_ya" }] },
      feed: { items: [{ title: "A & B <c>", url: "https://example.com/a", game_id: "hw", source: "t" }] },
      today: DAY,
    }),
    `${origin}/v1/personal.atom?games=hw`
  );
  assert.match(escaped, /A &amp; B &lt;c&gt;/);
  assert.doesNotMatch(escaped, /A & B/);
});

test("remote MCP personal_digest returns the same document", async () => {
  const list = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }),
    env()
  );
  const names = (await list.json()).result.tools.map((tool) => tool.name);
  assert.ok(names.includes("personal_digest"));

  const called = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "personal_digest", arguments: { games: "bd2", chars: "bd2:nevendaria" } },
      }),
    }),
    env()
  );
  const payload = JSON.parse((await called.json()).result.content[0].text);
  assert.equal(payload.stored, false);
  assert.equal(payload.highlights.banners[0].matched[0].mark, "up");
  assert.equal(payload.highlights.banners[0].matched[0].id, "nevendaria");

  const rejected = await route(
    new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "personal_digest", arguments: { games: "nope!" } },
      }),
    }),
    env()
  );
  const err = await rejected.json();
  assert.equal(err.result.isError, true);
});

test("docs name the page, endpoint, and tool", () => {
  const llms = fs.readFileSync(path.join(root, "llms.txt"), "utf8");
  const source = fs.readFileSync(path.join(root, "../llms.txt"), "utf8");
  assert.equal(llms, source);
  assert.match(llms, /\/v1\/personal/);
  assert.match(llms, /personal_digest/);
  assert.match(llms, /\/me\//);
  const openapi = readJson("openapi.json");
  assert.ok(openapi.paths["/v1/personal"]);
  assert.ok(openapi.paths["/v1/personal.atom"]);
  assert.equal(openapi.components.schemas.Personal.$ref, "/schema/personal.schema.json");
  const cli = spawnSync(process.execPath, ["mcp-server/cli.js", "personal", "--games", "hw", "--chars", "hw:ai_mi_li_ya"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);
  const out = JSON.parse(cli.stdout);
  assert.equal(out.stored, false);
  assert.equal(out.highlights.banners[0].matched[0].mark, "rerun");
});
