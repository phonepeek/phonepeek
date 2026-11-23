# Security

phonepeek puts your dev server on your Wi-Fi. This page explains what protects it, what each protection is tested by, and what's left to you.

## Protections (each one has an automated test)

| Protection | Test |
|---|---|
| **Private link.** A random secret (128-bit) in the QR code, new every run. The browser that opens it gets an `HttpOnly`, `SameSite=Lax` cookie (`Secure` with `--https`) and the secret is removed from the address bar. Everything else, including websockets, gets `403` before reaching your app. The cookie is never passed to your app. | `test/security/private-link.test.js`, `test/e2e/cli.test.js` |
| **No borrowed identity.** Only your phone's own pages pass as `localhost`. Other websites keep their real `Origin`, so the dev server's cross-site protections (Vite, Next.js) still work. `Referer` is only translated for your phone's pages. | `test/security/headers.test.js` |
| **Real client IP.** `X-Forwarded-For` is always the connecting device's IP; any value it sends is replaced, so nobody can claim to be `127.0.0.1`. | `test/security/headers.test.js` |
| **No Host spoofing.** Links and redirects use the address the phone actually connected to, never the `Host` header. | `test/security/headers.test.js` |
| **No request smuggling.** A websocket becomes a raw tunnel only after your app accepts it (`101`). | `test/security/smuggling.test.js` |
| **No SSRF.** Requests only ever go to `localhost:<your port>`; absolute URLs and `CONNECT` can't reach other ports or hosts. | `test/security/robustness.test.js` |
| **Robust.** Dropped connections, garbage, wrong protocol, odd bytes and 2000 idle connections don't crash or block it. | `test/security/robustness.test.js` |
| **Trusted HTTPS that can't be abused.** `--https` uses a local certificate authority you install on your phone. Its name constraints allow only private IPs (`10/8`, `172.16/12`, `192.168/16`, `127/8`): a certificate for a real domain or public IP is rejected even when signed with the real CA key. Keys are `0600` in a `0700` folder. | `test/security/tls.test.js` |
| **Verified installs.** `install.sh` installs only from a tagged GitHub release, over HTTPS only, and only if the SHA-256 checksum matches. Releases are built by GitHub Actions after all tests pass, with a signed build provenance attestation. All actions are pinned to commit SHAs. | `test/e2e/install.test.js`, `.github/workflows/release.yml` |
| **Listens only on your Wi-Fi address**, never on all interfaces, and stops when you press Ctrl+C. | `test/e2e/cli.test.js` |
| **Warns on Wi-Fi without a password.** | `test/unit/wifi.test.js` |

Run them all with `node --test`.

## What's left to you

- **Who you give the link to.** Anyone with the QR code or link can open your app until you stop phonepeek. Don't share it, and press Ctrl+C when done.
- **Plain `http` without `--https`.** Traffic between phone and computer is unencrypted. On a network with untrusted people, someone could read it, including the private-link cookie. Use `--https` with the certificate installed, or your phone's hotspot.
- **Tapping through the certificate warning.** If you use `--https` without installing the certificate, the connection can be intercepted. Install it.
- **Your computer's security.** The CA key in `~/.phonepeek/` is protected by your user account. It can't be used against real websites, but it could be used to impersonate phonepeek on a private network. Delete `~/.phonepeek/` and the phone profile if you stop using phonepeek.

## Reporting a vulnerability

Please use GitHub's private [security advisory form](https://github.com/phonepeek/phonepeek/security/advisories/new) instead of a public issue.
