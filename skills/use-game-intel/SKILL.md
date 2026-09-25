---
name: use-game-intel
description: Use when pulling watchlist mobile-game intel (pools, tests, new titles) via game-intel MCP instead of dumping browser HTML.
---

# Use game-intel

1. Prefer multi-source MCP tools: `digest`, `radar`, `search_taptap`, `search_inven`, `search_steam` — **GameKee alone is insufficient**.
2. Still use `search_gamekee` / `get_article` for CN wiki detail; combine with TapTap/Inven/Steam for coverage beyond the watchlist.
3. Always keep source URLs in the short JSON; never invent rates or prices; never return raw HTML.
4. For welfare/CDK use `game-welfare`, not this plugin.
5. Watchlist defaults: hw, nikke, bd2, star (蓝色星原：旅谣 / Azur Promilia), miraesi, lo2, asora — miraesi/lo2 digest prefers Inven keywords; star/lo2 official use seed fallbacks.
6. `radar` aggregates 公测/预约/CBT/新作-style headlines across TapTap + Inven + GameKee (max 15).
