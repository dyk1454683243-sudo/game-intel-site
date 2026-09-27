import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFourGamerRss,
  parseSteamComingSoonPayload,
} from "../../mcp-server/channel-parse.mjs";

test("steam coming soon keeps app url and as_of", () => {
  const items = parseSteamComingSoonPayload(
    {
      coming_soon: {
        items: [
          { id: 5250830, name: "Pawmlet - Wheat Farm" },
          { id: "", name: "skip" },
          { name: "no id" },
        ],
      },
    },
    { asOf: "2026-09-28", limit: 4 }
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "steam_coming_soon");
  assert.equal(items[0].as_of, "2026-09-28");
  assert.equal(items[0].url, "https://store.steampowered.com/app/5250830/");
  assert.equal(items[0].appid, "5250830");
});

test("4gamer radar keeps launch headlines and drops hardware", () => {
  const xml = `<?xml version="1.0"?>
<rdf:RDF xmlns:dc="http://purl.org/dc/elements/1.1/">
<item rdf:about="https://www.4gamer.net/games/a/">
<title>ホラードライビングシム「Prospice」，クローズドβテストの参加を受付中</title>
<link>https://www.4gamer.net/games/a/</link>
<dc:date>2026-09-27T17:13:06+09:00</dc:date>
</item>
<item rdf:about="https://www.4gamer.net/games/b/">
<title>配信者向けWebカメラ「Razer Kiyo」が発売に</title>
<link>https://www.4gamer.net/games/b/</link>
<dc:date>2026-09-27T12:00:00+09:00</dc:date>
</item>
<item rdf:about="https://www.4gamer.net/games/c/">
<title>［プレイレポ］のんびり異世界暮らし</title>
<link>https://www.4gamer.net/games/c/</link>
<dc:date>2026-09-28T00:00:00+09:00</dc:date>
</item>
</rdf:RDF>`;
  const radar = parseFourGamerRss(xml, { limit: 5, mode: "radar" });
  assert.equal(radar.length, 1);
  assert.equal(radar[0].source, "four_gamer");
  assert.equal(radar[0].url, "https://www.4gamer.net/games/a/");
  assert.equal(radar[0].as_of, "2026-09-27");
  const digest = parseFourGamerRss(xml, { limit: 5, mode: "digest" });
  assert.equal(digest.length, 2);
  assert.ok(digest.every((row) => !/Webカメラ/.test(row.title)));
});
