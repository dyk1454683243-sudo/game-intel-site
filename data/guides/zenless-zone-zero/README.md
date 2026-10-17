# guides/zenless-zone-zero — 绝区零

代理人卡、卡池和兑换码。

- Import: `node mcp-server/scripts/import-zzz-catalog.mjs`
- 技能、属性、稀有度、阵营、技能升级推荐、配队来自 BWIKI 角色图鉴 wikitext（https://wiki.biligame.com/zzz/角色图鉴）。
- 英文 slug 与立绘优先对 Prydwen 代理人列表（https://www.prydwen.gg/zenless/characters ，页面写 Last updated 10/October/2026）。GameKee `game-alias: zzz` 角色夹能唯一对上名字时，改用该条目的 icon。
- 配队只收 BWIKI `角色/配队表` 里每个位置都能唯一对上角色 id 的组合。对不上的整队不收。
- 不编造 T 档。Prydwen 3.2 梯度总页的公开文本没有把 T 档和角色名绑在一起。角色页 Ratings 写出 T 档时，按该页栏目收录（常见是 Endgame Modes 一档），`summary.stub` 改为 false。菲欧妮、赛维里安的角色页没有 T 档，保持 stub。
- BWIKI 技能模板没写具体效果的角色保持 `stub: true`，不补技能名。
- 卡池和兑换码只转写官方公告。3.3 上下半的钟点在 2026/10/09 前瞻配图里，正文没有这段时刻。
