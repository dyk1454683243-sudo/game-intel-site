# guides/nikke

NIKKE character guide cards.

- Import stubs: `node mcp-server/scripts/import-nikke-catalog.js`
- Enrich (GameKee CDN / Prydwen HTML, never invent skills): `node mcp-server/scripts/enrich-nikke-cards.js [--limit 40]`
- Mark incomplete cards with `"stub": true`. Never invent skill names or numbers.
- Sources: GameKee `game-alias: nikke` 角色图鉴 (entry pid 64599) + Prydwen `/nikke/characters/{slug}`.
- Conclusions: Nikke.gg tier list (`https://nikke.gg/tier-list/`, September 2026) supplies Combined/Story/Boss/PvP when the slug matches. Cards absent from that list stay `summary.stub: true`（未见可靠出处）. Skill lines missing from GameKee are filled from the Nikke.gg character API at level 1 only when every placeholder has a published value.
- `skill_prio`: `技能顺序` / `推荐练度` / `预算练度` from the Nikke.gg tier row or character API `skillprio`. Leave empty when that object has no order or levels.
- `teams.comp`: cited roster lines. GameKee `nikke/682131` and character 测评 lines that were already on a card stay as they are. Empty cards can take a roster from Nikke.gg Meta (`https://nikke.gg/meta/`) or Prydwen (`https://www.prydwen.gg/nikke/teams-database`, or that character's Prydwen page) only when every member maps to one character id. Each line carries the source URL and `as_of`. `fill-team-build.mjs` must not clear existing `teams`.
