const env = process.env;

function required(name) {
  if (!env[name]) throw new Error(`Missing environment variable ${name}`);
  return env[name];
}

export const config = {
  mongoUri: () => required('MONGO_URI'),
  mongoDb: env.MONGO_DB || 'iothings',
  mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
  mqttIngest: { username: env.MQTT_INGEST_USER, password: env.MQTT_INGEST_PASSWORD },
  mqttGateway: { username: env.MQTT_GATEWAY_USER, password: env.MQTT_GATEWAY_PASSWORD },
  apiPort: Number(env.PORT || 4000),
  apiKey: env.API_KEY,
  // ingest batching: flush when either limit is reached
  batchSize: Number(env.INGEST_BATCH_SIZE || 500),
  batchIntervalMs: Number(env.INGEST_BATCH_INTERVAL_MS || 1000),
};
