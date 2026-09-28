// Data processing endpoints built on the MongoDB aggregation framework.
import { Router } from 'express';
import { dateRange, HttpError, route } from '../middleware.js';

const TZ = 'Europe/London';
const ENVIRONMENT = ['temperature', 'humidity'];

export default function analyticsRouter(db) {
  const events = db.collection('sensor_events');
  const homes = db.collection('homes');
  const r = Router();

  async function loadHome(homeId) {
    const home = await homes.findOne({ homeId });
    if (!home) throw new HttpError(404, 'home not found');
    return home;
  }

  // Device usage: activations per device, plus time switched on and estimated energy.
  // $setWindowFields pairs each event with the next one from the same device, giving
  // the duration of each state.
  async function deviceUsage(homeId, from, to) {
    return events.aggregate([
      { $match: { 'meta.homeId': homeId, 'meta.type': { $nin: ENVIRONMENT }, ts: { $gte: from, $lt: to } } },
      {
        $setWindowFields: {
          partitionBy: '$meta.deviceId',
          sortBy: { ts: 1 },
          output: { nextTs: { $shift: { output: '$ts', by: 1, default: to } } },
        },
      },
      { $set: { minutes: { $dateDiff: { startDate: '$ts', endDate: '$nextTs', unit: 'second' } } } },
      { $set: { minutes: { $divide: ['$minutes', 60] } } },
      {
        $group: {
          _id: '$meta.deviceId',
          type: { $first: '$meta.type' },
          room: { $first: '$meta.room' },
          events: { $sum: 1 },
          activations: {
            $sum: { $cond: [{ $in: ['$state', ['on', 'detected', 'unlocked', 'open', 'heating', 'pressed', 'smoke']] }, 1, 0] },
          },
          minutesOn: { $sum: { $cond: [{ $in: ['$state', ['on', 'heating']] }, '$minutes', 0] } },
          // watts x hours / 1000 = kWh (smart plugs report their draw in watts)
          kWh: { $sum: { $cond: [{ $eq: ['$meta.type', 'smart_plug'] }, { $divide: [{ $multiply: ['$value', '$minutes'] }, 60_000] }, 0] } },
        },
      },
      {
        $project: {
          _id: 0, deviceId: '$_id', type: 1, room: 1, events: 1, activations: 1,
          hoursOn: { $round: [{ $divide: ['$minutesOn', 60] }, 1] },
          kWh: { $round: ['$kWh', 2] },
        },
      },
      { $sort: { room: 1, type: 1 } },
    ]).toArray();
  }

  r.get('/homes/:homeId/usage', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    await loadHome(req.params.homeId);
    const devices = await deviceUsage(req.params.homeId, from, to);
    const days = (to - from) / 86_400_000;
    res.json({
      homeId: req.params.homeId, from, to,
      totals: {
        activations: devices.reduce((s, d) => s + d.activations, 0),
        lightHoursPerDay: +(devices.filter((d) => d.type === 'light').reduce((s, d) => s + d.hoursOn, 0) / days).toFixed(1),
        heatingHoursPerDay: +(devices.filter((d) => d.type === 'thermostat').reduce((s, d) => s + d.hoursOn, 0) / days).toFixed(1),
        kWh: +devices.reduce((s, d) => s + d.kWh, 0).toFixed(2),
      },
      devices,
    });
  }));

  // Occupancy pattern: motion detections by weekday and hour (UK local time).
  r.get('/homes/:homeId/activity-by-hour', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    await loadHome(req.params.homeId);
    const rows = await events.aggregate([
      { $match: { 'meta.homeId': req.params.homeId, 'meta.type': 'motion', state: 'detected', ts: { $gte: from, $lt: to } } },
      { $group: { _id: { hour: { $hour: { date: '$ts', timezone: TZ } }, room: '$meta.room' }, detections: { $sum: 1 } } },
      { $group: { _id: '$_id.hour', total: { $sum: '$detections' }, rooms: { $push: { k: '$_id.room', v: '$detections' } } } },
      { $project: { _id: 0, hour: '$_id', total: 1, rooms: { $arrayToObject: '$rooms' } } },
      { $sort: { hour: 1 } },
    ]).toArray();
    res.json({ homeId: req.params.homeId, from, to, timezone: TZ, hours: rows });
  }));

  // Routine prediction: median first-motion (wake-up), leave and return times per day type.
  r.get('/homes/:homeId/routine', route(async (req, res) => {
    const to = new Date();
    const from = new Date(to.getTime() - 28 * 86_400_000);
    await loadHome(req.params.homeId);
    const minuteOfDay = { $add: [{ $multiply: [{ $hour: { date: '$ts', timezone: TZ } }, 60] }, { $minute: { date: '$ts', timezone: TZ } }] };
    const rows = await events.aggregate([
      {
        $match: {
          'meta.homeId': req.params.homeId, ts: { $gte: from, $lt: to },
          $or: [{ 'meta.type': 'motion', state: 'detected' }, { 'meta.type': 'door_contact', state: 'open' }],
        },
      },
      { $set: { minute: minuteOfDay, day: { $dateTrunc: { date: '$ts', unit: 'day', timezone: TZ } }, dow: { $isoDayOfWeek: { date: '$ts', timezone: TZ } } } },
      { $match: { minute: { $gte: 240 } } }, // ignore night-time wandering before 04:00
      {
        $group: {
          _id: '$day',
          dow: { $first: '$dow' },
          firstMotion: { $min: { $cond: [{ $eq: ['$meta.type', 'motion'] }, '$minute', null] } },
          firstDoor: { $min: { $cond: [{ $eq: ['$meta.type', 'door_contact'] }, '$minute', null] } },
          lastDoor: { $max: { $cond: [{ $eq: ['$meta.type', 'door_contact'] }, '$minute', null] } },
        },
      },
      {
        $group: {
          _id: { $cond: [{ $gte: ['$dow', 6] }, 'weekend', 'weekday'] },
          days: { $sum: 1 },
          wakeUp: { $median: { input: '$firstMotion', method: 'approximate' } },
          leave: { $median: { input: '$firstDoor', method: 'approximate' } },
          return: { $median: { input: '$lastDoor', method: 'approximate' } },
        },
      },
    ]).toArray();
    const hhmm = (m) => (m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
    res.json({
      homeId: req.params.homeId, from, to, basedOn: 'median of the last 28 days',
      predicted: Object.fromEntries(rows.map((x) => [x._id, { days: x.days, wakeUp: hhmm(x.wakeUp), leave: hhmm(x.leave), return: hhmm(x.return) }])),
    });
  }));

  // Daily temperature and humidity per room.
  r.get('/homes/:homeId/climate', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    await loadHome(req.params.homeId);
    const rows = await events.aggregate([
      { $match: { 'meta.homeId': req.params.homeId, 'meta.type': { $in: ENVIRONMENT }, ts: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { day: { $dateTrunc: { date: '$ts', unit: 'day', timezone: TZ } }, room: '$meta.room', type: '$meta.type' },
          avg: { $avg: '$value' }, min: { $min: '$value' }, max: { $max: '$value' }, readings: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0, day: '$_id.day', room: '$_id.room', type: '$_id.type',
          avg: { $round: ['$avg', 1] }, min: 1, max: 1, readings: 1,
        },
      },
      { $sort: { day: 1, room: 1, type: 1 } },
    ]).toArray();
    res.json({ homeId: req.params.homeId, from, to, days: rows });
  }));

  // Rule-based feedback for the home owner, computed from the aggregations above.
  r.get('/homes/:homeId/recommendations', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    const home = await loadHome(req.params.homeId);
    const days = (to - from) / 86_400_000;
    const [usage, temps, openAlerts, lowBattery] = await Promise.all([
      deviceUsage(home.homeId, from, to),
      events.aggregate([
        { $match: { 'meta.homeId': home.homeId, 'meta.type': 'temperature', ts: { $gte: from, $lt: to } } },
        { $group: { _id: '$meta.room', avg: { $avg: '$value' }, max: { $max: '$value' } } },
      ]).toArray(),
      db.collection('alerts').countDocuments({ homeId: home.homeId, acknowledged: false }),
      events.aggregate([
        { $match: { 'meta.homeId': home.homeId, battery: { $lt: 50 }, ts: { $gte: from, $lt: to } } },
        { $group: { _id: '$meta.deviceId', battery: { $min: '$battery' } } },
      ]).toArray(),
    ]);

    const tips = [];
    for (const d of usage.filter((u) => u.type === 'light' && u.hoursOn / days > 4)) {
      tips.push({ category: 'energy', device: d.deviceId, message: `${d.room} light is on ${(d.hoursOn / days).toFixed(1)} h/day - consider a motion-based auto-off rule` });
    }
    const target = home.preferences?.targetTemperature;
    for (const t of temps) {
      if (target && t.max > target + 1.5) {
        tips.push({ category: 'comfort', room: t._id, message: `${t._id} peaked at ${t.max}°C, above your ${target}°C preference - lower the thermostat setpoint or close blinds on sunny days` });
      }
    }
    const heating = usage.find((u) => u.type === 'thermostat');
    if (heating && heating.hoursOn / days > 8) {
      tips.push({ category: 'energy', message: `Heating runs ${(heating.hoursOn / days).toFixed(1)} h/day - a 1°C lower setpoint saves roughly 10% on heating` });
    }
    const plugs = usage.filter((u) => u.type === 'smart_plug');
    if (plugs.length) tips.push({ category: 'energy', message: `Smart plugs used ${plugs.reduce((s, p) => s + p.kWh, 0).toFixed(1)} kWh in this period` });
    for (const b of lowBattery) tips.push({ category: 'safety', device: b._id, message: `Battery at ${b.battery}% - replace soon` });
    if (openAlerts) tips.push({ category: 'safety', message: `${openAlerts} unacknowledged safety alert(s)` });

    res.json({ homeId: home.homeId, from, to, recommendations: tips });
  }));

  // Estate-wide overview for IoThings staff.
  r.get('/overview', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    const [perDay, perType, devices, alerts] = await Promise.all([
      events.aggregate([
        { $match: { ts: { $gte: from, $lt: to } } },
        { $group: { _id: { $dateTrunc: { date: '$ts', unit: 'day', timezone: TZ } }, events: { $sum: 1 }, homes: { $addToSet: '$meta.homeId' } } },
        { $project: { _id: 0, day: '$_id', events: 1, activeHomes: { $size: '$homes' } } },
        { $sort: { day: 1 } },
      ]).toArray(),
      events.aggregate([
        { $match: { ts: { $gte: from, $lt: to } } },
        { $sortByCount: '$meta.type' },
      ]).toArray(),
      db.collection('devices').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      db.collection('alerts').aggregate([
        { $match: { ts: { $gte: from, $lt: to } } },
        { $group: { _id: { kind: '$kind', acknowledged: '$acknowledged' }, count: { $sum: 1 } } },
      ]).toArray(),
    ]);
    res.json({
      from, to,
      homes: await homes.countDocuments(),
      devicesByStatus: Object.fromEntries(devices.map((d) => [d._id, d.count])),
      eventsPerDay: perDay,
      eventsByType: Object.fromEntries(perType.map((t) => [t._id, t.count])),
      alerts: alerts.map((a) => ({ ...a._id, count: a.count })),
    });
  }));

  return r;
}
