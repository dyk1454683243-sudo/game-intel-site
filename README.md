# game-intel-site

**CN** | **EN** below

开源游戏情报 / 图鉴站点：MCP 服务端 + Cloudflare Workers 静态站（人类 HTML + AI JSON）。

- **Live（托管站）**: https://game-intel-ai.dyk1454683243.workers.dev
- **Canonical OSS**: https://github.com/dyk1454683243-sudo/game-intel-site
- **License**: MIT

协作入口在下面：**本地怎么跑**、**怎么贡献卡**。别的 bot 要改仓时，维护者在 Cursor **点一次授权**。细则与本文一致：`CONTRIBUTING.md`、`SECURITY.md`、`BOT_NOTES.md`。

## 变现说明 / Monetization

本仓库为 **完整公开 OSS**。运营方通过 **托管 Cloudflare 站点** 变现，后续计划：

1. **Hosted site** — 公开可访问的情报 / 图鉴页（当前 Workers）
2. **API keys**（未来）— 对机器可读 `/v1/` 接口限流与鉴权
3. **Ads on human pages**（更晚）— 仅在面向人类的 HTML 页投放广告

**Secrets never in git.** Cloudflare / API 凭证只用本地 `.env`、`wrangler secret`、CI secrets。

---

## 仓库结构

| Path | 说明 |
|------|------|
| `mcp-server/` | MCP + CLI（digest / radar / calendar / guides / ask） |
| `ai-site/` | schemas、export scripts、`publish.sh`、Workers 静态资源 |
| `data/games` `data/guides` | 游戏实体卡与角色图鉴卡（不含 runtime `data/cache`） |
| `examples/` | 运维提示词等示例（已脱敏） |
| `skills/` | Cursor skill 说明 |

## 本地怎么跑

Node.js 18+（`mcp-server/package.json` 的 `engines`）。

```bash
git clone https://github.com/dyk1454683243-sudo/game-intel-site.git
cd game-intel-site
cd mcp-server && npm install && cd ..
```

CLI 默认 `GAME_INTEL_DATA` 为仓库里的 `data/`（`mcp-server` 的上一级）。数据目录不在默认位置时再导出：

```bash
export GAME_INTEL_DATA="$PWD/data"
```

可把 `.env.example` 复制为本地 `.env` 作备忘。CLI 与 MCP 读的是环境变量，不会自动加载 `.env`。`.env` 不进 git。

本地冒烟（读已有卡，不抓网）：

```bash
node mcp-server/cli.js list_guides --game hw
node mcp-server/cli.js guide --game hw --q 修女 --topic skills
node mcp-server/cli.js guide --game nikke --id zwei
```

`digest` / `radar` 会访问外部情报源：

```bash
node mcp-server/cli.js digest --summarize
```

`ask` 与 `filter_morning` 需要本机有 `jev`：放到 `PATH`，或设置 `JEV_BIN` / `JEV_PATH_PREFIX`。

Cursor MCP：根目录 `.mcp.json` 使用 `node ./mcp-server/index.js`，并把 `GAME_INTEL_DATA` 设为 `./data`。在 Cursor 里启用这份配置即可。

静态站预览（不部署）。已提交的 `ai-site/public/` 可直接看：

```bash
cd ai-site && npm install
npm run preview
# http://127.0.0.1:8787/   例如 /llms.txt 、/v1/guides/index.json 、/guides/hw/lysandria.html
```

改过 `data/guides` 之后，在 `ai-site/` 执行 `npm run export-guides` 再预览。非 stub 卡缺少 `sources` 或 `as_of`，或 hw / nikke / bd2 缺少结论行时，导出会拒绝。

## 怎么贡献卡

小 PR。技能名、数值、掉率、价格、抽取建议都要有来源，未核实的内容保持 stub。与 `CONTRIBUTING.md`、`data/guides/README.md` 一致。

### 角色图鉴卡

路径：`data/guides/{game}/characters/{id}.json`  
Schema：`ai-site/schema/character-card.schema.json`（必填 `id`、`name`、`game`）。

Watchlist 目录：`hw`、`nikke`、`bd2`、`star`、`asora`、`miraesi`、`lo2`。`star` / `asora` / `miraesi` / `lo2` 仍是占位目录，有核实来源再填。各游戏说明在 `data/guides/{game}/README.md`。

来源按目录里已有约定：

- 图鉴总规则：GameKee 图鉴/测评 + Bahamut（`data/guides/README.md`）
- NIKKE：GameKee 角色图鉴 + Prydwen（`data/guides/nikke/README.md`）
- BD2：GameKee（`data/guides/bd2/README.md`）

约定：

