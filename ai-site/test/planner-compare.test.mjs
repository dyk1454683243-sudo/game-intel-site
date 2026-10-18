import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { handleRequest } from "../src/worker.js";
import { withLang } from "../public/ui/i18n.js";
import { renderCharacter } from "../public/ui/render.js";
import {
  applyResources,
  buildPlanner,
  citedRule,
  daysUntil,
  mergeWanted,
  parsePlannerState,
  parseResourceQuery,
  renderPlanner,
  shortfall,
  sourcedDay,
  toggleWanted,
} from "../public/ui/planner.js";
import {
  COMPARE_GAP,
  addToCompare,
  compareDocument,
  gapLabel,
  parseCompareIds,
  renderCompare,
} from "../public/ui/compare.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const origin = "http://127.0.0.1:8787";
const DAY = "2026-10-18";

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

function publishedPlanner() {
  const guidesIndex = readJson("v1/guides/index.json");
  const calendar = readJson("v1/calendar.json");
  const bannersByGame = {};
  const codesByGame = {};
  for (const game of guidesIndex.games || []) {
    const banners = path.join(root, "v1/guides", game.id, "banners.json");
    const codes = path.join(root, "v1/guides", game.id, "codes.json");
    if (fs.existsSync(banners)) bannersByGame[game.id] = readJson(`v1/guides/${game.id}/banners.json`);
    if (fs.existsSync(codes)) codesByGame[game.id] = readJson(`v1/guides/${game.id}/codes.json`);
  }
  return buildPlanner({ guidesIndex, bannersByGame, codesByGame, calendar, today: DAY });
}

test("sourced days stay on the stored prefix and prose is not a date", () => {
  assert.equal(sourcedDay("2026-10-28T23:59:59+09:00"), "2026-10-28");
  assert.equal(sourcedDay("2026-10-15T04:59:00-05:00"), "2026-10-15");
  assert.equal(sourcedDay("2026-10-22T10:00:00"), "2026-10-22");
  assert.equal(sourcedDay("2026-02-31"), null);
  assert.equal(sourcedDay("10月21日更新后"), null);
  assert.equal(sourcedDay("2026.10.8 (四) 維護結束後"), null);
  assert.equal(daysUntil(DAY, "2026-10-28"), 10);
  assert.equal(daysUntil(DAY, null), null);
});

test("only the stated summon sentence becomes a shortfall", () => {
  const stated = citedRule({
    note: "属于限时角色征集，与同类型保底共享，首个 10 次征集内必得 5 星或以上。",
    source: "https://example.com/drake",
  });
  assert.equal(stated.calculable, true);
  assert.equal(stated.pulls, 10);
  assert.equal(stated.unit, "次征集");
  assert.equal(stated.guarantee, "5 星或以上");
  assert.ok(stated.also.includes("与同类型保底共享"));
  assert.deepEqual(shortfall(stated, 3), {
    target: 10,
    unit: "次征集",
    quote: stated.quote,
    source: stated.source,
    have: 3,
    shortfall: 7,
  });
  assert.equal(shortfall(stated, null).shortfall, null);

  const qualitative = citedRule({
    note: "保底单独累积，活动结束后清零。",
    source: "https://example.com/lilya",
  });
  assert.equal(qualitative.calculable, false);
  assert.equal(qualitative.pulls, null);
  assert.equal(shortfall(qualitative, 3), null);

  assert.equal(citedRule({ note: "硬保底90抽，概率1.6%", source: "https://example.com/invented" }), null);
  assert.equal(citedRule({ note: "首个 10 次征集内必得 5 星或以上。", source: "" }), null);
});

