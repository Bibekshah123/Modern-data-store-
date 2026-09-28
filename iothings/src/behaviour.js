// Synthetic household behaviour model used to build the sensor-activation dataset.
// IoThings' real data is protected by UK GDPR, so we generate realistic daily routines
// (wake-up, leaving for work, returning, cooking, bedtime) with a deterministic RNG so
// the dataset is reproducible.

export const ROOM_LAYOUT = {
  hallway: ['door_lock', 'door_contact', 'motion', 'light', 'smoke_alarm'],
  living_room: ['light', 'blind', 'motion', 'temperature', 'thermostat', 'smart_plug'],
  kitchen: ['light', 'motion', 'smoke_alarm', 'smart_plug', 'temperature'],
  bedroom: ['light', 'blind', 'motion', 'temperature', 'humidity'],
  bathroom: ['light', 'motion', 'humidity'],
};

const MANUFACTURERS = {
  door_lock: ['Yale', 'Nuki'], door_contact: ['Aqara', 'Philips Hue'], motion: ['Philips Hue', 'Aqara'],
  light: ['Philips Hue', 'LIFX'], smoke_alarm: ['Nest', 'FireAngel'], blind: ['Somfy', 'IKEA'],
  temperature: ['Aqara', 'Netatmo'], thermostat: ['Nest', 'Hive'], smart_plug: ['TP-Link', 'Meross'],
  humidity: ['Aqara', 'Netatmo'], light_switch: ['Philips Hue'],
};

const CITIES = [
  ['Birmingham', 'B'], ['Manchester', 'M'], ['Leeds', 'LS'], ['London', 'SW'], ['Bristol', 'BS'],
  ['Coventry', 'CV'], ['Nottingham', 'NG'], ['Sheffield', 'S'], ['Liverpool', 'L'], ['Leicester', 'LE'],
];
const STREETS = ['High Street', 'Station Road', 'Church Lane', 'Park Avenue', 'Victoria Road', 'Mill Lane'];

// mulberry32: tiny seedable PRNG
export function rng(seed) {
  let a = typeof seed === 'string' ? [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261) : seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function buildHome(n, installedAt) {
  const r = rng(`home-${n}`);
  const homeId = `H${String(n).padStart(3, '0')}`;
  const [city, pc] = r.pick(CITIES);
  const home = {
    homeId,
    customerRef: `CRM-${10000 + n}`,
    name: `${city} home ${n}`,
    address: {
      line1: `${r.int(1, 220)} ${r.pick(STREETS)}`,
      city,
      postcode: `${pc}${r.int(1, 30)} ${r.int(1, 9)}${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}`,
    },
    rooms: Object.keys(ROOM_LAYOUT),
    preferences: {
      targetTemperature: r.pick([19, 20, 20.5, 21, 22]),
      nightStart: r.pick(['22:30', '23:00', '23:30']),
      nightEnd: r.pick(['06:00', '06:30']),
      notifyContacts: [`owner${n}@example.com`],
    },
    // behaviour profile: shift workers, remote workers and commuters behave differently
    profile: r.pick(['commuter', 'commuter', 'remote', 'shift']),
    createdAt: installedAt,
  };
  const devices = [];
  for (const [room, types] of Object.entries(ROOM_LAYOUT)) {
    for (const type of types) {
      devices.push({
        deviceId: `${homeId}-${room}-${type}`.replace(/_/g, '-'),
        homeId,
        type,
        room,
        manufacturer: r.pick(MANUFACTURERS[type]),
        model: `${type.toUpperCase().slice(0, 3)}-${r.int(100, 999)}`,
        firmware: `${r.int(1, 4)}.${r.int(0, 9)}.${r.int(0, 20)}`,
        status: 'active',
        installedAt,
      });
    }
  }
  return { home, devices };
}

// Minutes that UK local time is ahead of UTC on a given day (0 in winter, 60 in BST).
function ukOffsetMinutes(day) {
  const noon = new Date(day.getTime() + 12 * 3_600_000);
  const ukHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(noon));
  return (ukHour - 12) * 60;
}

