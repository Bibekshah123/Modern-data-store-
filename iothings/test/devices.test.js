import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAlert, isNight, parseStateTopic, toEvent, validatePayload } from '../src/devices.js';
import { buildHome, generateDay } from '../src/behaviour.js';

test('parses state topics', () => {
  assert.deepEqual(parseStateTopic('iothings/H001/H001-kitchen-light/state'), { homeId: 'H001', deviceId: 'H001-kitchen-light' });
  assert.equal(parseStateTopic('iothings/H001/state'), null);
  assert.equal(parseStateTopic('other/H001/x/state'), null);
});

test('validates payloads per device type', () => {
  assert.equal(validatePayload('light', { state: 'on', value: 80 }), null);
  assert.equal(validatePayload('temperature', { value: 21.5 }), null);
  assert.match(validatePayload('temperature', { value: 999 }), /outside/);
  assert.match(validatePayload('door_lock', { state: 'open' }), /invalid state/);
  assert.match(validatePayload('motion', { value: 3 }), /does not report a value/);
  assert.match(validatePayload('light', {}), /state or a value/);
  assert.match(validatePayload('toaster', { state: 'on' }), /unknown device type/);
  assert.match(validatePayload('light', { state: 'on', ts: 'yesterday' }), /ISO-8601/);
});

test('night hours use UK local time', () => {
  // 22:30 UTC in July is 23:30 BST
  assert.equal(isNight(new Date('2026-07-01T22:30:00Z'), { nightStart: '23:00', nightEnd: '06:00' }), true);
  assert.equal(isNight(new Date('2026-01-01T22:30:00Z'), { nightStart: '23:00', nightEnd: '06:00' }), false);
  assert.equal(isNight(new Date('2026-01-01T12:00:00Z')), false);
});

test('raises alerts for safety events', () => {
  const device = { deviceId: 'D1', homeId: 'H001', type: 'smoke_alarm', room: 'kitchen' };
  const alert = detectAlert(toEvent(device, { state: 'smoke' }), {});
  assert.equal(alert.kind, 'smoke');
  assert.equal(alert.severity, 'critical');
  assert.equal(detectAlert(toEvent(device, { state: 'clear' }), {}), null);

  const lock = { ...device, type: 'door_lock', room: 'hallway' };
  assert.equal(detectAlert(toEvent(lock, { state: 'unlocked', ts: '2026-01-10T02:00:00Z' }), {}).kind, 'door_unlocked');
  assert.equal(detectAlert(toEvent(lock, { state: 'unlocked', ts: '2026-01-10T12:00:00Z' }), {}), null);
});

test('generated dataset is deterministic and valid', () => {
  const { home, devices } = buildHome(1, new Date('2026-01-01'));
  const day = new Date('2026-03-10T00:00:00Z');
  const a = generateDay(home, devices, day);
  assert.deepEqual(a, generateDay(home, devices, day));
  assert.ok(a.length > 300);
  const byId = new Map(devices.map((d) => [d.deviceId, d]));
  for (const { deviceId, payload } of a) assert.equal(validatePayload(byId.get(deviceId).type, payload), null);
});
