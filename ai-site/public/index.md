# game-intel · 泛游戏目录 / Game Catalog

**中文：** 泛游戏站 first cut — 游戏实体目录 + 情报 feed + 既有角色攻略。时区 Asia/Shanghai。
**EN:** Game entity catalog + cross-platform feed + existing character guides. Dual-publish (human HTML + AI JSON).

## Endpoints

| Path | Description |
|------|-------------|
| `/v1/games/index.json` | Game catalog index (84+) |
| `/v1/games/{id}.json` | Single game entity |
| `/v1/catalog-aliases.json` | Catalog nickname → id |
| `/v1/feed.json` | Recent intel items (real only) |
| `/` | Human UI home: digest + radar from live /v1 JSON |
| `/catalog/` | Human catalog search |
| `/watchlist/` | Human watchlist |
| `/game/?id=` | Identity card. Non-deep games show 尚无深耕 |
| `/character/?game=&id=` | Deep character card (hw, nikke, bd2 only) |
| `/games/index.html` | Static game directory |
| `/games/{id}.html` | Static game detail |
| `/v1/guides/index.json` | Character guide coverage |
| `/guides/*.html` | Human Chinese guide pages |
| `/v1/watchlist.json` | Dai daily watchlist |
| `/v1/digest.json` | Per-game digest |
| `/v1/calendar.json` / `calendar-hw.json` | Calendar |
| `/v1/radar.json` | New-game radar |
| `/schema/*.schema.json` | JSON Schema draft-07 |
| `/openapi.json` | OpenAPI 3.0 map of public GET `/v1` plus POST `/v1/claims` |
| `/llms.txt` | Agent discovery map |
| `/.well-known/mcp.json` | MCP discovery (AI Catalog alias) |
| `/mcp` | Read-only remote MCP (streamable HTTP) |
| `/v1/claims.json` | Public claims mirror |

## Rules

- Never invent Metacritic / prices / player counts.
- `stub: true` on a non-watchlist row = name / platforms / tags / sources / steam_appid only. Character cards are watchlist-only.
- Source priority: official > review sites > forums. If unverified, say 未见可靠出处.
- Watchlist games first on human pages.
- Human UI v0 reads `/v1` in the browser. Full character cards are hw / nikke / bd2 only. Other games stay identity-only and show 尚无深耕.
- Guides remain under `/guides/*` and `/v1/guides/*` (unchanged contract).
- Non-stub character cards require `sources` + `as_of`. HW/NIKKE/BD2 also require `summary` (conclusion). `summary.stub: true` means the conclusion is incomplete.
- POST `/v1/claims` is public (no API key). Every claim needs statement text, an https source, and `game_id`. GET `/v1/claims.json` lists those rows; they are untrusted until reviewed.
