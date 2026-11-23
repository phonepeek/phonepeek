// Hostile or broken traffic can't crash phonepeek or reach anything but the chosen app port.
// (An uncaught exception in phonepeek would fail this test file.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setup, raw, request } = require('../helpers.js');

const TOKEN = 'tok';
const app = (req, res) => {
  if (req.url === '/abort') { res.writeHead(200, { 'content-type': 'text/html', 'content-length': 1000 }); res.write('partial'); return setTimeout(() => req.socket.destroy(), 50); }
  if (req.url === '/abort-bin') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': 1000 }); res.write('partial'); return setTimeout(() => req.socket.destroy(), 50); }
  req.resume();
  req.on('error', () => {});
  req.on('end', () => res.end(`app:${req.url}`));
};

test('connections dropped mid-request or mid-response', async (t) => {
  const { proxy, cookie } = await setup(t, { token: TOKEN, app });
  await raw(proxy, `POST /upload HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nContent-Length: 100000\r\n\r\nonly-a-little`, { ms: 100 });
  await raw(proxy, `GET /abort HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\n\r\n`);
  await raw(proxy, `GET /abort-bin HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\n\r\n`);
  assert.equal((await request(proxy, '/ok', { headers: { cookie } })).body, 'app:/ok');
});

test('garbage, wrong protocol, odd bytes and missing Host', async (t) => {
  const { proxy, cookie } = await setup(t, { token: TOKEN, app });
  await raw(proxy, Buffer.from([0x16, 0x03, 0x01, 0xff, 0xff, 0, 1, 2, 3, 0xde, 0xad])); // TLS hello on http
  await raw(proxy, '\r\n\r\nGARBAGE / HTTP/9.9\r\n\r\n');
  await raw(proxy, `GET / HTTP/1.1\r\nHost: ÿþ"><script>x</script>\r\nCookie: ${cookie}\r\n\r\n`);
  await raw(proxy, `GET / HTTP/1.0\r\nCookie: ${cookie}\r\n\r\n`);
  await raw(proxy, `GET / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\nCookie: ${cookie}\r\n\r\n0\r\n\r\n`);
  assert.equal((await request(proxy, '/ok', { headers: { cookie } })).body, 'app:/ok');
});

test('no SSRF: absolute URLs and CONNECT cannot reach other ports or hosts', async (t) => {
  const other = net.createServer((s) => s.end('OTHER-SERVICE'));
  const otherPort = await new Promise((r) => other.listen(0, '127.0.0.1', () => r(other.address().port)));
  t.after(() => other.close());
  const { proxy, cookie, seen } = await setup(t, { token: TOKEN, app });
  const abs = await raw(proxy, `GET http://127.0.0.1:${otherPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${otherPort}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.ok(!abs.includes('OTHER-SERVICE'));
  assert.ok(seen.every((r) => r.url.startsWith('/') || r.url.startsWith('http://127.0.0.1')), 'only ever forwarded to the app');
  const connect = await raw(proxy, `CONNECT 127.0.0.1:${otherPort} HTTP/1.1\r\nHost: 127.0.0.1:${otherPort}\r\nCookie: ${cookie}\r\n\r\n`);
  assert.ok(!connect.includes('OTHER-SERVICE') && !/^HTTP\/1\.1 200/.test(connect), connect);
});

test('2000 idle connections do not block a normal request', async (t) => {
  const { proxy, cookie } = await setup(t, { token: TOKEN, app });
  const socks = Array.from({ length: 2000 }, () => net.connect(proxy, '127.0.0.1').on('error', () => {}));
  t.after(() => socks.forEach((s) => s.destroy()));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await request(proxy, '/ok', { headers: { cookie } })).body, 'app:/ok');
});
