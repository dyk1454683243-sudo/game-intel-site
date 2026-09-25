# game-intel AI site

Minimal AI-friendly read-only static site (schema + live MCP JSON exports). No deploy in this round.

## Serve locally

From this directory (`ai-site/`):

```bash
python3 -m http.server 8787
```

Then:

```bash
curl -sS http://127.0.0.1:8787/llms.txt
curl -sS http://127.0.0.1:8787/v1/watchlist.json | python3 -m json.tool
curl -sS http://127.0.0.1:8787/v1/digest.json | python3 -m json.tool
curl -sS http://127.0.0.1:8787/v1/calendar.json | python3 -m json.tool
curl -sS http://127.0.0.1:8787/schema/watchlist.schema.json | python3 -m json.tool
```

## Live export status

Live MCP export done (`meta.fixture: false` on `v1/*.json`).
Digest last exported at `2026-09-06T22:05:07+08:00` (Asia/Shanghai) via `digest({ summarize: true, diff: true, only_new: false })`.
Monday morning can re-export digest/calendar/watchlist the same way and overwrite `v1/*.json`.

Do not invent hosting URLs here; local serve only until a real deploy is chosen.
