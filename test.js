const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createProxy, findDevServers, qrMatrix } = require('./phonepeek.js');

const listen = (server) => new Promise((r) => server.listen(0, () => r(server.address().port)));

test('forwards requests as localhost, rewrites localhost links, proxies websockets', async (t) => {
  const target = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(307, { location: `http://localhost:${targetPort}/login?x=1` });
      return res.end();
    }
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<link href="http://localhost:${targetPort}/app.css"><script>{"u":"http:\\/\\/127.0.0.1:${targetPort}\\/x"}</script><a href="http://localhost:${targetPort}1">other port</a> ünïcode`);
    }
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, url: req.url }));
  });
  target.on('upgrade', (req, socket) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Host: ${req.headers.host}\r\n\r\n`);
    socket.on('data', (d) => socket.write(d)); // echo
    socket.on('end', () => socket.end());
  });
  const targetPort = await listen(target);
  const proxy = createProxy(targetPort);
  const proxyPort = await listen(proxy);
  t.after(() => { proxy.close(); target.close(); proxy.closeAllConnections(); target.closeAllConnections(); });

  const res = await fetch(`http://127.0.0.1:${proxyPort}/page?a=1`, { headers: { origin: 'http://192.168.1.5:8888' } });
  assert.deepEqual(await res.json(), { host: `localhost:${targetPort}`, origin: `http://localhost:${targetPort}`, url: '/page?a=1' });

  const r = await fetch(`http://127.0.0.1:${proxyPort}/redirect`, { redirect: 'manual' });
  assert.equal(r.headers.get('location'), `http://127.0.0.1:${proxyPort}/login?x=1`);

  const html = await fetch(`http://127.0.0.1:${proxyPort}/html`);
  const body = await html.text();
  assert.equal(body, `<link href="http://127.0.0.1:${proxyPort}/app.css"><script>{"u":"http:\\/\\/127.0.0.1:${proxyPort}\\/x"}</script><a href="http://localhost:${targetPort}1">other port</a> ünïcode`);
  assert.equal(Number(html.headers.get('content-length')), Buffer.byteLength(body));

  const echoed = await new Promise((resolve, reject) => {
    http.request({ port: proxyPort, headers: { connection: 'Upgrade', upgrade: 'websocket' } })
      .on('upgrade', (res, socket) => {
        assert.equal(res.headers['x-host'], `localhost:${targetPort}`);
        socket.once('data', (d) => { resolve(d.toString()); socket.destroy(); });
        socket.write('ping');
      })
      .on('error', reject)
      .end();
  });
  assert.equal(echoed, 'ping');
});

test('502 with a hint when the dev server is not running', async (t) => {
  const dead = http.createServer();
  const deadPort = await listen(dead);
  await new Promise((r) => dead.close(r));
  const proxy = createProxy(deadPort);
  const proxyPort = await listen(proxy);
  t.after(() => { proxy.close(); proxy.closeAllConnections(); });

  const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Is your dev server running/);
});

test('finds a running dev server, ignores closed ports', async (t) => {
  const server = http.createServer();
  const port = await listen(server);
  t.after(() => server.close());
  const closed = http.createServer();
  const closedPort = await listen(closed);
  await new Promise((r) => closed.close(r));
  assert.deepEqual(await findDevServers([closedPort, port]), [port]);
});

test('QR code matches a known-good encoding', () => {
  // Expected hash was checked module-for-module against the `qrcode` npm package and decoded with jsQR.
  const bits = qrMatrix('http://192.168.2.13:8000').map((r) => r.map((d) => (d ? 1 : 0)).join('')).join('\n');
  assert.equal(crypto.createHash('sha256').update(bits).digest('hex'), 'ff0a6da522c3519aa694e4e8749d149847e0beb96de7acbbedf1974766afe78a');
  assert.throws(() => qrMatrix('x'.repeat(200)), /too long/);
});
