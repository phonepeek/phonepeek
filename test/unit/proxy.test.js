const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { setup, request, listen } = require('../helpers.js');
const { createProxy, findDevServers } = require('../../phonepeek.js');

test('forwards requests as localhost so dev servers accept them', async (t) => {
  const { proxy, target, seen } = await setup(t);
  const res = await request(proxy, '/page?a=1', { headers: { origin: `http://127.0.0.1:${proxy}` } });
  assert.equal(res.body, 'app');
  assert.equal(seen[0].url, '/page?a=1');
  assert.equal(seen[0].headers.host, `localhost:${target}`);
  assert.equal(seen[0].headers.origin, `http://localhost:${target}`);
});

test('rewrites localhost links in bodies and headers (redirects, Inertia, Link)', async (t) => {
  const { proxy, target } = await setup(t, {
    app(req, res, p) {
      if (req.url === '/redirect') { res.writeHead(307, { location: `http://localhost:${p.target}/login?x=1` }); return res.end(); }
      if (req.url === '/inertia') {
        res.writeHead(409, { 'x-inertia-location': `http://localhost:${p.target}/checkout`, link: `<http://localhost:${p.target}/a.js>; rel=preload` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<link href="http://localhost:${p.target}/app.css"><script>{"u":"http:\\/\\/127.0.0.1:${p.target}\\/x"}</script><a href="http://localhost:${p.target}1">other port</a> ünïcode`);
    },
  });
  const base = `http://127.0.0.1:${proxy}`;
  assert.equal((await request(proxy, '/redirect')).headers.location, `${base}/login?x=1`);
  const inertia = await request(proxy, '/inertia');
  assert.equal(inertia.headers['x-inertia-location'], `${base}/checkout`);
  assert.equal(inertia.headers.link, `<${base}/a.js>; rel=preload`);
  const html = await request(proxy, '/');
  assert.ok(html.body.includes(`href="${base}/app.css"`));
  assert.ok(html.body.includes(`http:\\/\\/127.0.0.1:${proxy}\\/x`));
  assert.ok(html.body.includes(`href="http://localhost:${target}1"`), 'a different port must not be rewritten');
  assert.ok(html.body.includes('ünïcode'));
  assert.ok(!/localhost:\d+\/app\.css/.test(html.body));
  assert.equal(Number(html.headers['content-length']), Buffer.byteLength(html.body));
});

test('proxies accepted websockets (hot reload)', async (t) => {
  const { proxy, target } = await setup(t, {
    upgrade(req, socket) {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Host: ${req.headers.host}\r\n\r\n`);
      socket.on('data', (d) => socket.write(d));
      socket.on('end', () => socket.end());
    },
  });
  const echoed = await new Promise((resolve, reject) => {
    http.request({ port: proxy, host: '127.0.0.1', headers: { connection: 'Upgrade', upgrade: 'websocket' } })
      .on('upgrade', (res, socket) => {
        assert.equal(res.headers['x-host'], `localhost:${target}`);
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
  const deadPort = await listen(dead, '127.0.0.1');
  await new Promise((r) => dead.close(r));
  const proxy = createProxy(deadPort);
  const port = await listen(proxy, '127.0.0.1');
  t.after(() => { proxy.close(); proxy.closeAllConnections(); });
  const res = await request(port);
  assert.equal(res.status, 502);
  assert.match(res.body, /Is your dev server running/);
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
