# Contributing

Thanks for helping! phonepeek has two rules: **one file** (`phonepeek.js`) and **zero dependencies**. That's what keeps it easy to read and verify.

```sh
git clone https://github.com/phonepeek/phonepeek
cd phonepeek
node --test             # all tests
node phonepeek.js 8000  # try it on a local server
```

## Tests

| Folder | What it covers |
|---|---|
| `test/unit/` | QR code, proxy features, Wi-Fi detection |
| `test/security/` | The pen test, automated: private link, headers, smuggling, robustness, TLS |
| `test/e2e/` | The real CLI on your network address, and the installer |

Every behavior change needs a test.

Using an AI agent? It should follow [`AGENTS.md`](AGENTS.md) (Claude Code reads it through `CLAUDE.md`). If you change what users see, update [`skills/phonepeek/SKILL.md`](skills/phonepeek/SKILL.md) too. Every security claim in the README or SECURITY.md must point to a test that proves it.

## Releasing (maintainers)

1. Bump `VERSION` in `phonepeek.js` and add a `CHANGELOG.md` entry.
2. Merge to `main` and wait for CI to pass.
3. `git tag v0.2.0 && git push origin v0.2.0`. The release workflow runs the tests, checks the tag matches `VERSION`, and publishes `phonepeek.js`, `install.sh` and `SHA256SUMS` with a provenance attestation.

Keep PRs small; open an issue first for bigger ideas. Ideas are in the README's Roadmap.
