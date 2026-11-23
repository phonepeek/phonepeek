const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { qrMatrix } = require('../../phonepeek.js');

test('QR code matches a known-good encoding', () => {
  // Expected hash was checked module-for-module against the `qrcode` npm package and decoded with jsQR.
  const bits = qrMatrix('http://192.168.2.13:8000').map((r) => r.map((d) => (d ? 1 : 0)).join('')).join('\n');
  assert.equal(crypto.createHash('sha256').update(bits).digest('hex'), 'ff0a6da522c3519aa694e4e8749d149847e0beb96de7acbbedf1974766afe78a');
});

test('QR code fits the longest private link and rejects longer input', () => {
  const longest = 'https://192.168.255.255:65535/?phonepeek=' + 'x'.repeat(22);
  assert.equal(qrMatrix(longest).length >= 21, true);
  assert.throws(() => qrMatrix('x'.repeat(200)), /too long/);
});
