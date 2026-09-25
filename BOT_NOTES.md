# For other bots optimizing the site

- Source of truth for deploy: `ai-site/` → `scripts/publish.sh` (export-guides → export-intel → export-games → wrangler deploy).
- Live: https://game-intel-ai.dyk1454683243.workers.dev
- Dual publish: human HTML under `/games`, `/guides` + AI JSON under `/v1/`.
- Do not invent rates/scores; stubs use `"stub": true`.
- Watchlist daily ops stay narrow; catalog can be broad.
- Canonical public OSS: https://github.com/dyk1454683243-sudo/game-intel-site — keep local checkouts in sync after merges.
- To change this repo, the maintainer clicks Cursor authorization once (root README). Then open a branch and PR here.
- Secrets never in git (see `SECURITY.md`). Monetization is hosted site + future API keys + later ads on human pages.
- Remote MCP (read-only, no token): `GET /.well-known/mcp.json` is the AI Catalog alias of `/.well-known/ai-catalog.json`. Server card is `/mcp/server-card`. Connect with Streamable HTTP at `/mcp`. Tools fetch published `/v1/*` JSON, `/llms.txt`, and `/openapi.json` — do not scrape HTML.
- Claims wall: `POST /v1/claims` needs `Authorization: Bearer` and wrangler secret `CLAIMS_API_KEY`. Storage is KV binding `CLAIMS` (id in `wrangler.toml`, not a secret). Public read is `GET /v1/claims.json` and `/claims/index.html`. Reject posts with no https sources.
