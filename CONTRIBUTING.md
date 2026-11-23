# Contributing

Thanks for helping! phonepeek has two rules: **one file** (`phonepeek.js`) and **zero dependencies**. That's what makes `curl | sh` installation work.

```sh
git clone https://github.com/nkechr1s/phonepeek
cd phonepeek
node --test test.js     # run tests
node phonepeek.js 8000  # try it on a local server
```

- Add a test for new behavior in `test.js`.
- Keep PRs small and focused; open an issue first for bigger ideas.
- Known limits and ideas are in the README's Roadmap. Pick one!
