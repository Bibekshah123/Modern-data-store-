import { Router } from 'express';
import { dateRange, HttpError, parseLimit, route } from '../middleware.js';
import { detectAlert, toEvent, validatePayload } from '../../devices.js';

export default function eventsRouter(db) {
  const events = db.collection('sensor_events');
  const r = Router();

  // GET /events?homeId=&deviceId=&type=&room=&from=&to=&limit=
  r.get('/', route(async (req, res) => {
    const { from, to } = dateRange(req.query);
    const filter = { ts: { $gte: from, $lt: to } };
    for (const key of ['homeId', 'deviceId', 'type', 'room']) if (req.query[key]) filter[`meta.${key}`] = req.query[key];
    if (!filter['meta.homeId'] && !filter['meta.deviceId']) throw new HttpError(400, 'homeId or deviceId is required');
    const limit = parseLimit(req.query.limit);
    const docs = await events.find(filter, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(limit).toArray();
    res.json({ count: docs.length, from, to, events: docs });
  }));

  // POST /events - HTTP fallback for gateways that cannot use MQTT.
  r.post('/', route(async (req, res) => {
    const { deviceId, ...payload } = req.body ?? {};
    const device = await db.collection('devices').findOne({ deviceId });
    if (!device) throw new HttpError(400, `device ${deviceId} is not registered`);
    const error = validatePayload(device.type, payload);
    if (error) throw new HttpError(400, error);
    const event = toEvent(device, payload);
    await events.insertOne(event);
    const home = await db.collection('homes').findOne({ homeId: device.homeId });
    const alert = detectAlert(event, home);
    if (alert) await db.collection('alerts').insertOne(alert);
    delete event._id;
    res.status(201).json({ event, alert: alert ?? undefined });
  }));

  return r;
}
