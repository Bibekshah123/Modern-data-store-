// Data processing endpoint built on the MongoDB aggregation framework.
import { Router } from 'express';
import { HttpError, route } from '../middleware.js';

const TZ = 'Europe/London';

export default function analyticsRouter(db) {
  const events = db.collection('sensor_events');
  const homes = db.collection('homes');
  const r = Router();

  async function loadHome(homeId) {
    const home = await homes.findOne({ homeId });
    if (!home) throw new HttpError(404, 'home not found');
    return home;
  }

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

  return r;
}
