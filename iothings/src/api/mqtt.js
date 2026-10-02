import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

let connecting;

// The API publishes MQTT messages the way a home's sensor gateway would. This is used by the
// /simulate test endpoints and by device commands. Connects on first use.
export function mqttClient() {
  connecting ??= new Promise((resolve, reject) => {
    const client = mqtt.connect(config.mqttUrl, { ...config.mqttGateway, clientId: `iothings-api-${randomUUID().slice(0, 8)}` });
    client.once('connect', () => resolve(client));
    client.once('error', (err) => {
      connecting = undefined;
      client.end(true);
      reject(err);
    });
  });
  return connecting;
}

export async function publish(topic, payload) {
  const client = await mqttClient();
  await client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
}

export async function closeMqtt() {
  if (connecting) (await connecting.catch(() => null))?.end();
}
