import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { HttpError, parseLimit, route } from '../middleware.js';

export default function alertsRouter(db) {
  const alerts = db.collection('alerts');
  const r = Router();

  r.get('/', route(async (req, res) => {
    const filter = {};
    for (const key of ['homeId', 'kind', 'severity']) if (req.query[key]) filter[key] = req.query[key];
    if (req.query.acknowledged !== undefined) filter.acknowledged = req.query.acknowledged === 'true';
    res.json(await alerts.find(filter).sort({ ts: -1 }).limit(parseLimit(req.query.limit)).toArray());
  }));

  r.post('/:id/acknowledge', route(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw new HttpError(400, 'invalid alert id');
    const alert = await alerts.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!alert) throw new HttpError(404, 'alert not found');
    res.json(alert);
  }));

  return r;
}
