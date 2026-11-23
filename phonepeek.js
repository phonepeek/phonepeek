#!/usr/bin/env node
// phonepeek: open your localhost on your phone. Single file, no dependencies.
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');

// Wi-Fi/LAN IPv4 addresses, home-network ranges first (Docker/VPN-looking ones last).
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map((a) => a.address)
    .sort((a, b) => rank(a) - rank(b));
}

// Constant-time string compare (no timing hints about the token).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Proxy that makes every request look like it came from localhost, so dev servers
// (Next.js allowedDevOrigins, Vite allowedHosts, Django ALLOWED_HOSTS) accept it, including HMR websockets.
// tls ({ key, cert }) serves the phone over https, needed for pages using secure-context APIs (Stripe, crypto.randomUUID, camera).
// token makes the link private: only a browser that opened the QR link gets through, everyone else gets 403.
function createProxy(targetPort, { tls, token } = {}) {
  const scheme = tls ? 'https' : 'http';
  const local = `localhost:${targetPort}`;
  const cookieName = `phonepeek_${targetPort}`;
  const ourCookie = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`);
  const allowed = (req) => !token || safeEqual((req.headers.cookie || '').match(ourCookie)?.[1], token);
  // Our cookie is for phonepeek only; never pass it on to the app.
  const withoutOurCookie = (c) => c.split(/;\s*/).filter((p) => !p.startsWith(`${cookieName}=`)).join('; ');
  // Per request: the phone's own address (from the socket, never the spoofable Host header),
  // the real client IP, and the header rewrite that makes the phone look local to the app.
  const forRequest = (req) => {
    const addr = req.socket.localAddress.replace(/^::ffff:/, '');
    const phoneHost = `${addr.includes(':') ? `[${addr}]` : addr}:${req.socket.localPort}`;
    const phoneOrigin = `${scheme}://${phoneHost}`;
    const client = req.socket.remoteAddress.replace(/^::ffff:/, '');
    const rewrite = (name, value) => {
      const n = name.toLowerCase();
      if (n === 'host') return local;
      // Only the phone's own pages pass as localhost; other sites keep their origin so the app's cross-site checks still work.
      if (n === 'origin') return value === phoneOrigin ? `http://${local}` : value;
      if (n === 'referer' && (value === phoneOrigin || value.startsWith(`${phoneOrigin}/`))) {
        return `http://${local}${value.slice(phoneOrigin.length)}`;
      }
      return value;
    };
    return { phoneHost, client, rewrite };
  };
  // http://localhost:PORT, also JSON-escaped (http:\/\/localhost:PORT) as Laravel & co. embed it.
  const localUrl = new RegExp(`https?:(\\\\*/)\\1(?:localhost|127\\.0\\.0\\.1):${targetPort}(?!\\d)`, 'g');
  const TEXT = /^(text\/(html|css)|application\/(json|javascript)|text\/javascript)/;

  const handler = (req, res) => {
    if (token) {
      const url = new URL(req.url, 'http://x');
      const given = url.searchParams.get('phonepeek');
      if (given !== null && safeEqual(given, token)) {
        // QR link: trade the token for a cookie, then drop it from the address bar.
        url.searchParams.delete('phonepeek');
        res.writeHead(302, {
          location: `/${url.pathname.replace(/^[/\\]+/, '')}${url.search}`, // never "//host": no open redirect
          'set-cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax${tls ? '; Secure' : ''}`,
          'cache-control': 'no-store',
        });
        return res.end();
      }
      if (!allowed(req)) {
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>phonepeek</title>'
          + '<p style="font:18px system-ui;padding:24px">This phonepeek link is private.<br>Scan the QR code shown in the terminal '
          + '(it changes every time phonepeek starts).</p>');
      }
    }
    const { phoneHost, client, rewrite } = forRequest(req);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = rewrite(k, v);
    if (headers.cookie !== undefined) headers.cookie = withoutOurCookie(headers.cookie) || undefined;
    if (headers.cookie === undefined) delete headers.cookie;
    delete headers['accept-encoding']; // uncompressed bodies so links can be rewritten; fine on a LAN
    // Real client IP, replacing any sent by the client, so apps can tell the phone from this machine.
    headers['x-forwarded-for'] = client;

    // On the phone, "localhost" is the phone itself: point absolute links/redirects back through us.
    const toPhone = (s) => s.replace(localUrl, (_, slash) => `${scheme}:${slash}${slash}${phoneHost}`);

    const upstream = http.request(
      { host: 'localhost', port: targetPort, method: req.method, path: req.url, headers },
      (up) => {
        // Every header, not just Location: X-Inertia-Location, Link preloads, Refresh, CSP...
        for (const [k, v] of Object.entries(up.headers)) {
          up.headers[k] = Array.isArray(v) ? v.map(toPhone) : typeof v === 'string' ? toPhone(v) : v;
        }
        // shortcut: text bodies are buffered to rewrite links, so streamed HTML arrives all at once.
        if (!TEXT.test(up.headers['content-type'] || '')) {
          res.writeHead(up.statusCode, up.headers);
          return up.pipe(res);
        }
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          if (!chunks.length) {
            res.writeHead(up.statusCode, up.headers);
            return res.end();
          }
          const body = Buffer.from(toPhone(Buffer.concat(chunks).toString('utf8')), 'utf8');
          delete up.headers['transfer-encoding'];
          up.headers['content-length'] = body.length;
          res.writeHead(up.statusCode, up.headers);
          res.end(body);
        });
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Nothing is answering on localhost:${targetPort}. Is your dev server running?`);
    });
    req.pipe(upstream);
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (!allowed(req)) return socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    const { client, rewrite } = forRequest(req);
    const up = net.connect(targetPort, 'localhost', () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        let value = rewrite(req.rawHeaders[i], req.rawHeaders[i + 1]);
        if (name === 'x-forwarded-for') continue;
        if (name === 'cookie' && !(value = withoutOurCookie(value))) continue;
        raw += `${req.rawHeaders[i]}: ${value}\r\n`;
      }
      up.write(`${raw}X-Forwarded-For: ${client}\r\n\r\n`);
      // Tunnel only once the app accepts the upgrade (101). Otherwise relay its answer and close,
      // so bytes sent after the request can't reach the app unfiltered (request smuggling).
      up.once('data', (first) => {
        socket.write(first);
        if (!/^HTTP\/1\.[01] 101/.test(first.toString('latin1'))) return socket.end();
        up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
    });
    // When either side goes away, drop the other (http sockets are half-open by default).
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  return server;
}

// Ports something is listening on, out of the usual dev-server ports.
// (5000/7000 skipped: macOS AirPlay listens there.)
const COMMON_PORTS = [3000, 3001, 4200, 4321, 5173, 5500, 8000, 8080, 8081];
function findDevServers(ports = COMMON_PORTS) {
  const probe = (port) =>
    new Promise((resolve) => {
      const s = net.connect(port, 'localhost');
      s.setTimeout(500);
      s.once('connect', () => { s.destroy(); resolve(port); });
      s.once('error', () => resolve(null));
      s.once('timeout', () => { s.destroy(); resolve(null); });
    });
  return Promise.all(ports.map(probe)).then((r) => r.filter(Boolean));
}

// Minimal QR encoder: byte mode, error correction L, versions 1-5 (up to 106 bytes; plenty for a LAN URL).
// shortcut: always mask 0 instead of scoring all 8 masks; every mask is valid, scoring only helps marginal scans.
function qrMatrix(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  const ECC = [0, 7, 10, 15, 20, 26]; // EC codewords per version (L, single block)
  let ver = 1;
  const rawCodewords = (v) => {
    let bits = (16 * v + 128) * v + 64;
    if (v >= 2) bits -= 25; // one alignment pattern for v2-5
    return bits >> 3;
  };
  while (ver <= 5 && rawCodewords(ver) - ECC[ver] < bytes.length + 2) ver++;
  if (ver > 5) throw new Error('URL too long for QR code');
  const dataLen = rawCodewords(ver) - ECC[ver];

  // Data codewords: mode 0100, 8-bit length, bytes, terminator, padding.
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);
  push(bytes.length, 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataLen * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

  // Reed-Solomon error correction over GF(256).
  const mul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z;
  };
  const deg = ECC[ver];
  const div = new Array(deg).fill(0);
  div[deg - 1] = 1;
  for (let i = 0, root = 1; i < deg; i++, root = mul(root, 2)) {
    for (let j = 0; j < deg; j++) div[j] = mul(div[j], root) ^ (j + 1 < deg ? div[j + 1] : 0);
  }
  const rem = new Array(deg).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift();
    rem.push(0);
    div.forEach((c, i) => { rem[i] ^= mul(c, f); });
  }
  const codewords = data.concat(rem);

  // Function patterns.
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  if (ver >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format bits: EC level L (01), mask 0 (000), BCH-encoded.
  let f = 1 << 3;
  for (let i = 0; i < 10; i++) f = (f << 1) ^ ((f >>> 9) * 0x537);
  f = ((1 << 3 << 10) | f) ^ 0x5412;
  const fb = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, fb(i));
  set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
  set(8, size - 8, true);

  // Codewords in the zigzag, with mask 0 ((x + y) even -> flip).
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (fn[y][x]) continue;
      const bit = k < codewords.length * 8 ? ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1 : false;
      k++;
      m[y][x] = bit !== ((x + y) % 2 === 0);
    }
  }
  return m;
}

// Two QR rows per text line, explicit black-on-white so it scans on dark and light terminals.
function qrText(text) {
  const m = qrMatrix(text), q = 2, n = m.length + 2 * q;
  const dark = (x, y) => x >= q && y >= q && x < n - q && y < n - q && m[y - q][x - q];
  let out = '';
  for (let y = 0; y < n; y += 2) {
    out += '  ';
    for (let x = 0; x < n; x++) out += `\x1b[${dark(x, y) ? 30 : 97};${dark(x, y + 1) ? 40 : 107}m▀`;
    out += '\x1b[0m\n';
  }
  return out;
}

// HTTPS without interception risk: a local certificate authority (CA) that you install on your phone once.
// The CA can only vouch for private-network IPs (name constraints), never for real websites,
// so even a stolen CA key can't impersonate google.com or your bank.
const PRIVATE_IPS = ['10.0.0.0/255.0.0.0', '172.16.0.0/255.240.0.0', '192.168.0.0/255.255.0.0', '127.0.0.0/255.0.0.0'];
function certificate(ip, dir = path.join(os.homedir(), '.phonepeek')) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700); // also for folders made by older versions
  const f = (name) => path.join(dir, name);
  const openssl = (args) => {
    try {
      execFileSync('openssl', args, { stdio: 'ignore' });
    } catch {
      console.error('--https needs openssl to create certificates (preinstalled on macOS and Linux).');
      process.exit(1);
    }
  };
  const cfg = f(`openssl-${process.pid}.cnf`);
  fs.writeFileSync(cfg, [
    '[req]', 'distinguished_name=dn', 'prompt=no', '[dn]', 'CN=phonepeek local CA (private IPs only)',
    '[ca]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign',
    'extendedKeyUsage=serverAuth', 'subjectKeyIdentifier=hash',
    // DNS:phonepeek.invalid leaves no real domain name allowed (without it, DNS names would be unrestricted).
    `nameConstraints=critical,${PRIVATE_IPS.map((r) => `permitted;IP:${r}`).join(',')},permitted;DNS:phonepeek.invalid`,
    '[leaf]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth', 'authorityKeyIdentifier=keyid', `subjectAltName=IP:${ip}`,
  ].join('\n'));
  try {
    const valid = (file, issuer) => {
      if (!fs.existsSync(file)) return false;
      const c = new crypto.X509Certificate(fs.readFileSync(file));
      return new Date(c.validTo) > new Date(Date.now() + 86400e3) && (!issuer || (c.checkIssued(issuer) && c.verify(issuer.publicKey)));
    };
    if (!valid(f('ca.crt')) || !fs.existsSync(f('ca.key'))) {
      openssl(['req', '-x509', '-config', cfg, '-extensions', 'ca', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-keyout', f('ca.key'), '-out', f('ca.crt')]);
      fs.rmSync(f(`ip-${ip}.crt`), { force: true }); // new CA: re-issue the site certificate
    }
    const ca = new crypto.X509Certificate(fs.readFileSync(f('ca.crt')));
    if (!valid(f(`ip-${ip}.crt`), ca) || !fs.existsSync(f(`ip-${ip}.key`))) {
      openssl(['req', '-new', '-config', cfg, '-subj', '/CN=phonepeek', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', f(`ip-${ip}.key`), '-out', f(`ip-${ip}.csr`)]);
      openssl(['x509', '-req', '-in', f(`ip-${ip}.csr`), '-CA', f('ca.crt'), '-CAkey', f('ca.key'),
        '-set_serial', `0x${crypto.randomBytes(16).toString('hex')}`, '-days', '397',
        '-extfile', cfg, '-extensions', 'leaf', '-out', f(`ip-${ip}.crt`)]);
      fs.rmSync(f(`ip-${ip}.csr`), { force: true });
    }
    for (const k of ['ca.key', `ip-${ip}.key`]) fs.chmodSync(f(k), 0o600);
    return {
      key: fs.readFileSync(f(`ip-${ip}.key`)),
      cert: Buffer.concat([fs.readFileSync(f(`ip-${ip}.crt`)), fs.readFileSync(f('ca.crt'))]),
      caFile: f('ca.crt'),
      caFingerprint: ca.fingerprint256,
    };
  } finally {
    fs.rmSync(cfg, { force: true });
  }
}

// Is the current Wi-Fi open (no password: anyone nearby can join)? true/false, or null when unknown.
const WIFI = {
  darwin: ['system_profiler', ['SPAirPortDataType', '-json'], (out) => {
    const modes = (JSON.parse(out).SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? [])
      .map((i) => i.spairport_current_network_information?.spairport_security_mode).filter(Boolean);
    return modes.length ? modes.some((m) => /_(none|owe)$/i.test(m)) : null;
  }],
  linux: ['nmcli', ['-t', '-f', 'ACTIVE,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'no'], (out) => {
    const active = out.split('\n').find((l) => l.startsWith('yes:'));
    return active === undefined ? null : /^yes:(--|owe)?\s*$/i.test(active);
  }],
  win32: ['netsh', ['wlan', 'show', 'interfaces'], (out) => {
    const auth = out.match(/^\s*Authentication\s*:\s*(.+?)\s*$/m)?.[1];
    return auth === undefined ? null : /^(open|owe)/i.test(auth);
  }],
};
function wifiIsOpen(platform = process.platform) {
  const w = WIFI[platform];
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => execFile(w[0], w[1], { timeout: 20000 }, (err, out) => {
    try { resolve(err ? null : w[2](out)); } catch { resolve(null); }
  }));
}

const VERSION = '0.2.1';

const USAGE = `Usage: phonepeek [port] [--https]

Open your localhost on your phone: scan the QR code (phone on the same Wi-Fi).
  port   port your dev server runs on (found automatically if left out)

The link is private: only a browser that opened it from the QR code gets in.

Options:
  --https         serve the phone over https (needed for Stripe/payments, camera,
                  crypto.randomUUID...). Install the phonepeek certificate on your
                  phone once; see the README.
  -h, --help      show this help
  -v, --version   show the version`;

async function main(args) {
  const useHttps = args.includes('--https');
  const arg = args.find((a) => a !== '--https');
  if (arg === '-h' || arg === '--help') return console.log(USAGE);
  if (arg === '-v' || arg === '--version') return console.log(VERSION);
  let target = Number(arg);
  if (arg === undefined) {
    const found = await findDevServers();
    if (!found.length) {
      console.error(`No dev server found on ${COMMON_PORTS.join(', ')}.\nStart it first, or pass its port: phonepeek 8000`);
      process.exit(1);
    }
    target = found[0];
    if (found.length > 1) console.log(`  Found servers on ${found.join(', ')}. Using ${target} (run \`phonepeek <port>\` for another).`);
  } else if (!Number.isInteger(target) || target < 1 || target > 65535) {
    console.error(USAGE);
    process.exit(1);
  }

  const ip = lanAddresses()[0];
  if (!ip) {
    console.error('No network found. Connect this computer to Wi-Fi (the same one as your phone).');
    process.exit(1);
  }

  // Bind to the Wi-Fi IP only, on the same port as the app: never loops back into itself
  // via localhost, and the phone URL matches your app's port. Taken? Any free port.
  const tls = useHttps ? certificate(ip) : undefined;
  const token = crypto.randomBytes(16).toString('base64url'); // new every run: old links stop working
  const server = createProxy(target, { tls, token });
  server.once('error', (e) => {
    if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
    server.on('error', (e2) => { console.error(e2.message); process.exit(1); });
    server.listen(0, ip);
  });
  server.on('listening', () => {
    const url = `${useHttps ? 'https' : 'http'}://${ip}:${server.address().port}`;
    const link = `${url}/?phonepeek=${token}`;
    console.log(`\n  localhost:${target}  ->  ${url}\n`);
    console.log(qrText(link));
    console.log('  Scan with your phone camera (same Wi-Fi). Private link, changes every run. Ctrl+C to stop.');
    console.log(`  No camera? Open: ${link}`);
    if (useHttps) {
      console.log(`\n  Warning on the phone? Install the phonepeek certificate once (README: "HTTPS mode"):`);
      console.log(`    ${tls.caFile}`);
      console.log(`    SHA-256 ${tls.caFingerprint}`);
    } else console.log('  Blank page (payments, Stripe, camera)? Run again with --https.');
    console.log('');
    wifiIsOpen().then((open) => {
      if (open) {
        console.log('\x1b[33m  ⚠  This Wi-Fi has no password: anyone nearby can join it and watch unencrypted traffic.');
        console.log(`     Prefer a password-protected network or your phone's hotspot${useHttps ? '' : ', or use --https'}.\x1b[0m\n`);
      }
    });
  });
  server.listen(target, ip);
}

module.exports = { createProxy, lanAddresses, findDevServers, qrMatrix, certificate, safeEqual, WIFI, wifiIsOpen };
// Run unless required by tests (also runs when piped: curl ... | node -).
if (require.main === module || __filename === '[stdin]') main(process.argv.slice(2));