test("published timeline keeps current and future banners and skips unstated pity", () => {
  const doc = publishedPlanner();
  assert.equal(doc.ok, true);
  assert.equal(doc.stored, false);
  assert.equal(doc.today, DAY);
  const nikke = doc.games.find((game) => game.game === "nikke");
  assert.equal(nikke.timeline_only, true);
  assert.equal(nikke.pull_math, "timeline_only");
  const belorta = nikke.banners.find((row) => row.id === "nikke-belorta-pumpkin-witch");
  assert.equal(belorta.status, "current");
  assert.equal(belorta.end, "2026-10-28");
  assert.equal(belorta.days_until_end, 10);
  assert.equal(belorta.cited_rule, null);
  assert.equal(belorta.savings, null);
  assert.equal(nikke.banners.some((row) => row.status === "ended" || row.id === "nikke-sin-rapid-bunny"), false);
  assert.equal(nikke.codes.every((row) => row.counted_as_pulls === false), true);

  const zzz = doc.games.find((game) => game.game === "zenless-zone-zero");
  const phoenix = zzz.banners.find((row) => row.id === "zzz-3.3-phoenix-velina");
  assert.equal(phoenix.status, "upcoming");
  assert.equal(phoenix.start, null);
  assert.equal(phoenix.days_until_start, null);
  assert.equal(phoenix.end, "2026-11-11");
  assert.equal(phoenix.days_until_end, daysUntil(DAY, "2026-11-11"));

  const endfield = doc.games.find((game) => game.game === "arknights-endfield");
  const tangtang = endfield.banners.find((row) => row.id === "endfield-ancestral-spring-tangtang");
  assert.equal(tangtang.start, null);
  assert.equal(tangtang.end, null);
  assert.equal(tangtang.days_until_start, null);
  assert.equal(tangtang.days_until_end, null);
  assert.match(tangtang.start_text, /Oct\. 29/);

  const reverse = doc.games.find((game) => game.game === "reverse-1999");
  assert.equal(reverse.timeline_only, false);
  const drake = reverse.banners.find((row) => row.id === "cn-2026-10-15-drake");
  assert.equal(drake.cited_rule.pulls, 10);
  assert.equal(drake.cited_rule.calculable, true);
  const lilya = reverse.banners.find((row) => row.id === "cn-2026-09-24-huntsworn-lilya");
  assert.equal(lilya.cited_rule.calculable, false);
  assert.equal(reverse.banners.some((row) => row.status === "ended"), false);

  const hw = doc.games.find((game) => game.game === "hw");
  assert.equal(hw.timeline_only, true);
  assert.equal(hw.banners.find((row) => row.id === "hw-2026-10-08-rerun").days_until_end, daysUntil(DAY, "2026-10-22"));

  const withResources = applyResources(doc, { "reverse-1999": 4 });
  const priced = withResources.games.find((game) => game.game === "reverse-1999").banners.find((row) => row.id === "cn-2026-10-15-drake");
  assert.equal(priced.savings.shortfall, 6);
  assert.equal(priced.savings.unit, "次征集");
  const stillTimeline = withResources.games.find((game) => game.game === "nikke").banners[0];
  assert.equal(stillTimeline.savings, null);

  const html = renderPlanner(doc, {
    state: { wanted: [{ game: "nikke", id: "belorta-pumpkin-witch", name: "贝洛塔：南瓜女巫" }], resources: { nikke: 2 } },
    follows: { games: [], chars: [{ game: "hw", id: "ai_mi_li_ya" }] },
  });
  assert.match(html, /离开卡池还有 10 天/);
  assert.match(html, /只显示时间线/);
  assert.match(html, /不换算成抽数/);
  assert.match(html, /把关注的角色加入规划/);
  assert.doesNotMatch(html, /硬保底|1\.6%|90 抽/);
});

test("planner state merges follows without inventing a target", () => {
  assert.equal(parseResourceQuery("reverse-1999:3,nikke:0").resources["reverse-1999"], 3);
  assert.equal(parseResourceQuery("nikke:ten").ok, false);
  const merged = mergeWanted(parsePlannerState(null), [
    { game: "HW", id: "Ai_Mi_Li_Ya", name: "艾米莉亚" },
    { game: "hw", id: "ai_mi_li_ya" },
  ]);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.state.wanted, [{ game: "hw", id: "ai_mi_li_ya", name: "艾米莉亚" }]);
  const off = toggleWanted(merged.state, "hw", "ai_mi_li_ya");
  assert.equal(off.on, false);
  assert.equal(off.state.wanted.length, 0);
});

test("compare renders stored fields and leaves gaps empty", () => {
  assert.equal(parseCompareIds("hw:a,bd2:b").error, "bad_compare");
  assert.equal(parseCompareIds("hw:only-one").ok, false);
  assert.equal(parseCompareIds("hw:a,hw:b,hw:c,hw:d,hw:e").ok, false);
  const filled = {
    id: "filled",
    game: "hw",
    name: "甲",
    role: "治疗",
    element: "火",
    skills: [{ name: "斩", type: "active", summary: "造成伤害" }],
    teams: { comp: ["和乙一起"] },
    summary: { tier: "T0", sources: ["https://example.com/filled"] },
    ratings: { url: "https://example.com/grades", as_of: "2026-10-01", rows: [{ role: "Support", modes: [{ label: "Endgame", grade: "T0" }] }] },
  };
  const empty = {
    id: "empty",
    game: "hw",
    name: "乙",
    skills: [{ name: "守", type: "passive" }],
    teams: {},
    summary: { sources: ["https://example.com/empty"] },
  };
  const doc = compareDocument([filled, empty]);
  assert.equal(doc.gap, COMPARE_GAP);
  assert.equal(doc.stored, false);
  const element = doc.rows.find((row) => row.key === "element");
  assert.deepEqual(element.cells, ["火", null]);
  const role = doc.rows.find((row) => row.key === "role");
  assert.deepEqual(role.cells, ["治疗", null]);
  const html = renderCompare(doc);
  assert.match(html, /甲/);
  assert.match(html, /乙/);
  assert.match(html, /造成伤害/);
  assert.match(html, /和乙一起/);
  assert.match(html, /T0/);
  assert.match(html, /https:\/\/example\.com\/filled/);
  assert.match(html, /暂无出处/);
  assert.doesNotMatch(html, /暂无出处[^<]*火/);
  const emptyCell = html.split("守")[1];
  assert.match(emptyCell, /暂无出处/);
  assert.equal(withLang("en", () => gapLabel()), "No cited source");
  assert.match(withLang("en", () => renderCompare(doc)), /No cited source/);
  assert.match(withLang("ja", () => renderCompare(doc)), /出典なし/);
  const replaced = addToCompare({ v: 1, ids: ["bd2:one", "bd2:two"] }, "hw:filled");
  assert.equal(replaced.replaced, true);
  assert.deepEqual(replaced.state.ids, ["hw:filled"]);
});

