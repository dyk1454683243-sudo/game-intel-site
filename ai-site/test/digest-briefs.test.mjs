import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyDigestBriefs, loadDigestBriefs } from "../../mcp-server/digest-briefs.js";
import { renderHome } from "../public/ui/render.js";

test("digest briefs overlay a matching URL and pin a missing one", () => {
  const briefs = [
    {
      game: "bd2",
      title: "Resource update",
      url: "https://www.browndust2.com/en-us/news/view?id=01M3KNK923NR4P7568ECBR3JX5",
      source: "official",
      date: "2026-09-28T09:30:14.367Z",
      summary: "官方公告摘要",
    },
    {
      game: "nikke",
      title: "灰姑娘篇",
      url: "https://www.gamekee.com/nikke/722533.html",
      source: "gamekee",
      summary: "中文字幕摘要",
    },
  ];
  const overlaid = applyDigestBriefs(
    [
      {
        title: "other",
        url: "https://www.gamekee.com/nikke/722533.html",
        source: "gamekee",
        summary: "raw scrape",
      },
      { title: "b", url: "https://example.com/b", source: "gamekee" },
    ],
    [briefs[1]],
    { limit: 5, pin: true }
  );
  assert.equal(overlaid[0].summary, "中文字幕摘要");
  assert.equal(overlaid.length, 2);

  const pinned = applyDigestBriefs(
    [{ title: "old", url: "https://example.com/old", source: "official" }],
    [briefs[0]],
    { limit: 5, pin: true }
  );
  assert.equal(pinned[0].url, briefs[0].url);
  assert.equal(pinned[0].summary, "官方公告摘要");
  assert.equal(pinned[1].url, "https://example.com/old");

  const morning = applyDigestBriefs(
    [{ title: "old", url: "https://example.com/old", source: "official" }],
    [briefs[0]],
    { limit: 5, pin: false }
  );
  assert.equal(morning.length, 1);
  assert.equal(morning[0].url, "https://example.com/old");
});

test("repo digest briefs are https and name the two triage items", () => {
  const rows = loadDigestBriefs(new URL("../../data", import.meta.url).pathname);
  const urls = rows.map((row) => row.url);
  assert.ok(urls.includes("https://www.browndust2.com/en-us/news/view?id=01M3KNK923NR4P7568ECBR3JX5"));
  assert.ok(urls.includes("https://www.gamekee.com/nikke/722533.html"));
  assert.ok(rows.every((row) => row.summary.length > 20 && row.game));
  const digest = JSON.parse(
    fs.readFileSync(new URL("../public/v1/digest.json", import.meta.url), "utf8")
  );
  const html = renderHome({ digest, radar: { items: [] } });
  assert.match(html, /矿坑之灵/);
  assert.match(html, /小小童话集/);
  assert.match(html, /01M3KNK923NR4P7568ECBR3JX5/);
  assert.match(html, /722533\.html/);
});
