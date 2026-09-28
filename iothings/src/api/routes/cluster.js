import { Router } from 'express';
import { route } from '../middleware.js';

// Replica set health, for operations dashboards and the failover demonstration.
export default function clusterRouter(db) {
  const r = Router();
  r.get('/status', route(async (req, res) => {
    const status = await db.admin().command({ replSetGetStatus: 1 });
    res.json({
      set: status.set,
      date: status.date,
      members: status.members.map((m) => ({
        name: m.name,
        state: m.stateStr,
        health: m.health,
        uptimeSeconds: m.uptime,
        lastHeartbeat: m.lastHeartbeat,
        optimeDate: m.optimeDate,
        syncSourceHost: m.syncSourceHost || undefined,
      })),
    });
  }));
  return r;
}
