// --https: the phonepeek CA is trusted for private-network IPs only. Even signed with the real CA key,
// a certificate for a real website or a public IP is rejected, so it can't be used to intercept other traffic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const { certificate } = require('../../phonepeek.js');
const { setup, request } = require('../helpers.js');

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }
const opts = { skip: !hasOpenssl && 'openssl not installed' };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phonepeek-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the phone trusts phonepeek with the CA installed (no "not private" warning)', opts, async (t) => {
  const certs = certificate('127.0.0.1', tmp(t));
  const { proxy, cookie } = await setup(t, { token: 'tok', tls: certs });
  const ca = fs.readFileSync(certs.caFile);
  const res = await request(proxy, '/', { secure: true, ca, headers: { cookie } }); // rejectUnauthorized: true
  assert.equal(res.body, 'app');
  // and the private-link cookie is Secure over https
  const login = await request(proxy, '/?phonepeek=tok', { secure: true, ca });
  assert.match(login.headers['set-cookie'][0], /; Secure$/);
});

test('without the CA installed, the connection is refused (not silently trusted)', opts, async (t) => {
  const { proxy } = await setup(t, { token: 'tok', tls: certificate('127.0.0.1', tmp(t)) });
  // A phone without the CA installed only trusts the normal public certificate authorities.
  await assert.rejects(new Promise((resolve, reject) => {
    require('node:https').get({ host: '127.0.0.1', port: proxy, agent: false, rejectUnauthorized: true }, resolve).on('error', reject);
  }), /self[- ]signed|unable to (get|verify)|certificate/i);
});

for (const san of ['DNS:google.com', 'DNS:localhost', 'IP:8.8.8.8', 'IP:1.1.1.1']) {
  test(`a certificate for ${san} signed with the real phonepeek CA key is rejected`, opts, async (t) => {
    const dir = tmp(t);
    const certs = certificate('127.0.0.1', dir);
    const f = (n) => path.join(dir, n);
    fs.writeFileSync(f('e.ext'), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
    execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=evil', '-keyout', f('e.key'), '-out', f('e.csr')], { stdio: 'ignore' });
    execFileSync('openssl', ['x509', '-req', '-in', f('e.csr'), '-CA', certs.caFile, '-CAkey', f('ca.key'), '-set_serial', '7', '-days', '30',
      '-extfile', f('e.ext'), '-out', f('e.crt')], { stdio: 'ignore' });
    const server = tls.createServer({ key: fs.readFileSync(f('e.key')), cert: fs.readFileSync(f('e.crt')) }, (s) => s.end('pwned'));
    const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    t.after(() => server.close());
    const servername = san.startsWith('DNS:') ? san.slice(4) : undefined;
    const err = await new Promise((resolve) => {
      const s = tls.connect({ port, host: '127.0.0.1', servername, ca: fs.readFileSync(certs.caFile),
        checkServerIdentity: () => undefined /* only test the CA's constraints, not the hostname */ });
      s.on('secureConnect', () => { s.destroy(); resolve(null); });
      s.on('error', resolve);
    });
    assert.ok(err, 'connection must fail');
    assert.match(`${err.code} ${err.message}`, /SUBTREE|constraint/i);
  });
}

test('private keys are readable only by you', { skip: (!hasOpenssl && 'openssl not installed') || (process.platform === 'win32' && 'no POSIX permissions') }, (t) => {
  const dir = path.join(tmp(t), 'pp');
  fs.mkdirSync(dir, { mode: 0o755 }); // as left by an older version
  certificate('192.168.1.23', dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const k of ['ca.key', 'ip-192.168.1.23.key']) assert.equal(fs.statSync(path.join(dir, k)).mode & 0o777, 0o600, k);
});

test('certificates are reused across runs and re-issued per IP from the same CA', opts, (t) => {
  const dir = tmp(t);
  const a = certificate('192.168.1.23', dir);
  const b = certificate('192.168.1.23', dir);
  const c = certificate('10.0.0.5', dir);
  assert.equal(a.caFingerprint, b.caFingerprint);
  assert.equal(a.caFingerprint, c.caFingerprint);
  assert.deepEqual(a.cert, b.cert);
  assert.notDeepEqual(a.cert, c.cert);
});
