<h1 align="center">phonepeek</h1>

<p align="center">
  <b>See your localhost on your phone in one command.</b><br>
  Scan a QR code. No deploy, no account, no config, no dependencies.
</p>

<p align="center">
  <a href="https://github.com/nkechr1s/phonepeek/actions/workflows/ci.yml"><img src="https://github.com/nkechr1s/phonepeek/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="zero dependencies">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-green.svg" alt="Node 20+">
</p>

```console
$ phonepeek 8000

  localhost:8000  ->  http://192.168.1.23:8000

  █▀▀▀▀▀█ ▀▄ ▄█ █▀▀▀▀▀█
  █ ███ █ ▄▀█▄▀ █ ███ █      <- scan with your phone camera
  █▄▄▄▄▄█ █ ▀ █ █▄▄▄▄▄█

  Scan with your phone camera (same Wi-Fi). Ctrl+C to stop.
```

## Why

Testing a site on a real phone usually means deploying it or fiddling with `--host 0.0.0.0`, firewall settings and "invalid host" errors. phonepeek does it in one command, and works with **any** project that serves on a local port: Next.js, Vite, Astro, Remix, Laravel, Django, Rails, PHP, or a plain static folder.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/nkechr1s/phonepeek/main/install.sh | sh
```

Needs Node.js 20+. It's a single file, installed to `~/.local/bin/phonepeek` (override with `PHONEPEEK_DIR`).

Or run it once without installing:

```sh
curl -fsSL https://raw.githubusercontent.com/nkechr1s/phonepeek/main/phonepeek.js | node - 8000
```

**Windows:** download `phonepeek.js` and run `node phonepeek.js 8000`.

**Update:** run the install command again. **Uninstall:** `rm ~/.local/bin/phonepeek`.

## Usage

```sh
phonepeek          # auto-detects your running dev server
phonepeek 8000     # or name the port
phonepeek --help
```

Start your dev server as usual, run phonepeek, scan the code. Your phone and computer must be on the **same Wi-Fi**.

## How it works

phonepeek starts a small proxy on your Wi-Fi address that forwards to `localhost:<port>`:

- **Works without server flags.** Requests are forwarded as if they came from `localhost`, so you don't need `--host 0.0.0.0`, and Next.js `allowedDevOrigins` / Vite `allowedHosts` checks don't block your phone.
- **Absolute links are fixed.** URLs like `http://localhost:8000/app.css` (Laravel `APP_URL`, redirects, JSON) are rewritten to your computer's address. On a phone, `localhost` would mean the phone itself.
- **Hot reload works.** WebSockets pass through.
- **Same port.** The phone URL uses your app's port when it's free.
- **Auto-detect.** With no port, it probes 3000, 3001, 4200, 4321, 5173, 5500, 8000, 8080 and 8081.

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't load the page | Allow incoming connections for `node` when macOS / Windows asks. |
| Still nothing | Public or office Wi-Fi often blocks device-to-device traffic. Use your phone's hotspot. |
| "Nothing is answering on localhost:8000" | Start your dev server first, or pass the right port. |
| Wrong network IP shown | Another adapter (VPN, Docker) was picked. Disconnect it and retry. |

## Limitations

- Same network only. For a public link use a tunnel such as `cloudflared tunnel --url localhost:8000`.
- Plain `http`, so features needing HTTPS (camera, service workers, some OAuth providers) won't work on the phone.
- Text responses are buffered so links can be rewritten; streamed HTML shows up all at once.
- While running, anyone on your Wi-Fi can open the URL. See [SECURITY.md](SECURITY.md).

## Roadmap

Ideas open for contribution (see [CONTRIBUTING.md](CONTRIBUTING.md)):

- [ ] Choose between multiple detected servers interactively
- [ ] Pick the network interface (`--ip`)
- [ ] Optional HTTPS with a local certificate
- [ ] Smarter handling of streamed responses
- [ ] Homebrew formula

## Contributing

Two rules: one file, zero dependencies. Run tests with `node --test test.js`. Issues and PRs welcome; if phonepeek saved you a deploy, a ⭐ helps others find it.

## License

[MIT](LICENSE)
