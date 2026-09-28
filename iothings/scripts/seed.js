// Builds the test dataset: homes, devices and N days of historical sensor activations.
// Events go through the same validation and alert rules as live MQTT messages.
//
//   node scripts/seed.js [--homes 20] [--days 30] [--reset] [--export]
import { writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { connect, close } from '../src/db.js';
import { buildHome, generateDay } from '../src/behaviour.js';
import { detectAlert, toEvent, validatePayload } from '../src/devices.js';

const { values: args } = parseArgs({
  options: {
    homes: { type: 'string', default: '20' },
    days: { type: 'string', default: '30' },
    reset: { type: 'boolean', default: false },
    export: { type: 'boolean', default: false },
  },
});
const HOMES = Number(args.homes);
const DAYS = Number(args.days);

const db = await connect();
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const firstDay = new Date(today.getTime() - DAYS * 86_400_000);

if (args.reset) {
  console.log('Clearing existing data');
  await Promise.all(['homes', 'devices', 'sensor_events', 'alerts'].map((c) => db.collection(c).deleteMany({})));
}

const totals = { homes: 0, devices: 0, events: 0, alerts: 0, rejected: 0 };
const sample = { homes: [], devices: [], events: [] };

for (let n = 1; n <= HOMES; n++) {
  const { home, devices } = buildHome(n, new Date(firstDay.getTime() - 7 * 86_400_000));
  await db.collection('homes').replaceOne({ homeId: home.homeId }, home, { upsert: true });
  await db.collection('devices').bulkWrite(
    devices.map((d) => ({ replaceOne: { filter: { deviceId: d.deviceId }, replacement: d, upsert: true } })),
  );
  totals.homes++;
  totals.devices += devices.length;
  const byId = new Map(devices.map((d) => [d.deviceId, d]));

  for (let day = new Date(firstDay); day < today; day = new Date(day.getTime() + 86_400_000)) {
    const events = [];
    const alerts = [];
    for (const { deviceId, payload } of generateDay(home, devices, day)) {
      const device = byId.get(deviceId);
      if (validatePayload(device.type, payload)) {
        totals.rejected++;
        continue;
      }
      const event = toEvent(device, payload);
      events.push(event);
      const alert = detectAlert(event, home);
      if (alert) alerts.push(alert);
    }
    if (events.length) await db.collection('sensor_events').insertMany(events, { ordered: false });
    if (alerts.length) await db.collection('alerts').insertMany(alerts);
    totals.events += events.length;
    totals.alerts += alerts.length;
    if (n === 1 && sample.events.length === 0) sample.events = events;
  }

  // latest state per device, as the ingest service would maintain it
  const latest = await db.collection('sensor_events').aggregate([
    { $match: { 'meta.homeId': home.homeId } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$meta.deviceId', ts: { $first: '$ts' }, state: { $first: '$state' }, value: { $first: '$value' } } },
  ]).toArray();
  if (latest.length) {
    await db.collection('devices').bulkWrite(latest.map((l) => ({
      updateOne: { filter: { deviceId: l._id }, update: { $set: { lastSeen: l.ts, lastState: { state: l.state, value: l.value } } } },
    })));
  }
  if (n <= 2) {
    sample.homes.push(home);
    sample.devices.push(...devices);
  }
  console.log(`${home.homeId} (${home.profile}, ${home.address.city}): ${devices.length} devices seeded`);
}

console.log('\nDataset summary', totals, `\nPeriod: ${firstDay.toISOString().slice(0, 10)} to ${today.toISOString().slice(0, 10)}`);

if (args.export) {
  await mkdir('data', { recursive: true });
  await writeFile('data/sample-homes.json', JSON.stringify(sample.homes, null, 2));
  await writeFile('data/sample-devices.json', JSON.stringify(sample.devices, null, 2));
  const csv = ['ts,homeId,deviceId,type,room,state,value,unit']
    .concat(sample.events.map((e) => [e.ts.toISOString(), e.meta.homeId, e.meta.deviceId, e.meta.type, e.meta.room, e.state ?? '', e.value ?? '', e.unit ?? ''].join(',')))
    .join('\n');
  await writeFile('data/sample-sensor-events-one-day.csv', csv);
  await writeFile('data/dataset-summary.json', JSON.stringify({ ...totals, from: firstDay, to: today, generatedAt: new Date() }, null, 2));
  console.log('Exported sample files to data/');
}

await close();
