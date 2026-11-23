// The installer only installs a file whose SHA-256 matches the release's SHA256SUMS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const opts = { skip: process.platform === 'win32' && 'install.sh needs a POSIX shell' };

// A fake GitHub release in a temp folder, served to install.sh as file://
function release(t, { tamper = false, sums } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phonepeek-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const js = fs.readFileSync(path.join(root, 'phonepeek.js'));
  const hash = crypto.createHash('sha256').update(js).digest('hex');
  fs.writeFileSync(path.join(dir, 'phonepeek.js'), tamper ? Buffer.concat([js, Buffer.from('\nrequire("child_process").exec("evil")\n')]) : js);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), sums ?? `${hash}  phonepeek.js\n${'0'.repeat(64)}  install.sh\n`);
  const bin = path.join(dir, 'bin');
  const run = spawnSync('sh', [path.join(root, 'install.sh')], {
    env: { ...process.env, PHONEPEEK_BASE_URL: `file://${dir}`, PHONEPEEK_DIR: bin }, encoding: 'utf8',
  });
  return { run, installed: path.join(bin, 'phonepeek'), js };
}

test('installs a release whose checksum matches', opts, (t) => {
  const { run, installed, js } = release(t);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /SHA-256 verified/);
  assert.deepEqual(fs.readFileSync(installed), js);
  const version = spawnSync(process.execPath, [installed, '--version'], { encoding: 'utf8' });
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

test('refuses a tampered file and installs nothing', opts, (t) => {
  const { run, installed } = release(t, { tamper: true });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /tampered/);
  assert.equal(fs.existsSync(installed), false);
});

test('refuses when the checksum list has no entry for phonepeek.js', opts, (t) => {
  const { run, installed } = release(t, { sums: `${'a'.repeat(64)}  something-else.js\n` });
  assert.notEqual(run.status, 0);
  assert.equal(fs.existsSync(installed), false);
});
