# Contributing

Thanks for helping improve game-intel-site.

## Setup

1. Fork / clone this public repo.
2. `cd mcp-server && npm install` (Node.js 18+).
3. Optional: `cd ai-site && npm install` for preview and export.
4. `GAME_INTEL_DATA` defaults to the repo `data/` directory. Export it when data lives elsewhere.

Local commands, static preview, and the card walkthrough are in the root README（本地怎么跑 / 怎么贡献卡，EN: Run locally / Contribute cards）.

## Cards

- Character cards: `data/guides/{game}/characters/{id}.json`. Schema: `ai-site/schema/character-card.schema.json`.
- Aliases: `data/guides/{game}/aliases.json` (`id`, `name`, `kind`). NIKKE entries live in `aliases.p1.json`–`aliases.p4.json`.
- Game entities: `data/games/{id}.json`. Schema: `ai-site/schema/game.schema.json`. Follow an existing stub such as `data/games/balatro.json`.
- Incomplete cards set `"stub": true`. Non-stub cards need `sources` and `as_of`. HW / NIKKE / BD2 non-stub cards also need `summary` (`summary.stub: true` when the conclusion is thin). `export-guides` rejects cards that miss these.
- Guide sources follow `data/guides/README.md` and that game's README. Do not invent skill names, numbers, rates, prices, or pull advice. Import / enrich scripts must not overwrite non-stub cards.

## Guidelines

- Prefer small, focused PRs.
- Do not invent gacha rates, prices, or private player data.
- Keep source URLs on intel items; mark incomplete cards with `"stub": true`.
- Do not commit `node_modules/`, `.wrangler/`, `.env*`, tokens, or Cloudflare secrets.
- Runtime scrape cache (`data/cache/`) is gitignored — do not add it.
- Personal ops prompts belong in `examples/*.example.txt` (sanitized), not as live secrets.

## Bots

When another bot needs to change this repo, the maintainer clicks Cursor authorization once. Tokens stay out of git (`SECURITY.md`). Deploy notes for bots: `BOT_NOTES.md`. The same note is in the root README.

## Docs / i18n

Root README is bilingual (CN + EN). Technical comments may stay EN or CN; user-facing site copy can be CN-first.

## License

By contributing, you agree your changes are licensed under the MIT License.
