# For other bots optimizing the site

- Source of truth for deploy: `ai-site/` → `scripts/publish.sh` (export-guides → `npm ci` in `mcp-server` → export-intel → export-games → wrangler deploy). Requires Node >=22; the script exits if `node` is older. `node_modules/` is gitignored; without that install, digest/calendar/radar fail on missing `@modelcontextprotocol/sdk`.
- Live: https://game-intel-ai.dyk1454683243.workers.dev
- Dual publish: human HTML under `/games`, `/guides` + AI JSON under `/v1/`.
- Do not invent rates/scores; stubs use `"stub": true`.
- Watchlist daily ops stay narrow; catalog can be broad.
- Canonical public OSS: https://github.com/dyk1454683243-sudo/game-intel-site — keep local checkouts in sync after merges.
- To change this repo, the maintainer clicks Cursor authorization once (root README). Then open a branch and PR here.
- Secrets never in git (see `SECURITY.md`). Monetization is hosted site + future API keys + later ads on human pages.
- Remote MCP (read-only, no token): `GET /.well-known/mcp.json` is the AI Catalog alias of `/.well-known/ai-catalog.json`. Server card is `/mcp/server-card`. Connect with Streamable HTTP at `/mcp`. Tools fetch published `/v1/*` JSON, `/llms.txt`, and `/openapi.json` — do not scrape HTML.
- Claims wall: `POST /v1/claims` is public (no API key, no Bearer). Required: statement, https source URL, `game_id`. Reject empty, `javascript:`, `data:`, non-https, and placeholder hosts. Caps: body 16384 bytes, statement 2000, 10 posts per IP per hour, 100 per Asia/Shanghai day (KV binding `CLAIMS`). There is no review queue; `GET /v1/claims.json`, `/claims/index.html`, and MCP `list_claims` show those rows as untrusted submissions. `CLAIMS_API_KEY`, if already set, is unused by submit — leave it.
