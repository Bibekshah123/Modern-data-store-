// Home automation rules: react to one sensor event by sending commands to other devices.

// When a door in a room opens, switch on that room's lights (unless they are already on).
// `roomDevices` are the registered devices in the same home and room as the event.
export function doorOpensLights(event, roomDevices) {
  if (event.meta.type !== 'door_contact' || event.state !== 'open') return [];
  return roomDevices
    .filter((d) => d.type === 'light' && d.status === 'active' && d.lastState?.state !== 'on')
    .map((d) => ({
      homeId: d.homeId,
      deviceId: d.deviceId,
      payload: { state: 'on', value: 100 },
      reason: `${event.meta.room} door opened`,
    }));
}

// Every door opening notifies the owner. The ingest service uses this only when detectAlert
// raised nothing, so at night the stronger "intrusion" warning is sent instead.
export function doorOpenedAlert(event) {
  if (event.meta.type !== 'door_contact' || event.state !== 'open') return null;
  const { homeId, deviceId, room } = event.meta;
  return {
    homeId, deviceId, ts: event.ts, acknowledged: false,
    kind: 'door_opened', severity: 'info', message: `${room} door opened`,
  };
}
