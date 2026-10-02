import express from 'express';
import { readFile } from 'node:fs/promises';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { config } from '../config.js';
import { connect, close } from '../db.js';
import { errorHandler, notFound, requireApiKey } from './middleware.js';
import homesRouter from './routes/homes.js';
import devicesRouter from './routes/devices.js';
import eventsRouter from './routes/events.js';
import alertsRouter from './routes/alerts.js';
import analyticsRouter from './routes/analytics.js';
import clusterRouter from './routes/cluster.js';
import simulateRouter from './routes/simulate.js';
import roomsRouter from './routes/rooms.js';
import { closeMqtt } from './mqtt.js';

const db = await connect();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

const spec = YAML.parse(await readFile(new URL('../../openapi.yaml', import.meta.url), 'utf8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
app.get('/openapi.json', (req, res) => res.json(spec));

app.get('/health', async (req, res) => {
  try {
    const hello = await db.command({ hello: 1 });
    res.json({ status: 'ok', replicaSet: hello.setName, primary: hello.primary });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: err.message });
  }
});

const api = express.Router();
api.use(requireApiKey);
api.use('/homes', homesRouter(db));
api.use('/devices', devicesRouter(db));
api.use('/events', eventsRouter(db));
api.use('/alerts', alertsRouter(db));
api.use('/analytics', analyticsRouter(db));
api.use('/cluster', clusterRouter(db));
api.use('/simulate', simulateRouter(db));
api.use('/rooms', roomsRouter(db));
app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.apiPort, () => console.log(`IoThings API listening on :${config.apiPort}`));

async function shutdown() {
  server.close();
  await closeMqtt();
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