test("character pages link into compare", () => {
  const card = readJson("v1/guides/hw/characters/ai_mi_li_ya.json");
  const html = renderCharacter("hw", card);
  assert.match(html, /加入对比/);
  assert.match(html, /\/compare\/\?add=hw%3Aai_mi_li_ya/);
});

test("planner and compare endpoints keep etag, version, and the public limiter", async () => {
  const env = { ASSETS: assets() };
  const planner = await handleRequest(new Request(`${origin}/v1/planner`), env);
  assert.equal(planner.status, 200);
  assert.equal(planner.headers.get("x-api-version"), "1");
  assert.match(planner.headers.get("etag") || "", /^"[0-9a-f]+"$/);
  assert.match(planner.headers.get("cache-control") || "", /max-age=300/);
  const body = await planner.json();
  assert.equal(body.derived, true);
  assert.equal(body.stored, false);
  const again = await handleRequest(
    new Request(`${origin}/v1/planner`, { headers: { "if-none-match": planner.headers.get("etag") } }),
    env
  );
  assert.equal(again.status, 304);

  const priced = await handleRequest(new Request(`${origin}/v1/planner?game=reverse-1999&resources=reverse-1999:3`), env);
  const pricedBody = await priced.json();
  assert.equal(pricedBody.games.length, 1);
  const drake = pricedBody.games[0].banners.find((row) => row.id === "cn-2026-10-15-drake");
  assert.equal(drake.savings.shortfall, Math.max(0, 10 - 3));
  const bad = await handleRequest(new Request(`${origin}/v1/planner?resources=nikke:ten`), env);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad_resources");

  const compare = await handleRequest(
    new Request(`${origin}/v1/compare?ids=hw:ai_mi_li_ya,hw:garud`),
    env
  );
  assert.equal(compare.status, 200);
  assert.equal(compare.headers.get("x-api-version"), "1");
  assert.match(compare.headers.get("etag") || "", /^"[0-9a-f]+"$/);
  const cards = await compare.json();
  assert.equal(cards.game, "hw");
  assert.equal(cards.gap, COMPARE_GAP);
  assert.equal(cards.count, 2);
  assert.equal(cards.rows.find((row) => row.key === "element"), undefined);
  assert.ok(cards.rows.find((row) => row.key === "role").cells.every((cell) => typeof cell === "string" && cell.length));
  const mixed = await handleRequest(new Request(`${origin}/v1/compare?ids=hw:ai_mi_li_ya,nikke:modernia`), env);
  assert.equal(mixed.status, 400);
  assert.equal((await mixed.json()).error, "bad_compare");
  const missing = await handleRequest(new Request(`${origin}/v1/compare?ids=hw:ai_mi_li_ya,hw:not-a-real-card`), env);
  assert.equal(missing.status, 404);

  const limited = {
    ASSETS: assets(),
    RATE_LIMIT_ANON: { async limit() { return { success: false }; } },
  };
  const blocked = await handleRequest(
    new Request(`${origin}/v1/planner`, { headers: { "cf-connecting-ip": "203.0.113.40" } }),
    limited
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
});

test("planner and compare shells are localized in the sitemap", () => {
  for (const rel of ["planner/index.html", "en/planner/index.html", "ja/planner/index.html", "compare/index.html", "en/compare/index.html", "ja/compare/index.html"]) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(html, /rel="canonical"/);
    for (const code of ["zh-CN", "en", "ja", "x-default"]) assert.match(html, new RegExp(`hreflang="${code}"`));
  }
  const zh = fs.readFileSync(path.join(root, "sitemap-zh.xml"), "utf8");
  const en = fs.readFileSync(path.join(root, "sitemap-en.xml"), "utf8");
  const ja = fs.readFileSync(path.join(root, "sitemap-ja.xml"), "utf8");
  assert.match(zh, /\/planner\/</);
  assert.match(zh, /\/compare\/</);
  assert.match(en, /\/en\/planner\/</);
  assert.match(en, /\/en\/compare\/</);
  assert.match(ja, /\/ja\/planner\/</);
  assert.match(ja, /\/ja\/compare\/</);
});
