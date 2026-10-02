#!/usr/bin/env bash
# Demonstrates high availability: stop the primary, watch an election, keep writing,
# then bring the old primary back and watch it rejoin and resync.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
API="http://localhost:${API_PORT:-4000}"

members() {
  curl -s -H "x-api-key: $API_KEY" "$API/api/v1/cluster/status" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const m of JSON.parse(s).members)console.log(`    ${m.name.padEnd(14)} ${m.state.padEnd(24)} health=${m.health}`)}catch{console.log("    (status unavailable)")}})'
}
door_test() {
  # A person opens H001's front door: the event, the alert and the light change are all written to the cluster.
  curl -s -H "x-api-key: $API_KEY" -H 'content-type: application/json' -d '{"homeId":"H001"}' "$API/api/v1/simulate/door" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);console.log(`    door opened -> alert saved: ${r.alertRaised}, light switched on: ${r.lightTurnedOn}`)}catch{console.log("    request failed: "+s)}})'
}
primary() { curl -s "$API/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).primary))'; }

echo "1. Current replica set"; members
PRIMARY=$(primary | cut -d: -f1)
echo; echo "2. Simulating a crash of the primary: docker kill $PRIMARY"; docker kill "$PRIMARY" >/dev/null

echo; echo "3. Waiting for the remaining members to elect a new primary"
start=$(date +%s)
until [[ "$(primary 2>/dev/null)" != "" && "$(primary | cut -d: -f1)" != "$PRIMARY" ]]; do sleep 1; done
echo "    new primary $(primary) elected after $(( $(date +%s) - start ))s"; members

echo; echo "4. Writes still succeed with one node down (w: majority = 2 of 3)"
door_test

echo; echo "5. Restarting $PRIMARY - it rejoins as SECONDARY and catches up from the oplog"
docker start "$PRIMARY" >/dev/null
sleep 5; members
echo; echo "6. mongo1 has priority 2, so once it has caught up it is re-elected primary"
sleep 15; members
