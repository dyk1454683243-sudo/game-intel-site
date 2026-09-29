import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  aliasPartNames,
  aliasesByCharacterId,
  filterCharacters,
  filterGames,
  mergeAliasDocs,
  renderCatalog,
  renderCharacter,
  renderFrame,
  renderGame,
  renderHome,
  renderWatchlist,
  safeHttpUrl,
} from "../public/ui/render.js";
import { portraitImgSrc, portraitTarget } from "../public/ui/portrait.js";
import { publishHumanHome } from "../scripts/export-games.mjs";

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(site, "public");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(publicDir, rel), "utf8"));
}

test("human shells point at the shared client", () => {
  const pages = {
    "index.html": "home",
    "ui/home.html": "home",
    "catalog/index.html": "catalog",
    "watchlist/index.html": "watchlist",
    "game/index.html": "game",
    "character/index.html": "character",
  };
  const home = fs.readFileSync(path.join(publicDir, "ui/home.html"), "utf8");
  assert.equal(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"), home);
  assert.equal(fs.readFileSync(path.join(site, "index.html"), "utf8"), home);
  for (const [rel, view] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(publicDir, rel), "utf8");
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, /src="\/ui\/app\.js"/);
    assert.match(html, /href="\/ui\/app\.css"/);
  }
});

test("publishHumanHome copies the shell and does not run on import", () => {
  const indexPath = path.join(publicDir, "v1/games/index.json");
  const before = fs.readFileSync(indexPath, "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gi-home-"));
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ui/home.html"),
    '<html><body data-view="home"><script src="/ui/app.js"></script></body></html>'
  );
  const written = publishHumanHome(dir);
  assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), written);
  assert.throws(() => publishHumanHome(dir + "-missing"), /missing human UI shell/);
  assert.equal(fs.readFileSync(indexPath, "utf8"), before);
});

test("catalog search finds an identity game and keeps deep games marked", () => {
  const index = readJson("v1/games/index.json");
  assert.equal(index.count, 84);
  const balatro = filterGames(index.games, { q: "小丑牌" });
  assert.equal(balatro.length, 1);
  assert.equal(balatro[0].id, "balatro");
  const html = renderCatalog(index, { q: "小丑牌" });
  assert.match(html, /尚无深耕/);
  assert.match(html, /balatro/);
  assert.match(html, /显示 1 部/);
  const deep = renderCatalog({ games: index.games.filter((game) => game.id === "hw") }, {});
  assert.match(deep, /已深耕/);
  assert.doesNotMatch(deep, /尚无深耕/);
  const steam = filterGames(index.games, { platform: "steam", kind: "stub" });
  assert.ok(steam.every((game) => game.stub === true && (game.platforms || []).includes("steam")));
});

