# guides/nikke

NIKKE character guide cards.

- Import stubs: `node mcp-server/scripts/import-nikke-catalog.js`
- Enrich (GameKee CDN / Prydwen HTML, never invent skills): `node mcp-server/scripts/enrich-nikke-cards.js [--limit 40]`
- Mark incomplete cards with `"stub": true`. Never invent skill names or numbers.
- Sources: GameKee `game-alias: nikke` 角色图鉴 (entry pid 64599) + Prydwen `/nikke/characters/{slug}`.
