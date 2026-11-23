// A websocket upgrade the app refuses must not turn into a raw tunnel for hidden requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, raw } = require('../helpers.js');

test('refused upgrade + pipelined request: the hidden request never reaches the app', async (t) => {
  const smuggled = [];
  const { proxy, cookie, seen } = await setup(t, {
    token: 'tok',
    upgrade(req, socket) {
      socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'); // refuse but keep the connection open
      socket.on('data', (d) => smuggled.push(d.toString()));
      socket.on('error', () => {});
    },
  });
  const res = await raw(proxy, `GET /ws HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`
    + 'GET /SMUGGLED HTTP/1.1\r\nHost: evil\r\n\r\n', { ms: 500 });
  assert.match(res, /^HTTP\/1\.1 404/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].head, '');
  assert.deepEqual(smuggled, []);
});
