import assert from "node:assert/strict";
import test from "node:test";
import { filterCharacters, renderCharacter, renderGame, renderMe } from "../public/ui/render.js";
import { portraitTarget } from "../public/ui/portrait.js";
import { buildPersonal } from "../public/ui/personal.js";

const game = {
  id: "limbus-company",
  name: "Limbus Company",
  name_zh: "边狱公司",
  platforms: ["steam", "pc", "mobile"],
  tags: ["gacha"],
  sources: [{ label: "Steam", url: "https://store.steampowered.com/app/1973530/" }],
  stub: false,
  watchlist: true,
  steam_appid: 1973530,
  as_of: "2026-10-17",
  timezone: "Asia/Shanghai",
};

const guideIndex = {
  character_count: 2,
  characters: [
    {
      id: "blade-lineage-salsu-yi-sang",
      name: "Blade Lineage Salsu Yi Sang",
      name_zh: "Blade Lineage Salsu Yi Sang",
      stub: false,
      portrait: "https://cdn.prydwen.gg/images/limbus-company/characters/blade-lineage-salsu-yi-sang_mid.webp",
      sinner: { id: "yi-sang", name_en: "Yi Sang", name_zh: "李箱", order: 1 },
    },
    {
      id: "lcb-sinner-faust",
      name: "LCB Sinner Faust",
      name_zh: "LCB Sinner Faust",
      stub: false,
      sinner: { id: "faust", name_en: "Faust", name_zh: "浮士德", order: 2 },
    },
  ],
};

test("limbus game page groups identity cards by sinner", () => {
  const html = renderGame(game, { guideIndex, q: "" });
  assert.match(html, /人格/);
  assert.match(html, /按罪人分组/);
  assert.match(html, /<h3>李箱 <code>yi-sang<\/code><\/h3>/);
  assert.match(html, /<h3>浮士德 <code>faust<\/code><\/h3>/);
  const yi = html.indexOf("yi-sang");
  const faust = html.indexOf(">faust<");
  assert.ok(yi > 0 && faust > yi);
  assert.match(html, /\/character\/\?game=limbus-company&amp;id=blade-lineage-salsu-yi-sang/);
  assert.equal(filterCharacters(guideIndex.characters, "李箱", {}).length, 1);
  assert.equal(filterCharacters(guideIndex.characters, "faust", {}).length, 1);
});

test("limbus identity card shows sinner and cited sin counts", () => {
  const html = renderCharacter("limbus-company", {
    id: "blade-lineage-salsu-yi-sang",
    name: "Blade Lineage Salsu Yi Sang",
    game: "limbus-company",
    stub: false,
    as_of: "2026-10-17",
    rarity: "000",
    sinner: {
      id: "yi-sang",
      name_zh: "李箱",
      name_en: "Yi Sang",
      source: "https://www.gamekee.com/limbus/585110.html",
    },
    sin_affinities: [
      { sin: "Pride", count: 3 },
      { sin: "Wrath", count: 2 },
    ],
    skills: [{ name: "Striker's Stance", type: "skill1", sin: "Pride", summary: "Skill Power 6" }],
    summary: {
      tier: "Prydwen 角色页 Endgame B",
      stub: false,
      sources: ["https://www.prydwen.gg/limbus-company/identities/blade-lineage-salsu-yi-sang"],
    },
    sources: ["https://www.prydwen.gg/limbus-company/identities/blade-lineage-salsu-yi-sang"],
    portrait: "https://cdn.prydwen.gg/images/limbus-company/characters/blade-lineage-salsu-yi-sang_full.webp",
    portrait_source: "https://www.prydwen.gg/limbus-company/identities/blade-lineage-salsu-yi-sang",
    portrait_via: "prydwen-identity:blade-lineage-salsu-yi-sang",
  });
  assert.match(html, /罪人/);
  assert.match(html, /李箱/);
  assert.match(html, /罪孽属性/);
  assert.match(html, /Pride ×3/);
  assert.match(html, /Striker's Stance/);
  assert.doesNotMatch(html, /尚无深耕/);
  assert.equal(
    portraitTarget("https://cdn.prydwen.gg/images/limbus-company/characters/blade-lineage-salsu-yi-sang_full.webp")?.hostname,
    "cdn.prydwen.gg"
  );
});

test("follow list groups limbus identities under their sinner", () => {
  const doc = buildPersonal({
    follows: {
      games: [],
      chars: [
        { game: "limbus-company", id: "blade-lineage-salsu-yi-sang" },
        { game: "limbus-company", id: "effloresced-e-g-o-spicebush-yi-sang" },
        { game: "nikke", id: "modernia" },
      ],
    },
    feed: { items: [] },
    digest: { digests: [] },
    namesByKey: {
      "limbus-company:blade-lineage-salsu-yi-sang": {
        name: "Blade Lineage Salsu Yi Sang",
        aliases: [],
        sinner: { id: "yi-sang", name_zh: "李箱", order: 1 },
      },
      "limbus-company:effloresced-e-g-o-spicebush-yi-sang": {
        name: "Effloresced E.G.O Spicebush Yi Sang",
        aliases: [],
        sinner: { id: "yi-sang", name_zh: "李箱", order: 1 },
      },
      "nikke:modernia": { name: "Modernia", aliases: [], sinner: null },
    },
    today: "2026-10-17",
  });
  const html = renderMe(doc);
  assert.match(html, /<h3>李箱 <code>yi-sang<\/code><\/h3>/);
  assert.match(html, /blade-lineage-salsu-yi-sang/);
  assert.match(html, /effloresced-e-g-o-spicebush-yi-sang/);
  assert.match(html, /nikke:modernia/);
  const sinnerAt = html.indexOf("李箱");
  const bladeAt = html.indexOf("blade-lineage-salsu-yi-sang");
  const spiceAt = html.indexOf("effloresced-e-g-o-spicebush-yi-sang");
  assert.ok(sinnerAt < bladeAt && sinnerAt < spiceAt);
});
