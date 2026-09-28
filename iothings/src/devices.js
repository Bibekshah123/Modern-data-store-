// Catalogue of supported device types and the payload each one publishes over MQTT.
// Shared by the ingest service (validation), the simulator and the seed script.

export const DEVICE_TYPES = {
  door_lock: { states: ['locked', 'unlocked'] },
  blind: { unit: '%', min: 0, max: 100 },
  light: { states: ['on', 'off'], unit: '%', min: 0, max: 100 },
  light_switch: { states: ['pressed'] },
  thermostat: { states: ['heating', 'idle'], unit: '°C', min: 5, max: 30 },
  temperature: { unit: '°C', min: -20, max: 60 },
  humidity: { unit: '%', min: 0, max: 100 },
  motion: { states: ['detected', 'clear'] },
  door_contact: { states: ['open', 'closed'] },
  smoke_alarm: { states: ['clear', 'smoke', 'test'] },
  smart_plug: { states: ['on', 'off'], unit: 'W', min: 0, max: 3500 },
};

export const TOPIC_PREFIX = 'iothings';
// iothings/<homeId>/<deviceId>/state
export const stateTopic = (homeId, deviceId) => `${TOPIC_PREFIX}/${homeId}/${deviceId}/state`;
export const notificationTopic = (homeId) => `${TOPIC_PREFIX}/${homeId}/notifications`;

export function parseStateTopic(topic) {
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== TOPIC_PREFIX || parts[3] !== 'state') return null;
  return { homeId: parts[1], deviceId: parts[2] };
}

// Returns an error string, or null when the payload is valid for the device type.
export function validatePayload(type, payload) {
  const spec = DEVICE_TYPES[type];
  if (!spec) return `unknown device type ${type}`;
  if (typeof payload !== 'object' || payload === null) return 'payload must be a JSON object';
  const { state, value } = payload;
  if (state === undefined && value === undefined) return 'payload needs a state or a value';
  if (state !== undefined && !spec.states?.includes(state)) return `invalid state "${state}" for ${type}`;
  if (value !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'value must be a number';
    if (spec.min === undefined) return `${type} does not report a value`;
    if (value < spec.min || value > spec.max) return `value ${value} outside ${spec.min}..${spec.max}`;
  }
  if (payload.ts !== undefined && Number.isNaN(Date.parse(payload.ts))) return 'ts must be an ISO-8601 date';
  if (payload.battery !== undefined && (typeof payload.battery !== 'number' || payload.battery < 0 || payload.battery > 100)) {
    return 'battery must be 0..100';
  }
  return null;
}

// Builds a sensor_events document from a validated payload and its registered device.
export function toEvent(device, payload, receivedAt = new Date()) {
  const event = {
    ts: payload.ts ? new Date(payload.ts) : receivedAt,
    meta: { homeId: device.homeId, deviceId: device.deviceId, type: device.type, room: device.room },
  };
  if (payload.state !== undefined) event.state = payload.state;
  if (payload.value !== undefined) {
    event.value = payload.value;
    event.unit = DEVICE_TYPES[device.type].unit;
  }
  if (payload.battery !== undefined) event.battery = payload.battery;
  return event;
}

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const ukClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Night hours are the home owner's preference, interpreted in UK local time.
export function isNight(date, prefs = {}) {
  const start = minutesOfDay(prefs.nightStart || '23:00');
  const end = minutesOfDay(prefs.nightEnd || '06:00');
  const now = minutesOfDay(ukClock.format(date));
  return start > end ? now >= start || now < end : now >= start && now < end;
}

// Safety rules evaluated on every incoming event. Returns an alert document or null.
export function detectAlert(event, home) {
  const { homeId, deviceId, type, room } = event.meta;
  const base = { homeId, deviceId, ts: event.ts, acknowledged: false };
  if (type === 'smoke_alarm' && event.state === 'smoke') {
    return { ...base, kind: 'smoke', severity: 'critical', message: `Smoke detected in ${room}` };
  }
  if (type === 'door_lock' && event.state === 'unlocked' && isNight(event.ts, home?.preferences)) {
    return { ...base, kind: 'door_unlocked', severity: 'warning', message: `${room} door unlocked during night hours` };
  }
  if (type === 'door_contact' && event.state === 'open' && isNight(event.ts, home?.preferences)) {
    return { ...base, kind: 'intrusion', severity: 'warning', message: `${room} door opened during night hours` };
  }
  if (type === 'temperature' && (event.value >= 35 || event.value <= 5)) {
    return { ...base, kind: 'temperature', severity: 'warning', message: `Unusual temperature ${event.value}°C in ${room}` };
  }
  return null;
}
