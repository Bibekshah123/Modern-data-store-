// Compares time-series bucket granularities against a plain collection for the same
// events: storage, index size, buckets and query cost. Copies are dropped afterwards.
//   scripts/mongosh.sh admin mongo/benchmark-granularity.js
const iot = db.getSiblingDB('iothings');
const variants = ['seconds', 'minutes', 'hours', 'plain'];
const INDEXES = [{ 'meta.homeId': 1, ts: -1 }, { 'meta.deviceId': 1, ts: -1 }, { 'meta.type': 1, ts: -1 }];
const name = (v) => `bench_events_${v}`;

// Pick a full day and a device/home that exist in the data set
const last = iot.sensor_events.find().sort({ ts: -1 }).limit(1).next().ts;
const to = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
const from = new Date(to.getTime() - 864e5);
const weekFrom = new Date(to.getTime() - 7 * 864e5);
const deviceId = 'H005-living-room-temperature';
const homeId = 'H005';

print(`Building copies of ${iot.sensor_events.countDocuments()} events...`);
for (const v of variants) {
  iot[name(v)].drop();
  const out = v === 'plain'
    ? name(v)
    : { db: 'iothings', coll: name(v), timeseries: { timeField: 'ts', metaField: 'meta', granularity: v } };
  iot.sensor_events.aggregate([{ $project: { _id: 0 } }, { $out: out }]).toArray();
  INDEXES.forEach((k) => iot[name(v)].createIndex(k));
}
db.adminCommand({ fsync: 1 }); // flush so storage statistics are accurate

const queries = {
  'device/day': (c) => iot[c].find({ 'meta.deviceId': deviceId, ts: { $gte: from, $lt: to } }),
  'home/day': (c) => iot[c].find({ 'meta.homeId': homeId, ts: { $gte: from, $lt: to } }),
};
const avgMs = (fn, runs = 20) => {
  fn();
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) fn();
  return ((Date.now() - t0) / runs).toFixed(1);
};

print('\nvariant   buckets  dataKB  indexKB  device/day(units,ms)  home/day(units,ms)  7-day agg ms');
for (const v of variants) {
  const c = name(v);
  const s = iot[c].aggregate([{ $collStats: { storageStats: { scale: 1024 } } }]).toArray()[0].storageStats;
  const cells = Object.entries(queries).map(([, q]) => {
    const ex = JSON.stringify(q(c).explain('executionStats'));
    const units = Math.max(...[...ex.matchAll(/"totalDocsExamined":(\d+)/g)].map((m) => +m[1]));
    return `${String(units).padStart(5)}, ${avgMs(() => q(c).toArray()).padStart(4)}`;
  });
  const agg = avgMs(() => iot[c].aggregate([
    { $match: { 'meta.homeId': homeId, 'meta.type': 'motion', ts: { $gte: weekFrom, $lt: to } } },
    { $group: { _id: { $hour: '$ts' }, n: { $sum: 1 } } },
  ]).toArray(), 10);
  print(`${v.padEnd(8)} ${String(s.timeseries?.bucketCount ?? '-').padStart(8)} ${String(s.storageSize).padStart(7)} ${String(s.totalIndexSize).padStart(8)}  ${cells[0].padStart(20)}  ${cells[1].padStart(18)}  ${agg.padStart(12)}`);
}
print('\nunits = buckets examined (time-series) or documents examined (plain)');
variants.forEach((v) => iot[name(v)].drop());
