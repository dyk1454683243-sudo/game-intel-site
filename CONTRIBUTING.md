# Contributing

Thanks for helping improve game-intel-site.

## Setup

1. Fork / clone this public repo.
2. `cd mcp-server && npm install`
3. Optional: `cd ai-site && npm install`
4. Set `GAME_INTEL_DATA` to the repo `data/` directory (or rely on defaults).

## Guidelines

- Prefer small, focused PRs.
- Do not invent gacha rates, prices, or private player data.
- Keep source URLs on intel items; mark incomplete cards with `"stub": true`.
- Do not commit `node_modules/`, `.wrangler/`, `.env*`, tokens, or Cloudflare secrets.
- Runtime scrape cache (`data/cache/`) is gitignored — do not add it.
- Personal ops prompts belong in `examples/*.example.txt` (sanitized), not as live secrets.

## Docs / i18n

Root README is bilingual (CN + EN). Technical comments may stay EN or CN; user-facing site copy can be CN-first.

## License

By contributing, you agree your changes are licensed under the MIT License.
