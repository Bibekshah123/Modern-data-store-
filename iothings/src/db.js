import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;

// Writes are acknowledged by a majority of the replica set so an acknowledged
// sensor event survives the loss of the primary. Reads prefer the primary but
// fall back to a secondary during an election.
export async function connect() {
  if (client) return client.db(config.mongoDb);
  client = new MongoClient(config.mongoUri(), {
    writeConcern: { w: 'majority', wtimeoutMS: 5000 },
    readPreference: 'primaryPreferred',
    retryWrites: true,
    retryReads: true,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  return client.db(config.mongoDb);
}

export async function close() {
  await client?.close();
  client = undefined;
}

export function getClient() {
  return client;
}
