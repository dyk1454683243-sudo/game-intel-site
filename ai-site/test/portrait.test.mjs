import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { portraitImgSrc, portraitTarget, servePortrait } from "../public/ui/portrait.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataGuides = path.join(root, "data", "guides");
const publicGuides = path.join(root, "ai-site", "public", "v1", "guides");
const DEEP = ["hw", "nikke", "bd2"];
const ENTRY_LIST = "https://www.gamekee.com/v1/entry/list?page_no=1&limit=2000";

function cards(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

test("portrait urls stay on the public image hosts", () => {
  const gamekee = "https://cdnimg-v2.gamekee.com/wiki2.0/images/w_1000/h_1300/50448/236746/2025/2/10/688380.png";
  const sized = "https://cdnimg-v2.gamekee.com/wiki2.0/pro/50448/images/w_1000/h_1300/157597/2026/6/16/34447110mrmw5hvn.png";
  const prydwen = "https://cdn.prydwen.gg/images/nikke/characters/biscuit.webp";
  assert.equal(portraitTarget(gamekee)?.hostname, "cdnimg-v2.gamekee.com");
  assert.equal(portraitTarget(sized)?.hostname, "cdnimg-v2.gamekee.com");
  assert.equal(portraitTarget("https://cdnimg-v2.gamekee.com/wiki2.0/pro/50448/secret.png"), null);
  assert.equal(portraitImgSrc(gamekee).startsWith("/v1/portrait?u="), true);
  assert.equal(portraitImgSrc(prydwen), prydwen);
  for (const raw of [
    "javascript:alert(1)",
    "http://cdnimg-v2.gamekee.com/wiki2.0/images/a.png",
    "https://cdnimg-v2.gamekee.com/wiki2.0/images/a.png?x=1",
    "https://cdnimg-v2.gamekee.com/other/a.png",
    "https://cdnimg-v2.gamekee.com.evil/wiki2.0/images/a.png",
    "https://user:pass@cdnimg-v2.gamekee.com/wiki2.0/images/a.png",
    "https://evil.example/wiki2.0/images/a.png",
  ]) {
    assert.equal(portraitTarget(raw), null, raw);
    assert.equal(portraitImgSrc(raw), "");
  }
});

test("portrait proxy refuses a redirect off the image host", async () => {
  const raw = "https://cdnimg-v2.gamekee.com/wiki2.0/images/a.png";
  const res = await servePortrait(raw, async () => {
    return new Response("", { status: 302, headers: { location: "https://evil.example/a.png" } });
  });
  assert.equal(res.status, 502);
  assert.equal(await res.text(), "bad_redirect");
});

test("hw nikke and bd2 cards store a cited portrait or null", () => {
  const totals = {};
  for (const game of DEEP) {
    const rows = cards(path.join(dataGuides, game, "characters"));
    assert.ok(rows.length > 0, game);
    let images = 0;
    for (const card of rows) {
      assert.ok("portrait" in card, `${game}/${card.id} missing portrait`);
      if (card.portrait == null) {
        assert.equal(card.portrait_source, null, card.id);
        assert.equal(card.portrait_via, null, card.id);
        continue;
      }
      images++;
      const target = portraitTarget(card.portrait);
      assert.ok(target, `${card.id} portrait rejected`);
      assert.match(card.portrait_source, /^https:\/\/\S+$/);
      assert.equal(typeof card.portrait_via, "string");
      if (target.hostname === "cdnimg-v2.gamekee.com") {
        assert.equal(card.portrait_source, ENTRY_LIST);
        assert.equal(card.portrait_via, `gamekee-entry-icon:${game === "bd2" ? "zsca2" : game}:${Number(card.gamekee_entry_id)}`);
      } else {
        const slug = card.portrait_via.slice("prydwen-character:".length);
        assert.match(card.portrait_via, /^prydwen-character:[a-z0-9-]+$/);
        assert.equal(card.portrait_source, `https://www.prydwen.gg/nikke/characters/${slug}`);
        assert.ok(
          card.portrait === `https://cdn.prydwen.gg/images/nikke/characters/${slug}.webp` ||
            card.portrait === `https://cdn.prydwen.gg/images/nikke/characters/${slug}_card.webp`,
          card.id
        );
        assert.ok(
          (card.sources || []).some((url) => String(url).replace(/\/$/, "") === card.portrait_source),
          card.id
        );
      }
      const published = JSON.parse(
        fs.readFileSync(path.join(publicGuides, game, "characters", `${card.id}.json`), "utf8")
      );
      assert.equal(published.portrait, card.portrait);
      assert.equal(published.portrait_source, card.portrait_source);
      assert.equal(published.portrait_via, card.portrait_via);
    }
    const index = JSON.parse(fs.readFileSync(path.join(publicGuides, game, "index.json"), "utf8"));
    assert.equal(index.characters.length, rows.length);
    for (const row of index.characters) {
      const card = rows.find((item) => item.id === row.id);
      assert.equal(row.portrait, card.portrait);
    }
    totals[game] = { cards: rows.length, images, missing: rows.length - images };
    assert.ok(images >= 10, `${game} expected several portraits, got ${images}`);
  }
  assert.ok(totals.hw.images >= 40);
  assert.ok(totals.bd2.images >= 40);
  assert.ok(totals.nikke.images >= 40);

  for (const game of ["star", "asora", "miraesi", "lo2"]) {
    const dir = path.join(dataGuides, game, "characters");
    if (!fs.existsSync(dir)) continue;
    for (const card of cards(dir)) {
      assert.equal("portrait" in card, false, `${game}/${card.id}`);
    }
  }
});
