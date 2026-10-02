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

test('opening a door switches on the lights in that room', async () => {
  const { doorOpensLights } = await import('../src/automations.js');
  const door = { deviceId: 'H001-hallway-door-contact', homeId: 'H001', type: 'door_contact', room: 'hallway' };
  const room = [
    door,
    { deviceId: 'H001-hallway-light', homeId: 'H001', type: 'light', room: 'hallway', status: 'active', lastState: { state: 'off' } },
    { deviceId: 'H001-hallway-motion', homeId: 'H001', type: 'motion', room: 'hallway', status: 'active' },
  ];
  const cmds = doorOpensLights(toEvent(door, { state: 'open' }), room);
  assert.deepEqual(cmds.map((c) => [c.deviceId, c.payload.state]), [['H001-hallway-light', 'on']]);
  assert.deepEqual(doorOpensLights(toEvent(door, { state: 'closed' }), room), []);
  room[1].lastState.state = 'on'; // already on: nothing to do
  assert.deepEqual(doorOpensLights(toEvent(door, { state: 'open' }), room), []);
});

test('opening a door raises a door_opened alert (an intrusion warning at night)', async () => {
  const { doorOpenedAlert } = await import('../src/automations.js');
  const door = { deviceId: 'H001-hallway-door-contact', homeId: 'H001', type: 'door_contact', room: 'hallway' };
  const opened = toEvent(door, { state: 'open', ts: '2026-07-01T12:00:00Z' });
  // what the ingest service does: the night rule first, then the door_opened alert
  const alertFor = (e) => detectAlert(e, {}) ?? doorOpenedAlert(e);
  assert.equal(alertFor(opened).kind, 'door_opened');
  assert.equal(alertFor(opened).message, 'hallway door opened');
  assert.equal(alertFor(toEvent(door, { state: 'closed' })), null);
  assert.equal(alertFor(toEvent(door, { state: 'open', ts: '2026-01-10T02:00:00Z' })).kind, 'intrusion');
});
