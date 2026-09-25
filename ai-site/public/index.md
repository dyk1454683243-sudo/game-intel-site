# game-intel · 泛游戏目录 / Game Catalog

**中文：** 泛游戏站 first cut — 游戏实体目录 + 情报 feed + 既有角色攻略。时区 Asia/Shanghai。
**EN:** Game entity catalog + cross-platform feed + existing character guides. Dual-publish (human HTML + AI JSON).

## Endpoints

| Path | Description |
|------|-------------|
| `/v1/games/index.json` | Game catalog index (30+) |
| `/v1/games/{id}.json` | Single game entity |
| `/v1/feed.json` | Recent intel items (real only) |
| `/games/index.html` | Human game directory |
| `/games/{id}.html` | Game detail |
| `/v1/guides/index.json` | Character guide coverage |
| `/guides/*.html` | Human Chinese guide pages |
| `/v1/watchlist.json` | Dai daily watchlist |
| `/v1/digest.json` | Per-game digest |
| `/v1/calendar.json` / `calendar-hw.json` | Calendar |
| `/v1/radar.json` | New-game radar |
| `/schema/*.schema.json` | JSON Schema draft-07 |
| `/llms.txt` | Agent discovery map |

## Rules

- Never invent Metacritic / prices / player counts.
- `stub: true` = identity + real links only.
- Watchlist games first on human pages.
- Guides remain under `/guides/*` and `/v1/guides/*` (unchanged contract).