- 技能尚未核实：`"stub": true`。最小形状是 `id`、`name`、`game`、`stub`。
- `stub` 不是 `true` 时，必须有 `sources`（https URL）和 `as_of`（上海时区日期或月份，如 `2026-09`）。
- hw / nikke / bd2 的非 stub 卡还要有 `summary`。`summary.stub: true` 表示结论不完整，和技能卡上的 `stub` 是两件事。`summary.sources` 必填。没有核实到的强度或抽取文案，就不要写 `tier` / `pull`。
- 已填好的例子：`data/guides/nikke/characters/zwei.json`。

别名写在 `data/guides/{game}/aliases.json`，每条含 `id`、`name`、`kind`（`character` | `stigmata_set` | `mode` | `other`）。NIKKE 的条目在 `aliases.p1.json`–`aliases.p4.json`，由 `aliases.json` 的 `_parts` 合并。

已有导入 / 充实脚本不会覆盖非 stub 卡：

```bash
node mcp-server/scripts/import-hw-catalog.js [--offline]
node mcp-server/scripts/enrich-hw-cards.js [--limit N] [--dry-run]
node mcp-server/scripts/import-nikke-catalog.js [--offline]
node mcp-server/scripts/enrich-nikke-cards.js [--limit 40] [--dry-run]
node mcp-server/scripts/import-bd2-catalog.js [--offline]
node mcp-server/scripts/enrich-bd2-cards.js [--limit N] [--dry-run]
```

hw / nikke / bd2 的结论行可以手写，也可以跑 `node mcp-server/scripts/fill-conclusions.mjs`（只根据卡上已有字段写 `summary`，不编造 tier / pull）。

改完先读一张卡，再导出：

```bash
node mcp-server/cli.js guide --game nikke --id zwei
cd ai-site && npm run export-guides
```

### 游戏实体卡

路径：`data/games/{id}.json`  
Schema：`ai-site/schema/game.schema.json`（必填 `id`、`name`、`platforms`、`stub`、`as_of`、`timezone`；`timezone` 固定 `Asia/Shanghai`）。

`stub: true` 表示只有身份和链接。`sources` 是 `{ "label", "url" }` 数组。照 `data/games/balatro.json` 的形状写。导出：`cd ai-site && npm run export-games`。

情报条目同样保留来源 URL。福利 CDK 走独立 `game-welfare`，不在本仓代氪。

不要提交 `node_modules/`、`.wrangler/`、`.env*`、`data/cache/`、token。

## 别的 bot 改仓

别的 bot（例如 Cursor Cloud Agent）要改这个仓库时，维护者在 Cursor 里 **点一次授权**。授权这一次之后，bot 才能在 `game-intel-site` 上开分支、提 PR。Token 留在 Cursor / GitHub，不进 git，也不贴进聊天（`SECURITY.md`）。Bot 部署约定见 `BOT_NOTES.md`。

## 发布站点

```bash
cd ai-site
npm install
# 需已登录 wrangler（OAuth）；勿把 token 写入仓库
bash scripts/publish.sh
```

Live: https://game-intel-ai.dyk1454683243.workers.dev

## 原则

- 不编造掉率 / 价格 / 技能名和数值；未完成的卡 `"stub": true`
- 非 stub 图鉴卡带 `sources` 与 `as_of`；hw / nikke / bd2 另带 `summary`（结论不完整则 `summary.stub: true`）
- 多源情报（GameKee / TapTap / Inven / Steam / Prydwen 等），保留来源 URL
- 福利 CDK 走独立 `game-welfare`，不在本仓代氪

---

# English

Open-source game intel + guide site: MCP server and a Cloudflare Workers static site (human HTML + AI JSON under `/v1/`).

**Monetization:** full public OSS; operator monetizes via the **hosted Cloudflare site**, future **API keys**, and later **ads on human pages**. Never commit secrets.

**Collaboration entry:** how to run locally, how to contribute cards, and the one-time Cursor authorization when another bot needs to change this repo. Same rules in `CONTRIBUTING.md`, `SECURITY.md`, `BOT_NOTES.md`.

## Run locally

Node.js 18+.

```bash
git clone https://github.com/dyk1454683243-sudo/game-intel-site.git
cd game-intel-site
cd mcp-server && npm install && cd ..
```

The CLI defaults `GAME_INTEL_DATA` to this repo's `data/` directory. Export it only when data lives elsewhere:

```bash
export GAME_INTEL_DATA="$PWD/data"
```

Copy `.env.example` to a local `.env` as a reminder if you want. The CLI and MCP read environment variables; they do not load `.env`. Do not commit `.env`.

Smoke test against cards already in the repo:

