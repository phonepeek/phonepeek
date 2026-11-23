# Rules for AI agents working on phonepeek

phonepeek shows a localhost dev server on a phone. Its whole value is being small, readable and provably safe. Keep it that way.

- **One file, zero dependencies.** All code lives in `phonepeek.js`, using only Node's standard library. Don't add a `package.json`, a dependency, a build step or a second source file.
- **Run `node --test` before you say you're done.** All tests must pass. Tests live in `test/unit/`, `test/security/` and `test/e2e/`. Shared helpers are in `test/helpers.js`.
- **Every behavior change gets a test.**
- **Security claims need proof.** Each claim in `README.md` ("Is it safe?") and `SECURITY.md` points to a test. If you add a claim, add its test. Never weaken, skip or delete a test in `test/security/` to make something pass: fix the code instead.
- **Don't weaken the protections**: the private link (token, cookie, 403), Origin/Referer/X-Forwarded-For handling, the websocket `101` check, binding to the Wi-Fi IP only, the CA's name constraints, and `0600`/`0700` key permissions. Changes there need an explanation and new tests.
- **It never talks to the internet.** Network connections go only to `localhost:<port>`. Don't add telemetry, update checks or remote calls.
- **Don't commit, push, tag or release** unless the maintainer asks. Releases happen only when the maintainer pushes a `v*` tag (see `CONTRIBUTING.md`). When asked to release: bump `VERSION` in `phonepeek.js` and add a `CHANGELOG.md` entry.
- **Keep GitHub Actions pinned** to full commit SHAs, with the version in a comment.
- **Don't leave processes running.** If you start phonepeek or a test server, stop it before you finish.
- **Docs follow behavior.** If you change what a user sees or does, update `README.md`, `SECURITY.md` and `skills/phonepeek/SKILL.md` to match.
