// MQTT sensor gateway simulator. Replays today's generated routine for every home,
// publishing each event over MQTT once its time has passed.
//
//   node src/simulator.js                 replay today at 60x speed, then continue in real time
//   node src/simulator.js --speed 600     faster catch-up
//   node src/simulator.js --smoke H001    publish a single smoke alarm for a home and exit
//   node src/simulator.js --invalid       publish malformed messages to demonstrate validation
//   node src/simulator.js --door H001 [--room hallway]
//                                         open a room's door and watch its light switch on automatically
//   node src/simulator.js --lights        run forever as the homes' smart devices: obey each MQTT
//                                         command (iothings/<home>/<device>/command) and report the
//                                         new state. Docker runs this as the smart-devices service.
import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { connect, close } from './db.js';
import { generateDay } from './behaviour.js';
import { notificationTopic, parseCommandTopic, stateTopic } from './devices.js';

const { values: args } = parseArgs({
  options: {
    speed: { type: 'string', default: '60' },
    smoke: { type: 'string' },
    invalid: { type: 'boolean', default: false },
    door: { type: 'string' },
    room: { type: 'string', default: 'hallway' },
    lights: { type: 'boolean', default: false },
  },
});

const db = await connect();
const client = mqtt.connect(config.mqttUrl, { ...config.mqttGateway, clientId: `iothings-gateway-${randomUUID().slice(0, 8)}` });
await new Promise((resolve, reject) => {
  client.once('connect', resolve);
  client.once('error', reject);
});
const publish = (topic, payload) => client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Act as the homes' smart devices: obey each command and report the new state back.
function actAsDevices() {
  client.subscribe('iothings/+/+/command', { qos: 1 });
  client.on('message', async (topic, msg) => {
    const ids = parseCommandTopic(topic);
    if (!ids) return;
    const cmd = JSON.parse(msg.toString());
    log(`${ids.deviceId} received command: ${JSON.stringify({ state: cmd.state, value: cmd.value })} (${cmd.reason})`);
    const report = {};
    if (cmd.state !== undefined) report.state = cmd.state;
    if (cmd.value !== undefined) report.value = cmd.value;
    await publish(stateTopic(ids.homeId, ids.deviceId), report);
  });
}

async function finish() {
  await client.endAsync();
  await close();
  process.exit(0);
}

if (args.lights) {
  actAsDevices();
  log('smart devices ready: waiting for commands');
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
} else if (args.smoke) {
  const alarm = await db.collection('devices').findOne({ homeId: args.smoke, type: 'smoke_alarm' });
  if (!alarm) throw new Error(`no smoke alarm registered for ${args.smoke}`);
  client.subscribe(notificationTopic(args.smoke));
  client.on('message', (topic, msg) => log('notification received on', topic, msg.toString()));
  await publish(stateTopic(alarm.homeId, alarm.deviceId), { state: 'smoke', battery: 88 });
  log('published smoke event for', alarm.deviceId);
  setTimeout(finish, 3000);
} else if (args.door) {
  const devices = db.collection('devices');
  const door = await devices.findOne({ homeId: args.door, room: args.room, type: 'door_contact' });
  if (!door) throw new Error(`no door sensor registered in ${args.door} ${args.room}`);
  const light = await devices.findOne({ homeId: args.door, room: args.room, type: 'light' });
  if (!light) throw new Error(`no light registered in ${args.door} ${args.room}`);

  // Start from a dark room so the rule has something to do.
  await publish(stateTopic(light.homeId, light.deviceId), { state: 'off', value: 0 });
  log(`1. ${light.deviceId} is off`);
  await new Promise((r) => setTimeout(r, 2000)); // let the ingest service store it

  await publish(stateTopic(door.homeId, door.deviceId), { state: 'open' });
  log(`2. ${door.deviceId} opened`);
  await new Promise((r) => setTimeout(r, 1000));
  await publish(stateTopic(door.homeId, door.deviceId), { state: 'closed' });

  await new Promise((r) => setTimeout(r, 2500));
  const after = await devices.findOne({ deviceId: light.deviceId });
  log(`3. ${light.deviceId} is now ${after.lastState?.state} (brightness ${after.lastState?.value}%), stored in MongoDB`);
  if (after.lastState?.state !== 'on') log('   (is the smart-devices container running? docker compose up -d smart-devices)');
  await finish();
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
