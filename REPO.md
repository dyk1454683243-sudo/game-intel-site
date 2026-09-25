# Repository mapping

## Canonical PUBLIC OSS (use this)

- **URL**: https://github.com/dyk1454683243-sudo/game-intel-site
- **Branch**: `main`
- **Live hosted site**: https://game-intel-ai.dyk1454683243.workers.dev
- **License**: MIT
- **Monetization**: full public OSS; operator monetizes via hosted Cloudflare site, future API keys, and later ads on human HTML pages. **Secrets never in git.**

## Private early dump (disposable)

- **URL**: https://github.com/dyk1454683243-sudo/game-intel
- Treat as an early / accidental dump only. Do **not** push secrets or treat it as the public target. Prefer `game-intel-site` for all OSS sync.

## Local plugin path

- `/home/box/.cursor/plugins/local/game-intel/` — Dai box working copy (may contain local cache / `.env` — gitignored).
- Scrubbed export staging: `/workspace/game-intel-oss/`
- Push batch files: `/workspace/game-intel-oss-batches/push/` (217 batches prepared for `user-GitHub-xai` `push_files`)

## Sync policy

1. Edit locally → scrub (no `node_modules`, `.wrangler`, `.env*`, UIDs, Drive folder ids, absolute box paths).
2. Push to **game-intel-site** `main` only.
3. Deploy site with `ai-site/scripts/publish.sh` (wrangler OAuth / secrets stay local).
