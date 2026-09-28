// CRUD and query demonstration for the report. Run with scripts/mongosh.sh api mongo/demo-queries.js
const iot = db.getSiblingDB('iothings');
const section = (t) => print(`\n==== ${t} ====`);

section('CREATE - register a new home and a device');
iot.homes.insertOne({
  homeId: 'H900', customerRef: 'CRM-19900', name: 'Demo home', address: { city: 'Birmingham', postcode: 'B4 7XG' },
  rooms: ['hallway', 'kitchen'], preferences: { targetTemperature: 20 }, createdAt: new Date(),
});
iot.devices.insertOne({ deviceId: 'H900-kitchen-smoke-alarm', homeId: 'H900', type: 'smoke_alarm', room: 'kitchen', status: 'active', installedAt: new Date() });
iot.sensor_events.insertOne({ ts: new Date(), meta: { homeId: 'H900', deviceId: 'H900-kitchen-smoke-alarm', type: 'smoke_alarm', room: 'kitchen' }, state: 'test' });
printjson(iot.homes.findOne({ homeId: 'H900' }, { _id: 0 }));

section('CREATE - schema validation rejects a bad document');
try {
  iot.devices.insertOne({ deviceId: 'H900-bad', homeId: 'H900', type: 'toaster', room: 'kitchen', installedAt: new Date() });
} catch (e) {
  print(`rejected: ${e.message}`);
}

section('READ - latest 5 events for the H001 front door lock');
iot.sensor_events.find({ 'meta.deviceId': 'H001-hallway-door-lock' }, { _id: 0, ts: 1, state: 1 }).sort({ ts: -1 }).limit(5).forEach(printjson);

section('READ - homes in Birmingham with their device count ($lookup)');
iot.homes.aggregate([
  { $match: { 'address.city': 'Birmingham' } },
  { $lookup: { from: 'devices', localField: 'homeId', foreignField: 'homeId', as: 'devices' } },
  { $project: { _id: 0, homeId: 1, postcode: '$address.postcode', devices: { $size: '$devices' } } },
]).forEach(printjson);

section('UPDATE - change preferences and mark a device faulty');
printjson(iot.homes.updateOne({ homeId: 'H900' }, { $set: { 'preferences.targetTemperature': 21, updatedAt: new Date() } }));
printjson(iot.devices.updateOne({ deviceId: 'H900-kitchen-smoke-alarm' }, { $set: { status: 'faulty' } }));

section('AGGREGATE - top 5 homes by lighting activations in the last 7 days');
iot.sensor_events.aggregate([
  { $match: { 'meta.type': 'light', state: 'on', ts: { $gte: new Date(Date.now() - 7 * 864e5) } } },
  { $group: { _id: '$meta.homeId', activations: { $sum: 1 } } },
  { $sort: { activations: -1 } },
  { $limit: 5 },
]).forEach(printjson);

section('AGGREGATE - average living-room temperature by hour of day (UK time)');
iot.sensor_events.aggregate([
  { $match: { 'meta.type': 'temperature', 'meta.room': 'living_room' } },
  { $group: { _id: { $hour: { date: '$ts', timezone: 'Europe/London' } }, avg: { $avg: '$value' } } },
  { $project: { _id: 0, hour: '$_id', avgC: { $round: ['$avg', 1] } } },
  { $sort: { hour: 1 } },
]).forEach((r) => print(`${String(r.hour).padStart(2, '0')}:00  ${r.avgC}°C  ${'#'.repeat(Math.max(0, Math.round((r.avgC - 14) * 3)))}`));

section('INDEX USAGE - explain() for a per-device time-range query');
const plan = iot.sensor_events.find({ 'meta.deviceId': 'H001-hallway-door-lock', ts: { $gte: new Date(Date.now() - 864e5) } }).explain('executionStats');
const stages = JSON.stringify(plan).match(/"indexName":"[^"]+"/g) || [];
print(`indexes used: ${[...new Set(stages)].join(', ') || 'bucket scan'}`);

section('DELETE - remove the demo home (GDPR erasure across collections)');
printjson({
  homes: iot.homes.deleteOne({ homeId: 'H900' }).deletedCount,
  devices: iot.devices.deleteMany({ homeId: 'H900' }).deletedCount,
  events: iot.sensor_events.deleteMany({ 'meta.homeId': 'H900' }).deletedCount,
});

section('Collection statistics');
for (const c of ['homes', 'devices', 'sensor_events', 'alerts']) print(`${c.padEnd(14)} ${iot[c].countDocuments()} documents`);
