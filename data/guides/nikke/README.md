# guides/nikke

NIKKE character guide cards.

- Import stubs: `node mcp-server/scripts/import-nikke-catalog.js`
- Enrich (GameKee CDN / Prydwen HTML, never invent skills): `node mcp-server/scripts/enrich-nikke-cards.js [--limit 40]`
- Mark incomplete cards with `"stub": true`. Never invent skill names or numbers.
- Sources: GameKee `game-alias: nikke` 角色图鉴 (entry pid 64599) + Prydwen `/nikke/characters/{slug}`.
- Conclusions: Nikke.gg tier list (`https://nikke.gg/tier-list/`, September 2026) supplies Combined/Story/Boss/PvP when the slug matches. Cards absent from that list stay `summary.stub: true`（未见可靠出处）. Skill lines missing from GameKee are filled from the Nikke.gg character API at level 1 only when every placeholder has a published value.
- `skill_prio`: `技能顺序` / `推荐练度` / `预算练度` from the Nikke.gg tier row or character API `skillprio`. Leave empty when that object has no order or levels.
- `teams.comp`: short sentences copied from GameKee `nikke/682131`（底层配队）or a character 测评 `配队` section. Partner names appear only when that sentence names them. Empty `{}` when the page does not state a team.
