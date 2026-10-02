import { Router } from 'express';
import { HttpError, route } from '../middleware.js';

export default function homesRouter(db) {
  const homes = db.collection('homes');
  const r = Router();

  r.get('/', route(async (req, res) => {
    const filter = {};
    if (req.query.city) filter['address.city'] = req.query.city;
    if (req.query.customerRef) filter.customerRef = req.query.customerRef;
    res.json(await homes.find(filter, { projection: { _id: 0 } }).sort({ homeId: 1 }).toArray());
  }));

  r.get('/:homeId', route(async (req, res) => {
    // Home plus its devices in one round trip
    const [home] = await homes.aggregate([
      { $match: { homeId: req.params.homeId } },
      { $lookup: { from: 'devices', localField: 'homeId', foreignField: 'homeId', as: 'devices', pipeline: [{ $project: { _id: 0 } }] } },
      { $project: { _id: 0 } },
    ]).toArray();
    if (!home) throw new HttpError(404, 'home not found');
    res.json(home);
  }));

  return r;
}
