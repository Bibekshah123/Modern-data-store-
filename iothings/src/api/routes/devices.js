import { Router } from 'express';
import { route } from '../middleware.js';

export default function devicesRouter(db) {
  const devices = db.collection('devices');
  const r = Router();

  r.get('/', route(async (req, res) => {
    const filter = {};
    for (const key of ['homeId', 'type', 'room', 'status']) if (req.query[key]) filter[key] = req.query[key];
    res.json(await devices.find(filter, { projection: { _id: 0 } }).sort({ deviceId: 1 }).toArray());
  }));

  return r;
}
