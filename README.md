# game-intel-site

**CN** | **EN** below

开源游戏情报 / 图鉴站点：MCP 服务端 + Cloudflare Workers 静态站（人类 HTML + AI JSON）。

- **Live（托管站）**: https://game-intel-ai.dyk1454683243.workers.dev
- **Canonical OSS**: https://github.com/dyk1454683243-sudo/game-intel-site
- **License**: MIT

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
| `data/games` `data/guides` | 游戏与图鉴内容（不含 runtime `data/cache`） |
| `examples/` | 运维提示词等示例（已脱敏） |
| `skills/` | Cursor skill 说明 |

## 快速开始

```bash
git clone https://github.com/dyk1454683243-sudo/game-intel-site.git
cd game-intel-site
cd mcp-server && npm install && cd ..
# 可选：安装 jev 到 PATH，或设置 JEV_BIN / JEV_PATH_PREFIX
export GAME_INTEL_DATA="$PWD/data"
node mcp-server/cli.js digest --summarize
```

MCP（Cursor 等）示例见根目录 `.mcp.json`（相对路径）。

## 发布站点

```bash
cd ai-site
npm install
# 需已登录 wrangler（OAuth）；勿把 token 写入仓库
bash scripts/publish.sh
```

Live: https://game-intel-ai.dyk1454683243.workers.dev

## 原则

- 不编造掉率 / 价格；stub 卡片带 `"stub": true`
- 多源情报（GameKee / TapTap / Inven / Steam / Prydwen 等），保留来源 URL
- 福利 CDK 走独立 `game-welfare`，不在本仓代氪

---

# English

Open-source game intel + guide site: MCP server and a Cloudflare Workers static site (human HTML + AI JSON under `/v1/`).

**Monetization:** full public OSS; operator monetizes via the **hosted Cloudflare site**, future **API keys**, and later **ads on human pages**. Never commit secrets.

See `CONTRIBUTING.md`, `SECURITY.md`, `BOT_NOTES.md`.
