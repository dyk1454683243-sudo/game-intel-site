# guides/zenless-zone-zero — 绝区零

代理人卡、卡池和兑换码。

- Import: `node mcp-server/scripts/import-zzz-catalog.mjs`
- 技能、属性、稀有度、阵营、技能升级推荐、配队来自 BWIKI 角色图鉴 wikitext（https://wiki.biligame.com/zzz/角色图鉴）。
- 英文 slug 与立绘优先对 Prydwen 代理人列表（https://www.prydwen.gg/zenless/characters ，页面写 Last updated 10/October/2026）。GameKee `game-alias: zzz` 角色夹能唯一对上名字时，改用该条目的 icon。
- 配队只收 BWIKI `角色/配队表` 里每个位置都能唯一对上角色 id 的组合。对不上的整队不收。
- 不编造 T 档。Prydwen 3.2 梯度总页的公开文本没有把 T 档和角色名绑在一起。角色页 Ratings 写出 T 档时，按该页栏目收录（常见是 Endgame Modes 一档），`summary.stub` 改为 false。2026-10-21 复核时，菲欧妮页 Last updated 20/October/2026、赛维里安页 Last updated 10/October/2026，Ratings 仍没有 T 档。不收上线前的技能稿。
- BWIKI 技能模板没写具体效果的角色保持 `stub: true`，不补技能名。菲欧妮、赛维里安在 2026-10-21 仍是空模板。专属音擎名和调频频道名只转写简中 3.3 更新公告。
- 卡池和兑换码只转写官方公告。3.3 上期的窗口在简中「3.3版本限时频段（上期）」正文里，开始语是「3.3版本更新后」，不改写成维护开始钟点。3.3 下期还没有专帖，钟点仍只在 2026/10/09 前瞻配图里。
