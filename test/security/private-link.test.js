// Only the browser that opened the QR link can reach the app. Everyone else on the Wi-Fi gets 403,
// so nothing (not even localhost-only debug tools) is reachable for them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, raw, request } = require('../helpers.js');
const { safeEqual } = require('../../phonepeek.js');

const TOKEN = 'secret-token-for-tests-123';

test('without the private link: 403, and the app never sees the request', async (t) => {
  const { proxy, seen } = await setup(t, { token: TOKEN });
  for (const path of ['/', '/admin', '/rails/info', '/_debugbar', '/__nextjs_launch-editor?file=x']) {
    const res = await request(proxy, path);
    assert.equal(res.status, 403, path);
    assert.match(res.body, /private/);
  }
  assert.equal(seen.length, 0);
});

test('wrong, empty or guessed tokens are refused', async (t) => {
  const { proxy, target, seen } = await setup(t, { token: TOKEN });
  for (const bad of ['', 'x', TOKEN.slice(0, -1), TOKEN + 'x', TOKEN.toUpperCase()]) {
    assert.equal((await request(proxy, `/?phonepeek=${encodeURIComponent(bad)}`)).status, 403);
    assert.equal((await request(proxy, '/', { headers: { cookie: `phonepeek_${target}=${bad}` } })).status, 403);
  }
  assert.equal(seen.length, 0);
});

test('the QR link trades the token for an HttpOnly cookie and removes it from the URL', async (t) => {
  const { proxy, target } = await setup(t, { token: TOKEN });
  const res = await request(proxy, `/shop?x=1&phonepeek=${TOKEN}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/shop?x=1');
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, new RegExp(`^phonepeek_${target}=${TOKEN}; Path=/; HttpOnly; SameSite=Lax$`));
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('the token redirect cannot be turned into an open redirect', async (t) => {
  const { proxy } = await setup(t, { token: TOKEN });
  for (const path of [`//evil.example/?phonepeek=${TOKEN}`, `/\\evil.example/?phonepeek=${TOKEN}`, `///evil.example?phonepeek=${TOKEN}`]) {
    const res = await raw(proxy, `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    const location = res.match(/location: (.*)\r\n/i)[1];
    assert.match(location, /^\/(?![/\\])/, `${path} -> ${location}`);
  }
});

test('with the cookie the app works, and never receives the phonepeek cookie', async (t) => {
  const { proxy, cookie, seen } = await setup(t, { token: TOKEN });
  assert.equal((await request(proxy, '/', { headers: { cookie } })).body, 'app');
  await request(proxy, '/', { headers: { cookie: `session=abc; ${cookie}; theme=dark` } });
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[1].headers.cookie, 'session=abc; theme=dark');
});

test('websockets need the cookie too, and the app never sees it', async (t) => {
  const { proxy, cookie, seen } = await setup(t, {
    token: TOKEN,
    upgrade(req, socket) { socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); },
  });
  const ws = (extra) => raw(proxy, `GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${extra}\r\n`);
  assert.match(await ws(''), /^HTTP\/1\.1 403/);
  assert.equal(seen.length, 0);
  assert.match(await ws(`Cookie: a=1; ${cookie}\r\n`), /^HTTP\/1\.1 101/);
  assert.equal(seen[0].headers.cookie, 'a=1');
});

test('token comparison is exact', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
  assert.equal(safeEqual('ünï', 'ünï'), true);
});
