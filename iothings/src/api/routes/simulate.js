// Test endpoint that drives the real MQTT pipeline from Swagger: the API publishes as a
// door sensor would, then waits for the ingest service to raise the door alert and for
// the automation and the smart lights to switch the light on.
import { Router } from 'express';
import { HttpError, route } from '../middleware.js';
import { publish } from '../mqtt.js';
import { stateTopic } from '../../devices.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until every device's stored lastState matches `expected` ({state} and/or {value}),
// or the timeout passes. Returns the devices as last read.
export async function waitForState(devices, ids, expected, timeoutMs = 6000) {
  const want = typeof expected === 'string' ? { state: expected } : expected;
  const matches = (d) => Object.entries(want).every(([k, v]) => d.lastState?.[k] === v);
  const until = Date.now() + timeoutMs;
  for (;;) {
    const docs = await devices.find({ deviceId: { $in: ids } }, { projection: { _id: 0, deviceId: 1, lastState: 1 } }).toArray();
    if (docs.every(matches) || Date.now() > until) return docs;
    await sleep(250);
  }
}

// Waits for the alert the ingest service raises for this door opening.
async function waitForDoorAlert(alerts, deviceId, since, timeoutMs = 4000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const alert = await alerts.findOne({ deviceId, ts: { $gte: since } }, { sort: { ts: -1 } });
    if (alert || Date.now() > until) return alert;
    await sleep(250);
  }
}

export default function simulateRouter(db) {
  const devices = db.collection('devices');
  const alerts = db.collection('alerts');
  const r = Router();

  // A person opens a room's door: expect a door alert and the room's light switching on.
  r.post('/door', route(async (req, res) => {
    const { homeId, room = 'hallway', resetLights = true } = req.body ?? {};
    if (typeof homeId !== 'string' || typeof room !== 'string') throw new HttpError(400, 'homeId (and optional room) must be strings');
    const door = await devices.findOne({ homeId, room, type: 'door_contact' });
    if (!door) throw new HttpError(404, `no door sensor in ${homeId} ${room} - register one with POST /api/v1/devices (type door_contact)`);
    const lights = await devices.find({ homeId, room, type: 'light', status: 'active' }).toArray();
    if (!lights.length) throw new HttpError(404, `no active light in ${homeId} ${room}`);
    const ids = lights.map((l) => l.deviceId);
    const steps = [];

    if (resetLights) {
      for (const id of ids) await publish(stateTopic(homeId, id), { state: 'off', value: 0 });
      await waitForState(devices, ids, 'off');
      steps.push(`1. switched the light off so the test starts in a dark room: ${ids.join(', ')}`);
    }
    const before = await devices.find({ deviceId: { $in: ids } }).toArray();

    const openedAt = new Date(Date.now() - 1000); // small margin for clock differences
    await publish(stateTopic(homeId, door.deviceId), { state: 'open' });
    steps.push(`2. the door sensor ${door.deviceId} sent "open" over MQTT`);

    const [alert, after] = await Promise.all([
      waitForDoorAlert(alerts, door.deviceId, openedAt),
      waitForState(devices, ids, 'on'),
    ]);
    const lightOn = after.every((d) => d.lastState?.state === 'on');
    steps.push(alert
      ? `3. alert raised: "${alert.message}" (${alert.kind}, ${alert.severity}) and sent to iothings/${homeId}/notifications`
      : '3. no alert seen in time - is the ingest container running?');
    steps.push(lightOn
      ? '4. the ingest service told the light to switch on; the light obeyed and reported "on"'
      : '4. the light did not switch on in time - are the ingest and smart-devices containers running?');

    await publish(stateTopic(homeId, door.deviceId), { state: 'closed' });
    await waitForState(devices, [door.deviceId], 'closed', 3000); // so a status check right after sees it
    steps.push('5. the door sensor sent "closed" (the person walked through)');

    res.json({
      homeId, room, door: door.deviceId,
      alertRaised: Boolean(alert),
      lightTurnedOn: lightOn,
      alert: alert && { id: alert._id, kind: alert.kind, severity: alert.severity, message: alert.message, ts: alert.ts },
      lights: ids.map((id) => ({
        deviceId: id,
        before: before.find((d) => d.deviceId === id)?.lastState?.state ?? 'unknown',
        after: after.find((d) => d.deviceId === id)?.lastState?.state ?? 'unknown',
      })),
      steps,
    });
  }));

  return r;
}
