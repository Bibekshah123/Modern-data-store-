// Role-based access control: one administrator plus a least-privilege user per service.
// Passwords are passed in as environment variables by scripts/setup.sh.
const env = process.env;

const admin = db.getSiblingDB('admin');
try {
  admin.auth(env.MONGO_ROOT_USER, env.MONGO_ROOT_PASSWORD);
} catch {
  // First run: the localhost exception only permits creating the first user.
  admin.createUser({ user: env.MONGO_ROOT_USER, pwd: env.MONGO_ROOT_PASSWORD, roles: ['root'] });
  admin.auth(env.MONGO_ROOT_USER, env.MONGO_ROOT_PASSWORD);
  print(`created ${env.MONGO_ROOT_USER}`);
}

const app = db.getSiblingDB('iothings');
const users = [
  // MQTT ingest service: writes sensor events and alerts only
  { user: 'iothings_ingest', pwd: env.MONGO_INGEST_PASSWORD, roles: [{ role: 'readWrite', db: 'iothings' }] },
  // REST API: CRUD on the database plus read-only cluster monitoring for /cluster/status
  {
    user: 'iothings_api',
    pwd: env.MONGO_API_PASSWORD,
    roles: [{ role: 'readWrite', db: 'iothings' }, { role: 'clusterMonitor', db: 'admin' }],
  },
  // Data analysts: read-only
  { user: 'iothings_analyst', pwd: env.MONGO_ANALYST_PASSWORD, roles: [{ role: 'read', db: 'iothings' }] },
];

for (const u of users) {
  if (app.getUser(u.user)) app.updateUser(u.user, { pwd: u.pwd, roles: u.roles });
  else app.createUser(u);
  print(`user ready: ${u.user}`);
}
