import { Router } from 'express';
import { HttpError, pick, route } from '../middleware.js';

const FIELDS = ['deviceId', 'homeId', 'type', 'room', 'manufacturer', 'model', 'firmware', 'status'];

export default function devicesRouter(db) {
  const devices = db.collection('devices');
  const homes = db.collection('homes');
  const r = Router();

  r.get('/', route(async (req, res) => {
    const filter = {};
    for (const key of ['homeId', 'type', 'room', 'status']) if (req.query[key]) filter[key] = req.query[key];
    res.json(await devices.find(filter, { projection: { _id: 0 } }).sort({ deviceId: 1 }).toArray());
  }));

  r.get('/:deviceId', route(async (req, res) => {
    const device = await devices.findOne({ deviceId: req.params.deviceId }, { projection: { _id: 0 } });
    if (!device) throw new HttpError(404, 'device not found');
    res.json(device);
  }));

  r.post('/', route(async (req, res) => {
    const device = { status: 'active', ...pick(req.body, FIELDS), installedAt: new Date() };
    const home = await homes.findOne({ homeId: device.homeId });
    if (!home) throw new HttpError(400, `home ${device.homeId} does not exist`);
    if (!home.rooms.includes(device.room)) throw new HttpError(400, `room must be one of: ${home.rooms.join(', ')}`);
    await devices.insertOne(device);
    delete device._id;
    res.status(201).location(`/api/v1/devices/${device.deviceId}`).json(device);
  }));

  r.patch('/:deviceId', route(async (req, res) => {
    const changes = pick(req.body, ['room', 'manufacturer', 'model', 'firmware', 'status']);
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'nothing to update');
    const device = await devices.findOneAndUpdate(
      { deviceId: req.params.deviceId },
      { $set: changes },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    if (!device) throw new HttpError(404, 'device not found');
    res.json(device);
  }));

  r.delete('/:deviceId', route(async (req, res) => {
    const { deletedCount } = await devices.deleteOne({ deviceId: req.params.deviceId });
    if (!deletedCount) throw new HttpError(404, 'device not found');
    res.status(204).end();
  }));

  return r;
}
