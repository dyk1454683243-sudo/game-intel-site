# guides/bd2 — Brown Dust 2

Character cards from GameKee wiki (`game-alias: zsca2`).

- Import: `node mcp-server/scripts/import-bd2-catalog.js`
- Enrich: `node mcp-server/scripts/enrich-bd2-cards.js` (CDN `baseData` + `styleData` 服装/技能; curl if Node fetch CF-blocked)
- Never invent skill names/numbers. Incomplete cards must set `"stub": true`.

Skills are per-costume (服装); talent is included as `type: "talent"` when present on the 图鉴.

Costume conclusions, when present, copy GameKee 服装测评摘要中的「综合评价」only. The image-only 总强度榜 is not transcribed. Cards without that sentence stay `summary.stub: true`.

`skill_prio` copies a 测评 sentence that states 潜能开启建议 / 技能优先级 / 加点. Prefix the costume name when the article title names one costume on the card.

`teams` stays `{}` unless a 测评, `zsca2/593518`, or another cited roster states a comp. A costume-scoped line uses the costume name as the key. `comp` is a short cited line. Sample parties from `http://cymmina.gamependium.com/browndust2/teams.html` (Last-Modified 2026-08-20 GMT) are copied only when every listed character maps to one card id. Bahamut `bsn=76207&snA=4032` floor 4（2026-02-10 edit）reference screenshots are copied only when the formation screen prints five character names and each name maps to one card. The dark magic screenshot writes 索妮亞 with costume 潛藏的夢; that costume is only on the 索尼娅 card, so the line uses the card name. Screenshots whose names could not be read stay out. Optional swaps in the post text are not extra teams. Do not invent T-tiers. Existing `teams` are left in place.
