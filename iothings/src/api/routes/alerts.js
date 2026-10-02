import { Router } from 'express';
import { parseLimit, route } from '../middleware.js';

export default function alertsRouter(db) {
  const alerts = db.collection('alerts');
  const r = Router();

  r.get('/', route(async (req, res) => {
    const filter = {};
    for (const key of ['homeId', 'kind', 'severity']) if (req.query[key]) filter[key] = req.query[key];
    if (req.query.acknowledged !== undefined) filter.acknowledged = req.query.acknowledged === 'true';
    res.json(await alerts.find(filter).sort({ ts: -1 }).limit(parseLimit(req.query.limit)).toArray());
  }));

  return r;
}
