# guides/

Canonical multi-game guide cards for game-intel.

```
guides/
  index.json          # coverage summary (written by export)
  {game}/
    aliases.json
    characters/{id}.json
    dopamine-auto.json   # optional (HW)
    modes/               # optional mode guides
    README.md            # empty games: fill when verified
```

## Rules
1. Every watchlist game (`hw`, `nikke`, `bd2`, `star`, `asora`, `miraesi`, `lo2`) gets a folder.
2. Dual publish: `ai-site/scripts/export-guides.mjs` → `/v1/guides/**` (AI JSON) + `/guides/**` (human HTML).
3. Sources: GameKee 图鉴/测评 + Bahamut only. Never invent skill names/numbers.
4. Incomplete cards must set `"stub": true`. Import scripts must not overwrite non-stub cards.
5. Legacy `data/hw-guides` is a symlink to `guides/hw` so `guide_hw` / `resolve_alias` keep working.
