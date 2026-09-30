// MQTT ingest load test: publishes N valid temperature readings as fast as possible,
// then waits until they are all stored and reports end-to-end throughput.
//   docker compose --profile sim run --rm simulator node scripts/load-test.js [--messages 20000]
import mqtt from 'mqtt';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { connect, close } from '../src/db.js';
import { stateTopic } from '../src/devices.js';

const { values: args } = parseArgs({ options: { messages: { type: 'string', default: '20000' } } });
const N = Number(args.messages);

const db = await connect();
const devices = await db.collection('devices').find({ type: 'temperature' }).toArray();
const events = db.collection('sensor_events');
// Tag the readings with a unique timestamp window so they can be counted afterwards
const base = Date.now() - 3_600_000;
const window = { ts: { $gte: new Date(base), $lt: new Date(base + N) }, 'meta.type': 'temperature' };
const before = await events.countDocuments(window);

const client = mqtt.connect(config.mqttUrl, { ...config.mqttGateway, clientId: `iothings-loadtest-${process.pid}` });
await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });

console.log(`Publishing ${N} messages from ${devices.length} temperature sensors...`);
// MQTT packet ids are 16-bit, so at most 65,535 QoS 1 messages can await acknowledgement;
// publish in windows well below that.
const WINDOW = 5000;
const t0 = Date.now();
for (let start = 0; start < N; start += WINDOW) {
  const pending = [];
  for (let i = start; i < Math.min(start + WINDOW, N); i++) {
    const d = devices[i % devices.length];
    const payload = { value: Math.round((18 + Math.random() * 4) * 10) / 10, ts: new Date(base + i).toISOString() };
    pending.push(client.publishAsync(stateTopic(d.homeId, d.deviceId), JSON.stringify(payload), { qos: 1 }));
  }
  await Promise.all(pending);
}
const published = Date.now() - t0;
console.log(`Published (QoS 1 acknowledged by broker) in ${published} ms = ${Math.round(N / (published / 1000))} msg/s`);

let stored = 0;
while (stored < N && Date.now() - t0 < 120_000) {
  await new Promise((r) => setTimeout(r, 250));
  stored = (await events.countDocuments(window)) - before;
}
const total = Date.now() - t0;
console.log(`Stored in MongoDB (w: majority): ${stored}/${N} in ${total} ms = ${Math.round(stored / (total / 1000))} events/s end-to-end`);

// Remove the synthetic load so it does not distort analytics
await events.deleteMany(window);
await client.endAsync();
await close();
