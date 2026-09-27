# guides/bd2 — Brown Dust 2

Character cards from GameKee wiki (`game-alias: zsca2`).

- Import: `node mcp-server/scripts/import-bd2-catalog.js`
- Enrich: `node mcp-server/scripts/enrich-bd2-cards.js` (CDN `baseData` + `styleData` 服装/技能; curl if Node fetch CF-blocked)
- Never invent skill names/numbers. Incomplete cards must set `"stub": true`.

Skills are per-costume (服装); talent is included as `type: "talent"` when present on the 图鉴.

Costume conclusions, when present, copy GameKee 服装测评摘要中的「综合评价」only. The image-only 总强度榜 is not transcribed. Cards without that sentence stay `summary.stub: true`.
