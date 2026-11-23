# phonepeek

See your localhost on your phone in one command. No deploy, no account, no config. Any project: Next.js, Vite, Laravel, Django, Rails, PHP, a static folder, anything on a local port.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/nkechr1s/phonepeek/main/install.sh | sh
```

One file, no dependencies, just Node.js 20+. Or try it without installing:

```sh
curl -fsSL https://raw.githubusercontent.com/nkechr1s/phonepeek/main/phonepeek.js | node - 8000
```

## Use

```sh
phonepeek          # finds your running dev server
phonepeek 8000     # or name the port
```

It prints a QR code. Scan it with your phone camera and your site opens, with hot reload working.

```
  localhost:8000  ->  http://192.168.1.23:8000

  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
  ...
  Scan with your phone camera (same Wi-Fi). Ctrl+C to stop.
```

Your phone and computer must be on the **same Wi-Fi**.

## How it works

It starts a tiny proxy on your Wi-Fi address that forwards to `localhost:<port>`:

- Requests look like they came from `localhost`, so you don't need `--host 0.0.0.0`, and Next.js `allowedDevOrigins`, Vite `allowedHosts` and similar checks don't block your phone.
- Links your app writes as `http://localhost:<port>/...` (CSS, JS, images, redirects, e.g. Laravel's `APP_URL`) are rewritten to the phone's address, so nothing points at "localhost" on the phone.
- Hot reload (websockets) passes through.
- The phone URL uses the same port as your app when it can.

Without a port it looks for a server on 3000, 3001, 4200, 4321, 5173, 5500, 8000, 8080, 8081 and uses the first one it finds.

## Troubleshooting

- **Phone can't load the page**: macOS may ask "Allow incoming connections" for `node`. Click Allow. On Windows, allow Node in the firewall prompt.
- **Still nothing**: some public/office Wi-Fi blocks devices from talking to each other. Try your phone's hotspot with the computer connected to it.
- **"Nothing is answering on localhost:8000"**: start your dev server first, or pass the right port.

## Limits

- Same network only (not a public tunnel; for that use `cloudflared tunnel --url localhost:8000`).
- Plain `http`, so browser features that need HTTPS (camera, service workers, some auth providers) won't work from the phone.
- Pages are sent to the phone once fully loaded (no streaming of HTML), so links inside them can be rewritten.

## Windows

The installer needs a Unix shell. On Windows, download `phonepeek.js` and run `node phonepeek.js 8000`.

## Develop

```sh
node --test test.js
node phonepeek.js 8000
```

## License

MIT
