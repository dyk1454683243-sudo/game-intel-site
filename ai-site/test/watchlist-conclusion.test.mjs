import assert from "node:assert/strict";
import test from "node:test";
import { conclusionFromCard } from "../../mcp-server/scripts/guide-conclusion.mjs";
import { bd2EffectText } from "../../mcp-server/scripts/enrich-bd2-cards.js";
import {
  extractCostumePull,
  extractCostumeTier,
  matchCostumeReview,
  nikkeLocalId,
  renderNikkeSkill,
} from "../../mcp-server/scripts/watchlist-parse.mjs";

test("nikke.gg combined tier is copied and pull is not invented", () => {
  const summary = conclusionFromCard({
    game: "nikke",
    rarity: "SSR",
    burst: "Burst 3",
    role: "火力型",
    sources: ["https://www.gamekee.com/nikke/1.html"],
    ratings: {
      combined: "A",
      story: "A",
      boss: "S",
      pvp: "C",
      url: "https://nikke.gg/tier-list/",
      character_url: "https://nikke.gg/characters/modernia/",
      req_invest: false,
      strong_early: true,
    },
  });
  assert.equal(summary.stub, false);
  assert.equal(summary.tier, "Nikke.gg 综合 A（故事 A / Boss S / PvP C）");
  assert.equal(summary.pull, undefined);
  assert.match(summary.caveat, /不编造抽卡结论/);
  assert.match(summary.caveat, /低中战役缺口/);
  assert.ok(summary.sources.includes("https://nikke.gg/tier-list/"));
});

test("nikke rating outside the published scale is not used", () => {
  const summary = conclusionFromCard({
    game: "nikke",
    sources: ["https://nikke.gg/tier-list/"],
    ratings: {
      checked: true,
      combined: "T0",
      url: "https://nikke.gg/tier-list/",
    },
  });
  assert.equal(summary.stub, true);
  assert.equal(summary.tier, undefined);
  assert.match(summary.caveat, /未见可靠出处/);
});

test("bd2 costume tiers stay per costume", () => {
  const summary = conclusionFromCard({
    game: "bd2",
    rarity: "5星",
    element: "水",
    role: "输出",
    sources: ["https://www.gamekee.com/zsca2/1.html"],
    costume_ratings: [
      {
        label: "忌妒之夜",
        tier: "T1",
        pull: "建议抽",
        source: "https://www.gamekee.com/zsca2/635245.html",
      },
    ],
  });
  assert.equal(summary.stub, false);
  assert.match(summary.tier, /忌妒之夜 T1/);
  assert.equal(summary.pull, "忌妒之夜：建议抽");
  assert.match(summary.caveat, /不合并成角色总榜/);
});

test("bd2 effect text ignores the trailing SP cell", () => {
  const effect = bd2EffectText([
    "+5",
    "2",
    "3",
    "友军的SP恢复3点。对敌人造成1的物理伤害，并将目标向左侧击退2格。",
    "3",
  ]);
  assert.match(effect, /击退2格/);
  assert.notEqual(effect, "3");
});

test("costume review parser copies 综合评价 and does not flip 不建议抽", () => {
  const text = "前言。综合评价：T1（有高破泳装）T2（无高破泳装）。不建议抽满破。建议抽一命。";
  assert.equal(extractCostumeTier(text), "T1（有高破泳装） / T2（无高破泳装）");
  const pull = extractCostumePull(text);
  assert.match(pull, /不建议抽满破/);
  assert.match(pull, /建议抽一命/);
  assert.equal(extractCostumeTier("只有一句评价，没有梯度。"), null);
});

test("nikke slug alias and skill placeholders", () => {
  const ids = new Set(["siren", "bay-treasure", "modernia"]);
  assert.equal(nikkeLocalId("little-mermaid", ids), "siren");
  assert.equal(nikkeLocalId("bay?treasure=true", ids), "bay-treasure");
  assert.equal(nikkeLocalId("not-a-unit", ids), null);
  const rendered = renderNikkeSkill(
    "Deals {description_value_01}% of <word_group=10025>final</word_group> ATK.",
    { description_value_01: "1.9" }
  );
  assert.equal(rendered, "Deals 1.9% of final ATK.");
  assert.equal(
    renderNikkeSkill("Deals {description_value_01}% ATK.", { description_value_01: "" }),
    null
  );
});

test("review title tie is not assigned", () => {
  const cards = [
    { id: "a", name: "莱维亚", nicknames: [], costumes: [] },
    { id: "b", name: "莱维亚", nicknames: [], costumes: [] },
  ];
  assert.equal(matchCostumeReview("莱维亚测评", "综合评价：T1", cards), null);
  assert.equal(
    matchCostumeReview("泳装威廉测评", "综合评价：T0.5 建议抽！", [
      { id: "wei_lian_ming_na", name: "威廉明娜", nicknames: [], costumes: [{ name: "水上乐园女王" }] },
    ]),
    "wei_lian_ming_na"
  );
});
