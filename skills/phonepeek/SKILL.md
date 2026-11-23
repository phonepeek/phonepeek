---
name: phonepeek
description: Open the user's local dev server on their phone with a QR code (phonepeek). Use when the user wants to see, test or check their localhost / local site / dev server on a phone, mobile, iPhone, Android or tablet, test on a real device, or when a page works on localhost but is blank on the phone (checkout, Stripe, camera).
---

# phonepeek

[phonepeek](https://github.com/phonepeek/phonepeek) shows a local dev server on a phone on the same Wi-Fi. It prints a QR code with a private link: only the browser that opens it gets in, so nothing else on the network can reach the app.

## 1. Make sure it's installed

```sh
command -v phonepeek && phonepeek --version
```

If it's missing, **ask the user before installing**, then use the verified installer (it installs from a tagged release only if the SHA-256 checksum matches):

```sh
curl -fsSL https://github.com/phonepeek/phonepeek/releases/latest/download/install.sh | sh
```

It needs Node.js 20+. Don't install it any other way.

## 2. Find the port

- If the dev server is already running, use its port (from its output, or `lsof -nP -iTCP -sTCP:LISTEN` on macOS/Linux).
- If it isn't running, start it first (the project's usual `dev` script) and wait until it's ready.
- With no port, phonepeek checks 3000, 3001, 4200, 4321, 5173, 5500, 8000, 8080 and 8081 and uses the first one it finds. Pass the port when there is more than one server.

## 3. Pick http or https

Add `--https` when the page uses something that needs a secure page: Stripe or other payment forms, checkout, `crypto.randomUUID`, camera, microphone, geolocation, service workers, or when the user says a page is **blank on the phone** but fine on the computer.

With `--https`, the phone must trust phonepeek's certificate once. If the user hasn't done that, tell them: AirDrop or copy `~/.phonepeek/ca.crt` to the phone and install it. On iPhone, also enable it in **Settings → General → About → Certificate Trust Settings**. Details: the "HTTPS mode" section of the README.

## 4. Run it so the user can see the QR code

The QR code is printed in the terminal, and your tool output may not be visible to the user. Prefer having the user run it in their own terminal:

```sh
phonepeek 3000            # or: phonepeek 3000 --https
```

In Claude Code they can type `! phonepeek 3000` in the prompt.

If you run it yourself, run it in the background, then give the user the `No camera? Open: ...` link from its output. That link contains a secret: share it only with this user, never in a commit, issue, log or anywhere public.

**Always stop a phonepeek you started** (kill the background process) when the user is done, before ending your turn, or when they ask to stop. A forgotten one keeps the app reachable.

## 5. Troubleshooting

| What the user sees | What to do |
|---|---|
| "This phonepeek link is private" | The link changes every run: scan the new QR code. |
| Page doesn't load at all | Same Wi-Fi on both devices? Allow incoming connections for `node` if macOS/Windows asks. Public or office Wi-Fi often blocks devices from talking to each other: use the phone's hotspot. |
| Blank page | Run again with `--https`. |
| "Not private" warning with `--https` | Install the phonepeek certificate on the phone (step 3). Don't tell the user to tap through the warning: then the connection can be intercepted. |
| "Nothing is answering on localhost:PORT" | The dev server isn't running on that port. Start it or pass the right port. |
| Yellow warning: Wi-Fi has no password | Suggest a password-protected network or the phone's hotspot. Over plain `http` on that network, others can read the traffic. |

## Don'ts

- Don't suggest `--host 0.0.0.0` or changing the dev server config instead. phonepeek works without it and keeps the app private.
- Don't commit, paste or publish the private link.
- Don't leave phonepeek running after the user is done.
