// MQTT ingest service: subscribes to device state topics, validates each message
// against the device registry, raises safety alerts and stores events in MongoDB in batches.
import mqtt from 'mqtt';
import { config } from './config.js';
import { connect, close } from './db.js';
import { detectAlert, notificationTopic, parseStateTopic, toEvent, validatePayload } from './devices.js';

const log = (...args) => console.log(new Date().toISOString(), ...args);

const db = await connect();
const devices = db.collection('devices');
const homes = db.collection('homes');
const events = db.collection('sensor_events');
const alerts = db.collection('alerts');

// Small cache so every message does not cost a registry lookup.
const CACHE_TTL_MS = 60_000;
const cache = new Map();
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

const stats = { received: 0, stored: 0, rejected: 0, alerts: 0 };
let buffer = [];

async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await events.insertMany(batch, { ordered: false });
    // Keep a denormalised copy of each device's latest state for fast dashboard reads.
    const latest = new Map();
    for (const e of batch) {
      const prev = latest.get(e.meta.deviceId);
      if (!prev || e.ts > prev.ts) latest.set(e.meta.deviceId, e);
    }
    await devices.bulkWrite(
      [...latest.values()].map((e) => ({
        updateOne: {
          filter: { deviceId: e.meta.deviceId, $or: [{ lastSeen: { $lt: e.ts } }, { lastSeen: { $exists: false } }] },
          update: { $set: { lastSeen: e.ts, lastState: { state: e.state, value: e.value, battery: e.battery } } },
        },
      })),
      { ordered: false },
    );
    stats.stored += batch.length;
  } catch (err) {
    log('batch insert failed, re-queueing', batch.length, 'events:', err.message);
    buffer = batch.concat(buffer);
  }
}

const client = mqtt.connect(config.mqttUrl, {
  ...config.mqttIngest,
  clientId: `iothings-ingest-${process.pid}`,
  clean: false, // persistent session: the broker queues QoS 1 messages while we are down
});

client.on('connect', () => {
  log('connected to MQTT broker', config.mqttUrl);
  client.subscribe('iothings/+/+/state', { qos: 1 });
});
client.on('error', (err) => log('MQTT error:', err.message));

client.on('message', async (topic, raw) => {
  stats.received++;
  const ids = parseStateTopic(topic);
  if (!ids) return stats.rejected++;

  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    stats.rejected++;
    return log('rejected non-JSON message on', topic);
  }

  const device = await cached(`d:${ids.deviceId}`, () => devices.findOne({ deviceId: ids.deviceId }));
  if (!device || device.homeId !== ids.homeId) {
    stats.rejected++;
    return log('rejected message from unregistered device', topic);
  }
  const error = validatePayload(device.type, payload);
  if (error) {
    stats.rejected++;
    return log('rejected', topic, error);
  }

  const event = toEvent(device, payload);
  buffer.push(event);

  const home = await cached(`h:${device.homeId}`, () => homes.findOne({ homeId: device.homeId }));
  const alert = detectAlert(event, home);
  if (alert) {
    stats.alerts++;
    await alerts.insertOne(alert);
    client.publish(notificationTopic(alert.homeId), JSON.stringify(alert), { qos: 1 });
    log('ALERT', alert.severity, alert.message, alert.homeId);
  }

  if (buffer.length >= config.batchSize) await flush();
});

const flushTimer = setInterval(flush, config.batchIntervalMs);
const statsTimer = setInterval(() => log('stats', JSON.stringify(stats)), 30_000);

async function shutdown() {
  log('shutting down');
  clearInterval(flushTimer);
  clearInterval(statsTimer);
  await new Promise((resolve) => client.end(false, resolve));
  await flush();
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
