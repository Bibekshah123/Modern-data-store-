// MQTT sensor gateway simulator. Replays today's generated routine for every home,
// publishing each event over MQTT once its time has passed.
//
//   node src/simulator.js                 replay today at 60x speed, then continue in real time
//   node src/simulator.js --speed 600     faster catch-up
//   node src/simulator.js --smoke H001    publish a single smoke alarm for a home and exit
//   node src/simulator.js --invalid       publish malformed messages to demonstrate validation
import mqtt from 'mqtt';
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { connect, close } from './db.js';
import { generateDay } from './behaviour.js';
import { notificationTopic, stateTopic } from './devices.js';

const { values: args } = parseArgs({
  options: {
    speed: { type: 'string', default: '60' },
    smoke: { type: 'string' },
    invalid: { type: 'boolean', default: false },
  },
});

const db = await connect();
const client = mqtt.connect(config.mqttUrl, { ...config.mqttGateway, clientId: `iothings-gateway-${process.pid}` });
await new Promise((resolve, reject) => {
  client.once('connect', resolve);
  client.once('error', reject);
});
const publish = (topic, payload) => client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function finish() {
  await client.endAsync();
  await close();
  process.exit(0);
}

if (args.smoke) {
  const alarm = await db.collection('devices').findOne({ homeId: args.smoke, type: 'smoke_alarm' });
  if (!alarm) throw new Error(`no smoke alarm registered for ${args.smoke}`);
  client.subscribe(notificationTopic(args.smoke));
  client.on('message', (topic, msg) => log('notification received on', topic, msg.toString()));
  await publish(stateTopic(alarm.homeId, alarm.deviceId), { state: 'smoke', battery: 88 });
  log('published smoke event for', alarm.deviceId);
  setTimeout(finish, 3000);
} else if (args.invalid) {
  const device = await db.collection('devices').findOne({ type: 'temperature' });
  await publish(stateTopic(device.homeId, device.deviceId), { value: 999 }); // out of range
  await publish(stateTopic(device.homeId, device.deviceId), { state: 'banana' }); // invalid state
  await publish(stateTopic(device.homeId, 'UNKNOWN-DEVICE'), { value: 20 }); // unregistered device
  await client.publishAsync(stateTopic(device.homeId, device.deviceId), 'not json');
  log('published 4 invalid messages - check the ingest service log');
  await finish();
} else {
  const speed = Number(args.speed);
  const homes = await db.collection('homes').find().toArray();
  const devices = await db.collection('devices').find({ status: 'active' }).toArray();
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  const schedule = homes
    .flatMap((home) => generateDay(home, devices.filter((d) => d.homeId === home.homeId), midnight)
      .map((e) => ({ ...e, homeId: home.homeId })))
    .sort((a, b) => a.payload.ts.localeCompare(b.payload.ts));
  log(`${schedule.length} events scheduled today for ${homes.length} homes, replaying at ${speed}x`);

  // The simulated clock starts at midnight and advances `speed` times faster than real
  // time until it catches up with now; events are only ever published once they are in the past.
  const started = Date.now();
  let i = 0;
  let busy = false;
  const tick = setInterval(async () => {
    if (busy) return;
    busy = true;
    const simNow = Math.min(midnight.getTime() + (Date.now() - started) * speed, Date.now());
    let sent = 0;
    while (i < schedule.length && Date.parse(schedule[i].payload.ts) <= simNow) {
      const e = schedule[i++];
      await publish(stateTopic(e.homeId, e.deviceId), e.payload);
      sent++;
    }
    if (sent) log(`sim clock ${new Date(simNow).toISOString().slice(11, 16)} UTC: published ${sent} (${i}/${schedule.length})`);
    if (i >= schedule.length) {
      clearInterval(tick);
      log('schedule complete');
      await finish();
    }
    busy = false;
  }, 1000);
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
}