// Generates one day of events for a home. `day` is midnight (UTC) of that date; all
// routine times below are minutes after midnight UK local time.
// Returns [{ deviceId, payload }] sorted by timestamp.
export function generateDay(home, devices, day) {
  const r = rng(`${home.homeId}-${day.toISOString().slice(0, 10)}`);
  const dev = (room, type) => devices.find((d) => d.room === room && d.type === type);
  const out = [];
  const offset = ukOffsetMinutes(day);
  const at = (minutes) => new Date(day.getTime() + Math.round((minutes - offset) * 60_000));
  const emit = (room, type, minutes, payload) => {
    const d = dev(room, type);
    if (d && minutes >= 0 && minutes < 1440) out.push({ deviceId: d.deviceId, payload: { ...payload, ts: at(minutes).toISOString() } });
  };
  const presence = (room, start, end, withLight) => {
    emit(room, 'motion', start, { state: 'detected' });
    if (withLight) emit(room, 'light', start + 0.2, { state: 'on', value: r.int(60, 100) });
    for (let t = start + r.between(3, 8); t < end; t += r.between(4, 12)) emit(room, 'motion', t, { state: 'detected' });
    emit(room, 'motion', end + 1, { state: 'clear' });
    if (withLight) emit(room, 'light', end + 1.5, { state: 'off', value: 0 });
  };

  const weekend = [0, 6].includes(day.getUTCDay());
  const profile = home.profile || 'commuter';
  const wake = (weekend ? r.between(480, 570) : profile === 'shift' ? r.between(600, 690) : r.between(375, 450));
  const bed = r.between(1350, 1420);
  const away = profile === 'commuter' && !weekend;
  const leave = wake + r.between(50, 80);
  const back = away ? r.between(1020, 1110) : null;
  const dark = (m) => m < 450 || m > 1110; // simple approximation of UK daylight

  // Wake-up routine
  emit('living_room', 'thermostat', wake - 30, { state: 'heating', value: home.preferences.targetTemperature });
  presence('bedroom', wake, wake + r.between(5, 15), dark(wake));
  emit('bedroom', 'blind', wake + 2, { value: 100 });
  presence('bathroom', wake + 15, wake + r.between(25, 40), true);
  presence('kitchen', wake + 40, wake + r.between(55, 70), dark(wake));
  emit('kitchen', 'smart_plug', wake + 42, { state: 'on', value: r.int(1800, 2400) }); // kettle
  emit('kitchen', 'smart_plug', wake + 46, { state: 'off', value: 0 });
  emit('living_room', 'blind', wake + 45, { value: 100 });

  const leaveHome = (m) => {
    presence('hallway', m - 3, m, false);
    emit('hallway', 'door_lock', m - 1, { state: 'unlocked' });
    emit('hallway', 'door_contact', m - 0.8, { state: 'open' });
    emit('hallway', 'door_contact', m - 0.5, { state: 'closed' });
    emit('hallway', 'door_lock', m, { state: 'locked' });
  };
  const arriveHome = (m) => {
    emit('hallway', 'door_lock', m, { state: 'unlocked' });
    emit('hallway', 'door_contact', m + 0.2, { state: 'open' });
    emit('hallway', 'door_contact', m + 0.5, { state: 'closed' });
    emit('hallway', 'door_lock', m + 1, { state: 'locked' });
    presence('hallway', m, m + 3, dark(m));
  };

  if (away) {
    leaveHome(leave);
    emit('living_room', 'thermostat', leave + 5, { state: 'idle', value: 16 });
    arriveHome(back);
    emit('living_room', 'thermostat', back - 30, { state: 'heating', value: home.preferences.targetTemperature });
  } else {
    // at home during the day: periodic living-room activity and an afternoon walk
    presence('living_room', wake + 75, wake + r.between(180, 240), false);
    if (r.chance(0.6)) {
      const walk = r.between(780, 900);
      leaveHome(walk);
      arriveHome(walk + r.between(30, 90));
    }
  }

  // Evening: cooking, TV, bedtime
  const dinner = Math.max(back ?? 0, r.between(1060, 1140));
  presence('kitchen', dinner, dinner + r.between(30, 50), true);
  if (r.chance(0.03)) emit('kitchen', 'smoke_alarm', dinner + 20, { state: 'smoke' }); // burnt dinner
  if (r.chance(0.03)) emit('kitchen', 'smoke_alarm', dinner + 26, { state: 'clear' });
  const tvStart = dinner + r.between(50, 70);
  presence('living_room', tvStart, bed - 10, true);
  emit('living_room', 'smart_plug', tvStart, { state: 'on', value: r.int(80, 180) }); // TV
  emit('living_room', 'smart_plug', bed - 10, { state: 'off', value: 0 });
  emit('living_room', 'blind', r.between(1100, 1150), { value: 0 });
  emit('bedroom', 'blind', r.between(1100, 1150), { value: 0 });
  emit('living_room', 'thermostat', bed - 20, { state: 'idle', value: 16 });
  presence('bathroom', bed - 8, bed - 2, true);
  presence('bedroom', bed, bed + r.between(5, 15), true);
  emit('hallway', 'door_lock', bed - 5, { state: 'locked' });

  // Occasional late-night door use (raises night-time alerts)
  if (r.chance(0.04)) {
    const late = r.between(0, 240);
    emit('hallway', 'door_lock', late, { state: 'unlocked' });
    emit('hallway', 'door_contact', late + 0.3, { state: 'open' });
    emit('hallway', 'door_contact', late + 1, { state: 'closed' });
    emit('hallway', 'door_lock', late + 1.5, { state: 'locked' });
  }
  // Monthly smoke alarm test on the 1st
  if (day.getUTCDate() === 1) {
    for (const room of ['hallway', 'kitchen']) {
      emit(room, 'smoke_alarm', 600, { state: 'test', battery: r.int(40, 100) });
      emit(room, 'smoke_alarm', 601, { state: 'clear', battery: r.int(40, 100) });
    }
  }

  // Environmental sensors: temperature every 15 min, humidity every 30 min
  const heating = out
    .filter((e) => devices.find((d) => d.deviceId === e.deviceId)?.type === 'thermostat')
    .map((e) => ({ t: (Date.parse(e.payload.ts) - day.getTime()) / 60_000 + offset, on: e.payload.state === 'heating' }));
  const heatingAt = (m) => heating.filter((h) => h.t <= m).at(-1)?.on ?? false;
  let indoor = r.between(15.5, 17.5);
  for (let m = 0; m < 1440; m += 15) {
    const target = heatingAt(m) ? home.preferences.targetTemperature : 15.5;
    indoor += (target - indoor) * 0.12 + r.between(-0.15, 0.15);
    const t = Math.round(indoor * 10) / 10;
    emit('living_room', 'temperature', m + r.between(0, 1), { value: t });
    emit('bedroom', 'temperature', m + r.between(0, 1), { value: Math.round((t - 0.8) * 10) / 10 });
    emit('kitchen', 'temperature', m + r.between(0, 1), {
      value: Math.round((t + (m > dinner && m < dinner + 60 ? 2.5 : 0.3)) * 10) / 10,
    });
  }
  for (let m = 0; m < 1440; m += 30) {
    const shower = m >= wake + 15 && m <= wake + 60;
    emit('bathroom', 'humidity', m + r.between(0, 1), { value: Math.round(r.between(shower ? 75 : 50, shower ? 90 : 62)) });
    emit('bedroom', 'humidity', m + r.between(0, 1), { value: Math.round(r.between(42, 55)) });
  }

  return out.sort((a, b) => a.payload.ts.localeCompare(b.payload.ts));
}
