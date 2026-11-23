# Changelog

## 0.1.1

- Fix: pages that redirect via headers other than `Location` (e.g. Inertia's `X-Inertia-Location`, used by Laravel checkout flows) sent the phone to `localhost` and never loaded. All response headers are now rewritten.
- Same-site `Referer` is forwarded as `localhost`, for apps that check it on form posts.

## 0.1.0

- First release: QR code for your localhost, hot reload passthrough, automatic dev-server detection, `localhost` link rewriting, curl installer.
