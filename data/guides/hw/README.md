# guides/hw — Horizon Walker

Character cards from GameKee (`game-alias: hw`).

- Import: `node mcp-server/scripts/import-hw-catalog.js`
- Enrich: `node mcp-server/scripts/enrich-hw-cards.js`
- Team/build lines: `node mcp-server/scripts/fill-team-build.mjs --only hw`

`skill_prio` is the 图鉴 加点推荐, plus a 测评「技能升级」sentence when that section states an order.

`teams` keys:

| key | value |
| --- | --- |
| `dopamine_auto` | `A` / `B` / `C`, the auto roster in `dopamine-auto.json` |
| `story` | 主线开荒，`√` or `×` from GameKee `hw/665170` 适用场合表 |
| `rift_45` | 45层裂隙 |
| `dopamine` | 多巴胺契合度，not the A/B/C roster letter |
| `spec_ops` | 特殊作战 |
| `union` | 总力战 |
| `training` | 特殊训练场 |
| `comp` | verbatim 配队 sentences from that table's 简评, a character 测评「配队」section, or the 图鉴抽取建议 when it names a team |

`√` / `×` are the table marks. The page calls them 使用推荐度; `×` does not mean the mode is impossible. Leave `teams` `{}` when no source states a mode or a team. `hw/641248` says 请不要参考 and is not copied.
