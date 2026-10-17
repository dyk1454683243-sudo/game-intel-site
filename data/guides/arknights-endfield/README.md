# guides/arknights-endfield — 明日方舟：终末地

34 名干员。官网列表有 35 个位置，因为管理员有 `endministrator1` 和 `endministrator2` 两张立绘，职业、属性、星级相同，收成一张卡。

- 身份：`https://endfield.hypergryph.com/operator` 与 `https://endfield.gryphline.com/en-us/operator`
- 技能和属性：GameKee `game-alias: zmd` 图鉴。图鉴没有的干员用 Prydwen 角色页的技能正文。
- 强度：Prydwen 角色页里紧挨 `Umbral Monument` 的字母。没有这行就 `summary.stub: true`，不编档。
- 配队：Prydwen `###### Team Members` 里正好 4 个能对上角色 id 的名字。
- 卡池：`https://endfield.gryphline.com/en-us/news/9560`、`/4489`、`/2652`、`/3839`
- 兑换码：GameKee `zmd/691172` 与 BWIKI `兑换码`

明河（Argent Flow）的 Prydwen 页写技能尚未发布，卡是 `stub: true`。

重建：`python3 mcp-server/scripts/import-endfield-catalog.py`
Prydwen 正文目录：`ENDFIELD_PRYDWEN_DIR`（默认 `/tmp/endfield/pry`）。
