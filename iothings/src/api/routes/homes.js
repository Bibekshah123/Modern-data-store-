import { Router } from 'express';
import { HttpError, pick, route } from '../middleware.js';

const FIELDS = ['homeId', 'customerRef', 'name', 'address', 'rooms', 'preferences', 'profile'];

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

  r.post('/', route(async (req, res) => {
    const now = new Date();
    const home = { ...pick(req.body, FIELDS), createdAt: now, updatedAt: now };
    await homes.insertOne(home);
    delete home._id;
    res.status(201).location(`/api/v1/homes/${home.homeId}`).json(home);
  }));

  r.patch('/:homeId', route(async (req, res) => {
    const changes = pick(req.body, FIELDS.filter((f) => f !== 'homeId'));
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'nothing to update');
    const home = await homes.findOneAndUpdate(
      { homeId: req.params.homeId },
      { $set: { ...changes, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    if (!home) throw new HttpError(404, 'home not found');
    res.json(home);
  }));

  // Deleting a home removes its devices, events and alerts (right to erasure, UK GDPR Art. 17).
  r.delete('/:homeId', route(async (req, res) => {
    const { homeId } = req.params;
    const { deletedCount } = await homes.deleteOne({ homeId });
    if (!deletedCount) throw new HttpError(404, 'home not found');
    const [devices, events, alerts] = await Promise.all([
      db.collection('devices').deleteMany({ homeId }),
      db.collection('sensor_events').deleteMany({ 'meta.homeId': homeId }),
      db.collection('alerts').deleteMany({ homeId }),
    ]);
    res.json({ deleted: { homes: 1, devices: devices.deletedCount, events: events.deletedCount, alerts: alerts.deletedCount } });
  }));

  return r;
}
