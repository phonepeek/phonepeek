const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WIFI } = require('../../phonepeek.js');

const mac = (mode) => JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [
  { _name: 'en0', spairport_current_network_information: mode ? { _name: '<redacted>', spairport_security_mode: mode } : undefined },
  { _name: 'awdl0' },
] }] });

test('macOS: detects open Wi-Fi from system_profiler', () => {
  const parse = WIFI.darwin[2];
  assert.equal(parse(mac('spairport_security_mode_none')), true);
  assert.equal(parse(mac('spairport_security_mode_owe')), true);
  assert.equal(parse(mac('spairport_security_mode_wpa2_personal_mixed')), false);
  assert.equal(parse(mac('spairport_security_mode_wpa3_transition')), false);
  assert.equal(parse(mac(undefined)), null); // not on Wi-Fi
});

test('Linux: detects open Wi-Fi from nmcli', () => {
  const parse = WIFI.linux[2];
  assert.equal(parse('no:WPA2\nyes:\n'), true);
  assert.equal(parse('yes:--\n'), true);
  assert.equal(parse('yes:OWE\n'), true);
  assert.equal(parse('yes:WPA2 WPA3\nno:\n'), false);
  assert.equal(parse('no:WPA2\n'), null);
});

test('Windows: detects open Wi-Fi from netsh', () => {
  const parse = WIFI.win32[2];
  assert.equal(parse('    Authentication         : Open\r\n'), true);
  assert.equal(parse('    Authentication         : WPA2-Personal\r\n'), false);
  assert.equal(parse('There is no wireless interface on the system.'), null);
});
