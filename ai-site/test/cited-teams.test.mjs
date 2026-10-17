import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptRoster,
  applyCitedTeams,
  indexBySlug,
  resolveSlug,
  teamsEmpty,
} from "../../mcp-server/scripts/cited-teams.mjs";

const publicGuides = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/v1/guides");

const cards = [
  { id: "centi", name: "仙蒂", prydwen_slug: "centi", ratings: { slug: "centi" }, teams: {} },
  {
    id: "centi-treasure",
    name: "仙蒂（宝藏）",
    prydwen_slug: "centi-treasure",
    ratings: { slug: "centi?treasure=true" },
    teams: {},
  },
  { id: "liter", name: "莱伊", prydwen_slug: "liter", ratings: { slug: "liter" }, teams: { comp: ["已有"] } },
  { id: "li-ta", name: "丽塔", prydwen_slug: null, ratings: { slug: "liter" }, teams: {} },
  { id: "crown", name: "皇冠", prydwen_slug: "crown", ratings: { slug: "crown" }, teams: {} },
  { id: "naga", name: "娜嘉", prydwen_slug: "naga", ratings: { slug: "naga" }, teams: {} },
  { id: "rapi", name: "拉毗", prydwen_slug: "rapi", ratings: { slug: "rapi" }, teams: {} },
];

function freshCards() {
  return structuredClone(cards);
}

test("treasure slug stays off the base character and a shared slug stays unresolved", () => {
  const index = indexBySlug(freshCards());
  assert.equal(resolveSlug("centi", index), "centi");
  assert.equal(resolveSlug("centi-treasure", index), "centi-treasure");
  assert.equal(resolveSlug("liter", index), null);
  assert.equal(resolveSlug("flex", index), null);
  assert.equal(resolveSlug("b1-cdr", index), null);
  assert.deepEqual(
    acceptRoster(["crown", "naga", "rapi", "centi", "centi-treasure"], index),
    ["crown", "naga", "rapi", "centi", "centi-treasure"]
  );
  assert.equal(acceptRoster(["crown", "naga", "rapi", "centi", "liter"], index), null);
  assert.equal(acceptRoster(["crown", "naga", "rapi", "centi", "flex"], index), null);
});

test("cited teams fill only empty cards and keep the source on the line", () => {
  const sample = freshCards();
  const index = indexBySlug(sample);
  const members = acceptRoster(["crown", "naga", "rapi", "centi", "centi-treasure"], index);
  const before = JSON.stringify(sample.find((card) => card.id === "liter").teams);
  const touched = applyCitedTeams(sample, [
    {
      members,
      label: "Prydwen · Campaign · Fire · Sample",
      source: "https://www.prydwen.gg/nikke/teams-database",
      asOf: "2026-10-15",
      score: 10,
    },
  ]);
  assert.ok(touched.includes("crown"));
  assert.ok(!touched.includes("liter"));
  assert.equal(JSON.stringify(sample.find((card) => card.id === "liter").teams), before);
  assert.equal(teamsEmpty(sample.find((card) => card.id === "li-ta")), true);
  const line = sample.find((card) => card.id === "crown").teams.comp[0];
  assert.match(line, /皇冠 \/ 娜嘉 \/ 拉毗 \/ 仙蒂 \/ 仙蒂（宝藏）/);
  assert.match(line, /https:\/\/www\.prydwen\.gg\/nikke\/teams-database/);
  assert.match(line, /as_of 2026-10-15/);
  assert.ok(sample.find((card) => card.id === "crown").sources.includes("https://www.prydwen.gg/nikke/teams-database"));
});

test("hw nikke and bd2 guide indexes link banners and codes", () => {
  for (const game of ["hw", "nikke", "bd2", "arknights-endfield", "zenless-zone-zero"]) {
    const index = JSON.parse(fs.readFileSync(path.join(publicGuides, game, "index.json"), "utf8"));
    assert.equal(index.links.banners, `/v1/guides/${game}/banners.json`);
    assert.equal(index.links.codes, `/v1/guides/${game}/codes.json`);
  }
  const asora = JSON.parse(fs.readFileSync(path.join(publicGuides, "asora", "index.json"), "utf8"));
  assert.equal(asora.links, undefined);
});
