# Security

## Reporting

If you find a vulnerability or accidentally committed secret in this repository, please open a private security advisory on GitHub or contact the maintainer via GitHub issues (without pasting the secret).

## Secrets policy

- **Never commit** Cloudflare API tokens, wrangler credentials, API keys, OAuth refresh tokens, `.env` files, private keys, or personal Drive / account IDs.
- Use `.env` / `wrangler secret` / CI secrets for deploy and API auth.
- Public site content and schemas are fine to commit; runtime caches and personal ops configs are not.

## Monetization-related auth (future)

Planned hosted API keys and ad configs must stay out of git. Document env var names only.

## Claims API

`POST /v1/claims` is public. It does not use `Authorization` or `CLAIMS_API_KEY`. Abuse control is https source checks, body caps, and KV rate limits (10 posts per IP per hour, 100 per Asia/Shanghai day). The KV namespace id in `ai-site/wrangler.toml` (`binding = "CLAIMS"`) is not a secret. If `CLAIMS_API_KEY` is already set on the Worker, leave it; this route does not read it. Do not commit `.dev.vars` or a real key.

## Dependency / supply chain

Report malicious dependency behavior the same way as other security issues.
