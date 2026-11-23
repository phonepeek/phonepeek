// The phone may look like localhost to the app, but nobody else can borrow that disguise or fake their identity.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, raw, request } = require('../helpers.js');

const TOKEN = 'secret-token-for-tests-123';
const echo = (req, res) => res.end(JSON.stringify({ origin: req.headers.origin, referer: req.headers.referer, xff: req.headers['x-forwarded-for'] }));

test("other websites keep their real Origin (the dev server's cross-site protections keep working)", async (t) => {
  const { proxy, target, cookie } = await setup(t, { token: TOKEN, app: echo });
  const foreign = JSON.parse((await request(proxy, '/', { headers: { cookie, origin: 'https://evil.example' } })).body);
  assert.equal(foreign.origin, 'https://evil.example');
  const own = JSON.parse((await request(proxy, '/', { headers: { cookie, origin: `http://127.0.0.1:${proxy}` } })).body);
  assert.equal(own.origin, `http://localhost:${target}`);
});

test('Referer is only translated for the phone’s own pages', async (t) => {
  const { proxy, target, cookie } = await setup(t, { token: TOKEN, app: echo });
  const own = JSON.parse((await request(proxy, '/', { headers: { cookie, referer: `http://127.0.0.1:${proxy}/cart?x=1` } })).body);
  assert.equal(own.referer, `http://localhost:${target}/cart?x=1`);
  const lookalike = JSON.parse((await request(proxy, '/', { headers: { cookie, referer: `http://127.0.0.1:${proxy}0/x` } })).body);
  assert.equal(lookalike.referer, `http://127.0.0.1:${proxy}0/x`);
  const foreign = JSON.parse((await request(proxy, '/', { headers: { cookie, referer: 'https://google.com/' } })).body);
  assert.equal(foreign.referer, 'https://google.com/');
});

test('X-Forwarded-For is always the real client IP; a fake "127.0.0.1" is replaced', async (t) => {
  const { proxy, cookie } = await setup(t, { token: TOKEN, app: echo });
  const res = JSON.parse((await request(proxy, '/', { headers: { cookie, 'x-forwarded-for': '127.0.0.9, 10.0.0.1' } })).body);
  assert.equal(res.xff, '127.0.0.1'); // the test client really is 127.0.0.1; the spoofed list is gone
});

test('a spoofed Host header never ends up in links or redirects', async (t) => {
  const { proxy, cookie } = await setup(t, {
    token: TOKEN,
    app(req, res, p) {
      res.writeHead(302, { location: `http://localhost:${p.target}/login`, 'content-type': 'text/html' });
      res.end(`<a href="http://localhost:${p.target}/x">x</a>`);
    },
  });
  const res = await raw(proxy, `GET / HTTP/1.1\r\nHost: evil.example\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.ok(!res.includes('evil.example'), res);
  assert.match(res, new RegExp(`location: http://127\\.0\\.0\\.1:${proxy}/login`));
});
