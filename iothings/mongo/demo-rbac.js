// Run as the analyst user: reads succeed, writes are refused.
//   scripts/mongosh.sh analyst mongo/demo-rbac.js
const iot = db.getSiblingDB('iothings');
print(`connected as: ${JSON.stringify(db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUsers)}`);
print(`read homes: ${iot.homes.countDocuments()} documents`);
try {
  iot.homes.deleteMany({});
  print('delete succeeded (unexpected)');
} catch (e) {
  print(`delete refused: ${e.codeName} - ${e.message}`);
}