```bash
node mcp-server/cli.js list_guides --game hw
node mcp-server/cli.js guide --game hw --q 修女 --topic skills
node mcp-server/cli.js guide --game nikke --id zwei
```

`digest` / `radar` call external intel sources: `node mcp-server/cli.js digest --summarize`.

`ask` and `filter_morning` need `jev` on `PATH`, or `JEV_BIN` / `JEV_PATH_PREFIX`.

Cursor MCP: root `.mcp.json` runs `node ./mcp-server/index.js` with `GAME_INTEL_DATA=./data`. Enable that config in Cursor.

Static preview (no deploy). Committed `ai-site/public/` is enough to look:

```bash
cd ai-site && npm install
npm run preview
# http://127.0.0.1:8787/   e.g. /llms.txt , /v1/guides/index.json , /guides/hw/lysandria.html
```

After editing `data/guides`, run `npm run export-guides` inside `ai-site/`, then preview. Export refuses a non-stub card that lacks `sources` or `as_of`, and an hw / nikke / bd2 card that lacks a conclusion row.

## Contribute cards

Small PRs. Skill names, numbers, rates, prices, and pull advice need a source. Unverified text stays a stub. Same rules as `CONTRIBUTING.md` and `data/guides/README.md`.

### Character guide cards

Path: `data/guides/{game}/characters/{id}.json`  
Schema: `ai-site/schema/character-card.schema.json` (required: `id`, `name`, `game`).

Watchlist folders: `hw`, `nikke`, `bd2`, `star`, `asora`, `miraesi`, `lo2`. `star` / `asora` / `miraesi` / `lo2` are placeholders until a source is verified. Per-game notes: `data/guides/{game}/README.md`.

Sources already documented in-tree:

- Guides overall: GameKee 图鉴/测评 + Bahamut (`data/guides/README.md`)
- NIKKE: GameKee character wiki + Prydwen (`data/guides/nikke/README.md`)
- BD2: GameKee (`data/guides/bd2/README.md`)

Rules:

- Skills not verified yet: `"stub": true`. Minimum fields: `id`, `name`, `game`, `stub`.
- When `stub` is not `true`, the card needs `sources` (https URLs) and `as_of` (Asia/Shanghai date or month, e.g. `2026-09`).
- Non-stub hw / nikke / bd2 cards also need `summary`. `summary.stub: true` means the conclusion is incomplete; that flag is separate from the card's skill `stub`. `summary.sources` is required. Leave `tier` / `pull` out unless a source already states them.
- Filled example: `data/guides/nikke/characters/zwei.json`.

Aliases live in `data/guides/{game}/aliases.json`. Each entry has `id`, `name`, and `kind` (`character` | `stigmata_set` | `mode` | `other`). NIKKE entries are in `aliases.p1.json`–`aliases.p4.json`, merged through `_parts` on `aliases.json`.

Existing import / enrich scripts do not overwrite non-stub cards:

```bash
node mcp-server/scripts/import-hw-catalog.js [--offline]
node mcp-server/scripts/enrich-hw-cards.js [--limit N] [--dry-run]
node mcp-server/scripts/import-nikke-catalog.js [--offline]
node mcp-server/scripts/enrich-nikke-cards.js [--limit 40] [--dry-run]
node mcp-server/scripts/import-bd2-catalog.js [--offline]
node mcp-server/scripts/enrich-bd2-cards.js [--limit N] [--dry-run]
```

Write the hw / nikke / bd2 conclusion by hand, or run `node mcp-server/scripts/fill-conclusions.mjs` (it fills `summary` from fields already on the card and does not invent tier / pull).

Check one card, then export:

```bash
node mcp-server/cli.js guide --game nikke --id zwei
cd ai-site && npm run export-guides
```

### Game entity cards

Path: `data/games/{id}.json`  
Schema: `ai-site/schema/game.schema.json` (required: `id`, `name`, `platforms`, `stub`, `as_of`, `timezone`; `timezone` is `Asia/Shanghai`).

`stub: true` means identity and links only. `sources` is an array of `{ "label", "url" }`. Follow `data/games/balatro.json`. Export with `cd ai-site && npm run export-games`.

Intel items keep source URLs. Welfare / CDK stays in `game-welfare`, not this repo.

Do not commit `node_modules/`, `.wrangler/`, `.env*`, `data/cache/`, or tokens.

## Other bots changing the repo

When another bot (for example a Cursor Cloud Agent) needs to change this repo, the maintainer clicks **Cursor authorization once**. After that click, the bot can open a branch and pull request on `game-intel-site`. Tokens stay in Cursor / GitHub. They do not go into git or into chat (`SECURITY.md`). Deploy notes for bots: `BOT_NOTES.md`.
