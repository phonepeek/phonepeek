// Shared test helpers (not a test file).
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const { createProxy } = require('../phonepeek.js');

const listen = (server, host) => new Promise((r) => server.listen(0, host, () => r(server.address().port)));

// Fake dev app + phonepeek in front of it. `app(req, res, ports)` handles requests; `upgrade` handles websockets.
async function setup(t, { app, upgrade, token, tls: tlsOpts } = {}) {
  const seen = [];
  const ports = {};
  const target = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (app) return app(req, res, ports);
    res.end('app');
  });
  if (upgrade) target.on('upgrade', (req, socket, head) => { seen.push({ upgrade: req.url, headers: req.headers, head: head.toString() }); upgrade(req, socket, head); });
  ports.target = await listen(target, '127.0.0.1');
  const proxy = createProxy(ports.target, { token, tls: tlsOpts });
  ports.proxy = await listen(proxy, '127.0.0.1');
  t.after(() => { proxy.close(); target.close(); proxy.closeAllConnections(); target.closeAllConnections(); });
  return { ...ports, seen, proxyServer: proxy, cookie: token ? `phonepeek_${ports.target}=${token}` : '' };
}

// Raw bytes over TCP/TLS (so tests can send anything, even invalid HTTP). Resolves with what came back.
function raw(port, data, { ms = 300, secure } = {}) {
  return new Promise((resolve) => {
    const s = secure ? tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }) : net.connect(port, '127.0.0.1');
    let out = '';
    s.on(secure ? 'secureConnect' : 'connect', () => s.write(data));
    s.on('data', (d) => { out += d; });
    s.on('error', () => {});
    setTimeout(() => { s.destroy(); resolve(out); }, ms);
  });
}

// Simple request helper returning status, headers, body (no automatic redirects, no TLS checks unless `ca` given).
function request(port, path = '/', { headers = {}, method = 'GET', secure, ca } = {}) {
  const mod = secure ? require('node:https') : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({ host: '127.0.0.1', port, path, method, headers, agent: false, ca, rejectUnauthorized: !!ca }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { listen, setup, raw, request };