test("identity card shows stub fields and hides guide conclusions", () => {
  const game = readJson("v1/games/balatro.json");
  const html = renderFrame("game", renderGame(game, {}));
  assert.match(html, /尚无深耕/);
  assert.match(html, /stub/);
  assert.match(html, /2379780/);
  assert.match(html, /小丑牌/);
  assert.match(html, /https:\/\/store\.steampowered\.com\/app\/2379780\//);
  assert.match(html, /<h2>出处<\/h2>/);
  assert.doesNotMatch(html, /<h2>强度<\/h2>/);
  assert.doesNotMatch(html, /抽取建议/);
  assert.doesNotMatch(html, /\/character\//);
  assert.doesNotMatch(html, /未见可靠出处/);
  const hostile = renderGame(
    {
      id: "balatro",
      name: "<script>alert(1)</script>",
      name_zh: "<b>x</b>",
      platforms: ["pc"],
      tags: ["indie"],
      sources: [{ label: "Steam", url: "javascript:alert(1)" }],
      stub: true,
      steam_appid: null,
    },
    {}
  );
  assert.doesNotMatch(hostile, /<script>/);
  assert.match(hostile, /&lt;script&gt;/);
  assert.doesNotMatch(hostile, /javascript:/);
  assert.match(hostile, /出处：未见可靠出处/);
});

test("watchlist keeps deep games and empty shells", () => {
  const html = renderWatchlist({
    watchlist: readJson("v1/watchlist.json"),
    catalog: readJson("v1/games/index.json"),
    guides: readJson("v1/guides/index.json"),
  });
  for (const name of ["地平线行者", "胜利女神：NIKKE", "棕色尘埃2", "蓝色星原：旅谣", "阿索拉：星之祈愿", "미래시", "Last Origin 2"]) {
    assert.match(html, new RegExp(name));
  }
  const cards = html.split("<article").slice(1);
  const card = (name) => cards.find((part) => part.includes(name));
  assert.doesNotMatch(card("地平线行者"), /尚无深耕/);
  assert.match(card("地平线行者"), /角色列表/);
  for (const name of ["蓝色星原：旅谣", "阿索拉：星之祈愿", "미래시", "Last Origin 2"]) {
    assert.match(card(name), /尚无深耕/);
    assert.match(card(name), /深耕目录为空/);
    assert.match(card(name), /stub/);
  }
});

test("deep game page lists characters and alias search", () => {
  const game = readJson("v1/games/hw.json");
  const guideIndex = readJson("v1/guides/hw/index.json");
  const aliases = aliasesByCharacterId(readJson("v1/guides/hw/aliases.json"));
  const html = renderGame(game, { guideIndex, aliasesById: aliases, q: "修女" });
  assert.match(html, /3279780/);
  assert.match(html, /\/character\/\?game=hw&amp;id=lysandria/);
  assert.match(html, /class="char-row"/);
  assert.match(html, /class="portrait"/);
  const lysRow = guideIndex.characters.find((card) => card.id === "lysandria");
  assert.equal(portraitTarget(lysRow.portrait)?.hostname, "cdnimg-v2.gamekee.com");
  assert.match(html, /\/v1\/portrait\?u=/);
  assert.doesNotMatch(html, /尚无深耕/);
  const bare = renderGame(game, {
    guideIndex: {
      characters: [{ id: "no_face", name: "无头像", name_zh: "无头像", stub: true, portrait: null }],
    },
  });
  assert.match(bare, /无图/);
  assert.match(bare, /placeholder/);
  assert.doesNotMatch(bare, /<img/);
  assert.equal(filterCharacters(guideIndex.characters, "修女", aliases).length, 1);
  const nikke = readJson("v1/guides/nikke/aliases.json");
  assert.deepEqual(aliasPartNames(nikke), [
    "aliases.p1.json",
    "aliases.p2.json",
    "aliases.p3.json",
    "aliases.p4.json",
  ]);
  const merged = mergeAliasDocs([nikke, { aliases: { 茨瓦伊: { id: "zwei", name: "茨瓦伊", kind: "character" } } }]);
  assert.equal(aliasesByCharacterId(merged).zwei[0], "茨瓦伊");
});

test("character pages use stored guide fields and keep gaps visible", () => {
  const lysCard = readJson("v1/guides/hw/characters/lysandria.json");
  const lys = renderCharacter("hw", lysCard);
  assert.match(lys, /<h2>强度<\/h2>/);
  assert.match(lys, /class="portrait lg"/);
  assert.match(lys, /头像出处/);
  assert.match(lys, new RegExp(`gamekee-entry-icon:hw:${lysCard.gamekee_entry_id}`));
  assert.equal(portraitImgSrc(lysCard.portrait).startsWith("/v1/portrait?u="), true);
  assert.match(lys, /\/v1\/portrait\?u=/);
  assert.match(lys, /<h2>服装<\/h2>/);
  assert.match(lys, /<h2>技能<\/h2>/);
  assert.match(lys, /<h2>出处<\/h2>/);
  assert.match(lys, /旋转斩/);
  assert.match(lys, /有1专武解锁机制即可/);
  assert.match(lys, /优菲特尔/);
  assert.match(lys, /https:\/\/www\.gamekee\.com\/hw\/634473\.html/);
  assert.match(lys, /未见可靠出处/);
  assert.doesNotMatch(lys, /抽取建议：未见可靠出处/);

  const grey = renderCharacter("bd2", readJson("v1/guides/bd2/characters/ge_lei.json"));
  assert.match(grey, /迷雾神射手/);
  assert.match(grey, /T2/);
  assert.match(grey, /抽取建议：不抽/);
  assert.match(grey, /https:\/\/www\.gamekee\.com\/zsca2\/593582\.html/);

  const thin = renderCharacter("nikke", readJson("v1/guides/nikke/characters/zhen-li.json"));
  assert.match(thin, /summary\.stub/);
  assert.match(thin, /未见可靠出处/);
  assert.match(thin, /https:\/\/www\.gamekee\.com\/nikke\/599374\.html/);
  assert.doesNotMatch(thin, /T0/);

  const zwei = renderCharacter("nikke", readJson("v1/guides/nikke/characters/zwei.json"));
  assert.match(zwei, /穿透算式/);
  assert.match(zwei, /综合 B/);
  assert.match(zwei, /https:\/\/www\.prydwen\.gg\/nikke\/characters\/zwei/);

  const hostilePortrait = renderCharacter("hw", {
    id: "x",
    name: "<img>",
    game: "hw",
    portrait: "javascript:alert(1)",
    portrait_source: "https://evil.example/a.png",
    portrait_via: "nope",
  });
  assert.match(hostilePortrait, /无图/);
  assert.match(hostilePortrait, /头像：未见可靠出处/);
  assert.doesNotMatch(hostilePortrait, /javascript:/);
  assert.doesNotMatch(hostilePortrait, /<img/);

  const blocked = renderCharacter("star", {
    id: "made-up",
    name: "虚构",
    game: "star",
    summary: { tier: "T0", pull: "必抽", sources: ["https://example.com/a"] },
    portrait: "https://cdnimg-v2.gamekee.com/wiki2.0/images/a.png",
    skills: [{ name: "编造技能", summary: "100%" }],
  });
  assert.match(blocked, /尚无深耕/);
  assert.doesNotMatch(blocked, /cdnimg/);
  assert.doesNotMatch(blocked, /T0/);
  assert.doesNotMatch(blocked, /必抽/);
  assert.doesNotMatch(blocked, /编造技能/);
});

test("home renders digest and radar without turning radar into a catalog", () => {
  const today = "2026-09-28";
  const html = renderHome({
    digest: readJson("v1/digest.json"),
    radar: readJson("v1/radar.json"),
    today,
  });
  assert.match(html, /今日摘要/);
  assert.match(html, /雷达/);
  assert.match(html, /第二届近卫征集大赛/);
  assert.match(html, /阿索拉：星之祈愿/);
  assert.match(html, /href="\/game\/\?id=hw"/);
  assert.doesNotMatch(html, /不是上海当日/);
  const hostile = renderHome({
    digest: {
      meta: { generated_at: "2020-01-01T00:00:00+08:00", fixture: true },
      digests: [{ game: "hw", name: "地平线行者", count: 1, items: [{ title: "x", url: "javascript:alert(1)" }] }],
    },
    radar: { meta: { generated_at: "2026-09-28T00:00:00+08:00" }, keywords: ["CBT"], items: [] },
    today,
  });
  assert.match(hostile, /fixture/);
  assert.match(hostile, /不是上海当日/);
  assert.doesNotMatch(hostile, /javascript:/);
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
});
