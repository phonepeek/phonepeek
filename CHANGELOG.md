# Changelog

## 0.2.1

- phonepeek moved to the **[phonepeek](https://github.com/phonepeek) organization**: [github.com/phonepeek/phonepeek](https://github.com/phonepeek/phonepeek). Old links redirect.
- Releases are now built and signed by `phonepeek/phonepeek`. Verify with `gh attestation verify ~/.local/bin/phonepeek --repo phonepeek/phonepeek` (v0.2.0's build record names the old address).
- `skills/phonepeek/SKILL.md`: a skill so AI coding agents (Claude Code and others) can run phonepeek for you.
- `AGENTS.md` / `CLAUDE.md`: project rules for AI agents working on the repo.

## 0.2.0

- **Private link:** every run gets a secret link in the QR code. Other devices on the Wi-Fi get `403` and can't reach your app at all.
- **`--https`** for pages that need a secure context (Stripe checkout, `crypto.randomUUID`, camera), using a local certificate authority you install on your phone once. It is limited to private IPs, so it can't be abused for real websites.
- **Warning on Wi-Fi without a password.**
- **Verified installs:** `install.sh` installs only from tagged releases and checks the SHA-256 checksum. Releases are built by GitHub Actions with a signed provenance attestation; actions are pinned to commit SHAs.
- Security (from a pen test):
  - Requests from other websites keep their real `Origin`, so dev-server cross-site protections keep working.
  - `X-Forwarded-For` carries the real client IP; client-sent values are replaced.
  - A refused websocket upgrade no longer becomes a raw tunnel to the app (request smuggling).
  - Links and redirects use the connection's address instead of the spoofable `Host` header.
- Tests reorganized into `test/unit`, `test/security` and `test/e2e`; every security claim maps to a test.
- New project banner.

## 0.1.1

- Fix: pages that redirect via headers other than `Location` (e.g. Inertia's `X-Inertia-Location`, used by Laravel checkout flows) sent the phone to `localhost` and never loaded. All response headers are now rewritten.
- Same-site `Referer` is forwarded as `localhost`, for apps that check it on form posts.

## 0.1.0

- First release: QR code for your localhost, hot reload passthrough, automatic dev-server detection, `localhost` link rewriting, curl installer.
