# guides/limbus-company

Limbus Company identity cards. One card is one Identity, not one sinner. `sinner` groups the twelve sinners.

- Build: `node mcp-server/scripts/build-limbus-cards.mjs` after `node mcp-server/scripts/fetch-limbus-pages.mjs`
- Prydwen list used for the catalog: https://www.prydwen.gg/limbus-company/identities (page said Last updated 08/October/2026, 189 identities).
- Skills, sin affinities, rarity, Endgame letter, and portraits come from that identity's Prydwen page.
- Tier placements come from https://www.prydwen.gg/limbus-company/tier-list only when the slug is on that page. No grade is invented. `summary.stub: true` when both the page letter and the tier list are absent.
- Sinner Chinese names are the GameKee sinner entries (`game-alias: limbus`, pid 117395). They are not aliases of a single identity.
- Banners are transcribed from Project Moon's Steam scheduled-update notices. Times stay in KST (`Asia/Seoul`, UTC+9, no DST).
- `codes.json` records that the checked sources did not publish a code string.
- Teams: Prydwen team database（页面 Last updated 22/May/2026）每个 `limbus-team` 盒子里的人格链接。一盒 5 到 12 个、且每个链接都能唯一对上人格 id 时收录，每张卡最多两条。没出现在这 10 支队伍里的人格保持空 `teams`。评论里的外号不收。
