# Security

## Reporting

If you find a vulnerability or accidentally committed secret in this repository, please open a private security advisory on GitHub or contact the maintainer via GitHub issues (without pasting the secret).

## Secrets policy

- **Never commit** Cloudflare API tokens, wrangler credentials, API keys, OAuth refresh tokens, `.env` files, private keys, or personal Drive / account IDs.
- Use `.env` / `wrangler secret` / CI secrets for deploy and API auth.
- Public site content and schemas are fine to commit; runtime caches and personal ops configs are not.

## Monetization-related auth (future)

Planned hosted API keys and ad configs must stay out of git. Document env var names only.

## Dependency / supply chain

Report malicious dependency behavior the same way as other security issues.
