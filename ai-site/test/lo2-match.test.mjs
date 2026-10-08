import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  acceptsLo2DigestItem,
  LO2_GAMEKEE_QUERIES,
  mentionsLo2Sequel,
} from "../../mcp-server/lo2-match.js";

const ROOT = new URL("../../", import.meta.url);

test("lo2 rejects a Last Origin 1 maintenance title and keeps sequel titles", () => {
  const lo1 = {
    title: "【台服】10.08 更新公告",
    url: "https://www.gamekee.com/www/723417.html",
    source: "gamekee",
  };
  assert.equal(mentionsLo2Sequel(lo1.title), false);
  assert.equal(acceptsLo2DigestItem(lo1), false);

  for (const title of ["Last Origin 2 開發", "라스트오리진2"]) {
    assert.equal(mentionsLo2Sequel(title), true, title);
    assert.equal(
      acceptsLo2DigestItem({
        title,
        url: "https://example.com/press",
        source: "gamekee",
      }),
      true,
      title
    );
  }
});

test("lo2 sequel gate drops LO1, R+, and unrelated GameKee hits", () => {
  const reject = [
    "【台服】10.08 更新公告",
    "【台服】 09.10 更新公告",
    "【韩服】2026 LAST ORIGIN 中秋活动",
    "【日服】9月3日维修通知",
    "沉默之沼泽满星与竞速",
    "今天的虎鲸号 891-893",
    "回归玩家求教，里约2-2C 超高配阵容",
    "Last Origin",
    "最后的起源",
    "最後的起源",
    "Last Origin R+",
    "《LASTORIGINR+》运营团队",
    "LAST ORIGIN：最後的起源",
    "隐遁女神的宫殿（第2部）",
    "【台服】Last Origin 更新：隐遁女神的宫殿（第2部）",
    "VALOFE",
    "【1周年】灵梦",
    "ミスティア・ローレライ",
    "Last Origin 20",
    "Last Origin III",
    "韩国舰Like社保手游最后的起源3月21日台服中文上线",
    "续作",
    "후속작",
  ];
  for (const title of reject) {
    assert.equal(mentionsLo2Sequel(title), false, title);
    assert.equal(
      acceptsLo2DigestItem({
        title,
        url: "https://www.gamekee.com/www/723417.html",
        source: "gamekee",
      }),
      false,
      title
    );
  }

  const keep = [
    "Last Origin 2 開發",
    "라스트오리진2",
    "라스트 오리진 2",
    "Last Origin II",
    "最后的起源2",
    "最後的起源2",
    "Last Origin「2」",
    "VALOFE — Last Origin 2 开发本格化 / 组队 (GameChosun)",
    "VALOFE launches Last Origin 2 development (Inven Global EN)",
    "LO要出2了？！Valofe 正式启动《最后的起源》续作研发 世界观将拓展至宇宙舞台",
    "Last Origin 续作",
    "라스트오리진 후속작",
  ];
  for (const title of keep) {
    assert.equal(mentionsLo2Sequel(title), true, title);
  }
});

test("lo2 watchlist keywords are sequel phrases, not the LO1 name or publisher", () => {
  const files = [
    "data/watchlist.json",
    "ai-site/v1/watchlist.json",
    "ai-site/public/v1/watchlist.json",
  ];
  for (const rel of files) {
    const doc = JSON.parse(fs.readFileSync(new URL(rel, ROOT), "utf8"));
    const keywords = Array.isArray(doc.lo2?.keywords)
      ? doc.lo2.keywords
      : doc.games.find((g) => g.id === "lo2").keywords;
    assert.ok(keywords.includes("Last Origin 2"), rel);
    assert.ok(keywords.includes("라스트오리진2"), rel);
    assert.equal(keywords.includes("VALOFE"), false, rel);
    assert.equal(keywords.includes("Last Origin"), false, rel);
    assert.equal(keywords.includes("最后的起源"), false, rel);
    assert.equal(keywords.includes("最後的起源"), false, rel);
    for (const kw of keywords) {
      assert.equal(mentionsLo2Sequel(kw), true, `${rel} ${kw}`);
    }
  }
  for (const q of LO2_GAMEKEE_QUERIES) {
    assert.equal(mentionsLo2Sequel(q), true, q);
    assert.notEqual(q, "VALOFE");
    assert.notEqual(q, "Last Origin");
  }
  const defaults = fs.readFileSync(
    new URL("mcp-server/index-lib-00a.js", ROOT),
    "utf8"
  );
  const lo2Block = defaults.split("lo2:")[1].split("asora:")[0];
  assert.match(lo2Block, /最后的起源2/);
  assert.doesNotMatch(lo2Block, /"VALOFE"/);
});

test("exported lo2 digest and seen set do not keep LO1 GameKee rows", () => {
  const digest = JSON.parse(
    fs.readFileSync(new URL("ai-site/public/v1/digest.json", ROOT), "utf8")
  );
  const lo2 = digest.digests.find((row) => row.game === "lo2");
  assert.ok(lo2);
  assert.ok(lo2.items.length >= 1);
  for (const it of lo2.items) {
    assert.equal(acceptsLo2DigestItem(it), true, it.title);
    assert.equal(/gamekee\.com\/www\/\d+\.html/.test(it.url), false, it.url);
  }
  const seen = JSON.parse(
    fs.readFileSync(new URL("data/digest-seen.json", ROOT), "utf8")
  );
  for (const url of seen.games.lo2.fingerprints) {
    assert.equal(/gamekee\.com\/www\//.test(url), false, url);
  }
  const feed = JSON.parse(
    fs.readFileSync(new URL("ai-site/public/v1/feed.json", ROOT), "utf8")
  );
  const lo2Feed = (feed.items || []).filter((it) => it.game_id === "lo2");
  assert.ok(lo2Feed.length >= 1);
  for (const it of lo2Feed) {
    assert.equal(acceptsLo2DigestItem(it), true, it.title);
  }
});
