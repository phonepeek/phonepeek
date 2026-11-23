// The real command, end to end, on this machine's real network address.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { lanAddresses } = require('../../phonepeek.js');

const CLI = path.join(__dirname, '..', '..', 'phonepeek.js');
const lan = lanAddresses()[0];
const opts = { skip: !lan && 'no network interface' };

function get(url, { headers, ca } = {}) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { headers, ca, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// Fake dev app on 127.0.0.1 + the real CLI in front of it. Resolves once the private link is printed.
async function start(t, args = []) {
  const app = http.createServer((req, res) => res.end(JSON.stringify({ url: req.url, xff: req.headers['x-forwarded-for'] })));
  const port = await new Promise((r) => app.listen(0, '127.0.0.1', () => r(app.address().port)));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phonepeek-home-'));
  const child = spawn(process.execPath, [CLI, String(port), ...args], { env: { ...process.env, HOME: home, USERPROFILE: home } });
  t.after(() => { child.kill(); app.close(); fs.rmSync(home, { recursive: true, force: true }); });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const link = await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const m = out.match(/No camera\? Open: (\S+)/);
      if (m) { clearInterval(timer); resolve(m[1]); }
    }, 50);
    child.on('exit', () => { clearInterval(timer); reject(new Error(`phonepeek exited:\n${out}`)); });
  });
  return { child, link, base: link.replace(/\/\?phonepeek=.*/, ''), home, output: () => out };
}

test('private link: others get 403, the QR link gets in, the app sees the real client IP', opts, async (t) => {
  const { link, base } = await start(t);
  assert.ok(base.startsWith(`http://${lan}:`), base);
  assert.equal((await get(`${base}/`)).status, 403);
  const login = await get(link);
  assert.equal(login.status, 302);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const page = await get(`${base}/hello`, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.deepEqual(JSON.parse(page.body), { url: '/hello', xff: lan });
});

test('every run gets a new private link; the old one stops working', opts, async (t) => {
  const first = await start(t);
  const cookie = (await get(first.link)).headers['set-cookie'][0].split(';')[0];
  first.child.kill();
  await new Promise((r) => first.child.once('exit', r));
  const second = await start(t);
  assert.notEqual(first.link.split('=')[1], second.link.split('=')[1]);
  assert.equal((await get(`${second.base}/`, { headers: { cookie: cookie.replace(/=.*/, `=${first.link.split('=')[1]}`) } })).status, 403);
});

test('--https: verified by the phonepeek CA, fingerprint printed matches the CA file', { skip: opts.skip || (spawnSync('openssl', ['version']).error && 'openssl not installed') }, async (t) => {
  const { link, base, home, output } = await start(t, ['--https']);
  assert.ok(base.startsWith(`https://${lan}:`), base);
  const caFile = path.join(home, '.phonepeek', 'ca.crt');
  const ca = fs.readFileSync(caFile);
  const fingerprint = new (require('node:crypto').X509Certificate)(ca).fingerprint256;
  assert.ok(output().includes(fingerprint), 'fingerprint printed in the terminal');
  const login = await get(link, { ca }); // throws if the certificate isn't trusted
  assert.equal(login.status, 302);
  assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Lax; Secure/);
});

test('Ctrl+C stops it: the address stops answering', { skip: opts.skip || (process.platform === 'win32' && 'no SIGINT on Windows') }, async (t) => {
  const { child, base } = await start(t);
  const { hostname, port } = new URL(base);
  child.kill('SIGINT');
  await new Promise((r) => child.once('exit', r));
  const result = await new Promise((resolve) => {
    const s = net.connect(Number(port), hostname);
    s.on('connect', () => { s.destroy(); resolve('open'); });
    s.on('error', (e) => resolve(e.code));
  });
  assert.equal(result, 'ECONNREFUSED');
});

test('--version, --help and invalid ports', () => {
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+\n$/);
  assert.match(run('--help').stdout, /private/);
  for (const bad of ['abc', '0', '70000', '-1']) assert.equal(run(bad).status, 1, bad);
});
