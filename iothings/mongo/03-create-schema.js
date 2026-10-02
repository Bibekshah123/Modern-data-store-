// Collections, JSON-schema validators and indexes for the sensors database.
const env = process.env;
db.getSiblingDB('admin').auth(env.MONGO_ROOT_USER, env.MONGO_ROOT_PASSWORD);
const iot = db.getSiblingDB('iothings');

const DEVICE_TYPES = [
  'door_lock', 'blind', 'light', 'light_switch', 'thermostat',
  'temperature', 'humidity', 'motion', 'door_contact', 'smoke_alarm', 'smart_plug',
];

function ensureCollection(name, options) {
  if (iot.getCollectionNames().includes(name)) {
    if (options.validator) iot.runCommand({ collMod: name, validator: options.validator, validationLevel: 'moderate' });
    print(`collection exists: ${name}`);
  } else {
    iot.createCollection(name, options);
    print(`created: ${name}`);
  }
}

// homes: one document per customer property. customerRef links to the existing CRM.
ensureCollection('homes', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['homeId', 'customerRef', 'address', 'rooms', 'createdAt'],
      properties: {
        homeId: { bsonType: 'string', pattern: '^H[0-9]{3,}$' },
        customerRef: { bsonType: 'string', description: 'customer id in the CRM system' },
        name: { bsonType: 'string' },
        address: {
          bsonType: 'object',
          required: ['city', 'postcode'],
          properties: { line1: { bsonType: 'string' }, city: { bsonType: 'string' }, postcode: { bsonType: 'string' } },
        },
        rooms: { bsonType: 'array', items: { bsonType: 'string' } },
        preferences: {
          bsonType: 'object',
          properties: {
            targetTemperature: { bsonType: ['double', 'int'], minimum: 10, maximum: 30 },
            nightStart: { bsonType: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
            nightEnd: { bsonType: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
            notifyContacts: { bsonType: 'array', items: { bsonType: 'string' } },
          },
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});

// devices: installed sensors and actuators. lastState is a denormalised copy of the latest reading.
ensureCollection('devices', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['deviceId', 'homeId', 'type', 'room', 'installedAt'],
      properties: {
        deviceId: { bsonType: 'string' },
        homeId: { bsonType: 'string' },
        type: { enum: DEVICE_TYPES },
        room: { bsonType: 'string' },
        manufacturer: { bsonType: 'string' },
        model: { bsonType: 'string' },
        firmware: { bsonType: 'string' },
        status: { enum: ['active', 'inactive', 'faulty'] },
        installedAt: { bsonType: 'date' },
        lastSeen: { bsonType: 'date' },
        lastState: { bsonType: 'object' },
      },
    },
  },
});

// sensor_events: time-series collection holding every MQTT activation message.
// Data expires after two years (UK GDPR storage limitation). 'minutes' granularity (buckets of
// up to 24 h per device) was chosen by measurement - see mongo/benchmark-granularity.js.
ensureCollection('sensor_events', {
  timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'minutes' },
  expireAfterSeconds: 60 * 60 * 24 * 730,
});

// alerts: safety notifications (smoke, door left unlocked, intrusion).
ensureCollection('alerts', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['homeId', 'deviceId', 'kind', 'severity', 'ts', 'acknowledged'],
      properties: {
        homeId: { bsonType: 'string' },
        deviceId: { bsonType: 'string' },
        kind: { enum: ['smoke', 'intrusion', 'door_unlocked', 'door_opened', 'temperature', 'device_offline'] },
        severity: { enum: ['info', 'warning', 'critical'] },
        message: { bsonType: 'string' },
        ts: { bsonType: 'date' },
        acknowledged: { bsonType: 'bool' },
        acknowledgedAt: { bsonType: 'date' },
      },
    },
  },
});

iot.homes.createIndex({ homeId: 1 }, { unique: true });
iot.homes.createIndex({ customerRef: 1 });
iot.homes.createIndex({ 'address.postcode': 1 });

iot.devices.createIndex({ deviceId: 1 }, { unique: true });
iot.devices.createIndex({ homeId: 1, type: 1 });

iot.sensor_events.createIndex({ 'meta.homeId': 1, ts: -1 });
iot.sensor_events.createIndex({ 'meta.deviceId': 1, ts: -1 });
iot.sensor_events.createIndex({ 'meta.type': 1, ts: -1 });

iot.alerts.createIndex({ homeId: 1, acknowledged: 1, ts: -1 });
iot.alerts.createIndex({ severity: 1, ts: -1 });

print('schema ready');
