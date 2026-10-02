import { Router } from 'express';
import { HttpError, parseLimit, route } from '../middleware.js';

// The live state of one room: its door sensor, its lights and the latest door alerts.
export default function roomsRouter(db) {
  const r = Router();

  r.get('/:homeId/:room', route(async (req, res) => {
    const { homeId, room } = req.params;
    const roomDevices = await db.collection('devices')
      .find({ homeId, room }, { projection: { _id: 0, deviceId: 1, type: 1, lastState: 1, lastSeen: 1 } })
      .toArray();
    if (!roomDevices.length) throw new HttpError(404, `no devices in ${homeId} ${room}`);

    const doors = roomDevices.filter((d) => d.type === 'door_contact');
    const show = (d) => ({ deviceId: d.deviceId, state: d.lastState?.state ?? 'unknown', since: d.lastSeen ?? null });
    const doorAlerts = doors.length
      ? await db.collection('alerts')
        .find({ deviceId: { $in: doors.map((d) => d.deviceId) } }, { projection: { homeId: 0, deviceId: 0 } })
        .sort({ ts: -1 }).limit(parseLimit(req.query.limit, 5, 50)).toArray()
      : [];

    res.json({
      homeId, room,
      doors: doors.map(show),
      lights: roomDevices.filter((d) => d.type === 'light').map((d) => ({ ...show(d), brightness: d.lastState?.value ?? null })),
      latestDoorAlerts: doorAlerts,
    });
  }));

  return r;
}
