// Initialise the three-member replica set "rs0".
// Run once against mongo1 through the localhost exception (no users exist yet).
const config = {
  _id: 'rs0',
  members: [
    { _id: 0, host: 'mongo1:27017', priority: 2 },
    { _id: 1, host: 'mongo2:27018', priority: 1 },
    { _id: 2, host: 'mongo3:27019', priority: 1 },
  ],
};

try {
  rs.status();
  print('Replica set already initialised');
} catch (e) {
  printjson(rs.initiate(config));
}

// Wait until this node has been elected primary so users can be created.
for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000);
print(`Primary: ${db.hello().primary}`);
