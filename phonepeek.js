#!/usr/bin/env node
// phonepeek: open your localhost on your phone. Single file, no dependencies.
'use strict';
const http = require('node:http');
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

// Proxy that makes every request look like it came from localhost, so dev servers
// (Next.js allowedDevOrigins, Vite allowedHosts, Django ALLOWED_HOSTS) accept it, including HMR websockets.
function createProxy(targetPort) {
  const local = `localhost:${targetPort}`;
  const rewrite = (name, value) => {
    const n = name.toLowerCase();
    if (n === 'host') return local;
    if (n === 'origin') return `http://${local}`;
    return value;
  };
  // http://localhost:PORT, also JSON-escaped (http:\/\/localhost:PORT) as Laravel & co. embed it.
  const localUrl = new RegExp(`https?:(\\\\*/)\\1(?:localhost|127\\.0\\.0\\.1):${targetPort}(?!\\d)`, 'g');
  const TEXT = /^(text\/(html|css)|application\/(json|javascript)|text\/javascript)/;

  const server = http.createServer((req, res) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = rewrite(k, v);
    delete headers['accept-encoding']; // uncompressed bodies so links can be rewritten; fine on a LAN

    // On the phone, "localhost" is the phone itself: point absolute links/redirects back through us.
    const phoneHost = req.headers.host;
    const toPhone = (s) => s.replace(localUrl, (_, slash) => `http:${slash}${slash}${phoneHost}`);

    const upstream = http.request(
      { host: 'localhost', port: targetPort, method: req.method, path: req.url, headers },
      (up) => {
        if (up.headers.location) up.headers.location = toPhone(up.headers.location);
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
  });

  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(targetPort, 'localhost', () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        raw += `${req.rawHeaders[i]}: ${rewrite(req.rawHeaders[i], req.rawHeaders[i + 1])}\r\n`;
      }
      up.write(raw + '\r\n');
      up.write(head);
      up.pipe(socket);
      socket.pipe(up);
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

const USAGE = `Usage: phonepeek [port]

Open your localhost on your phone: scan the QR code (phone on the same Wi-Fi).
  port   port your dev server runs on (found automatically if left out)`;

async function main(arg) {
  if (arg === '-h' || arg === '--help') return console.log(USAGE);
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
  const server = createProxy(target);
  server.once('error', (e) => {
    if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
    server.on('error', (e2) => { console.error(e2.message); process.exit(1); });
    server.listen(0, ip);
  });
  server.on('listening', () => {
    const url = `http://${ip}:${server.address().port}`;
    console.log(`\n  localhost:${target}  ->  ${url}\n`);
    console.log(qrText(url));
    console.log('  Scan with your phone camera (same Wi-Fi). Ctrl+C to stop.\n');
  });
  server.listen(target, ip);
}

module.exports = { createProxy, lanAddresses, findDevServers, qrMatrix };
// Run unless required by tests (also runs when piped: curl ... | node -).
if (require.main === module || __filename === '[stdin]') main(process.argv[2]);
