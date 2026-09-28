#!/usr/bin/env bash
# One-command setup: generates secrets, starts the 3-node replica set and the MQTT broker,
# initialises the cluster, users and schema, then starts the ingest service and API.
set -euo pipefail
cd "$(dirname "$0")/.."

rand() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24; }

if [[ ! -f .env ]]; then
  echo "==> Generating .env with random credentials"
  ROOT_PW=$(rand); INGEST_PW=$(rand); API_PW=$(rand); ANALYST_PW=$(rand)
  MQTT_INGEST_PW=$(rand); MQTT_GATEWAY_PW=$(rand); API_KEY=$(rand)
  HOSTS="mongo1:27017,mongo2:27018,mongo3:27019"
  cat > .env <<EOF
MONGO_ROOT_USER=admin
MONGO_ROOT_PASSWORD=$ROOT_PW
MONGO_INGEST_PASSWORD=$INGEST_PW
MONGO_API_PASSWORD=$API_PW
MONGO_ANALYST_PASSWORD=$ANALYST_PW
MONGO_URI_INGEST='mongodb://iothings_ingest:$INGEST_PW@$HOSTS/iothings?replicaSet=rs0&authSource=iothings'
MONGO_URI_API='mongodb://iothings_api:$API_PW@$HOSTS/iothings?replicaSet=rs0&authSource=iothings'
MONGO_DB=iothings
MQTT_URL=mqtt://mosquitto:1883
MQTT_INGEST_USER=ingest
MQTT_INGEST_PASSWORD=$MQTT_INGEST_PW
MQTT_GATEWAY_USER=gateway
MQTT_GATEWAY_PASSWORD=$MQTT_GATEWAY_PW
API_PORT=4000
API_KEY=$API_KEY
EOF
fi
set -a; source .env; set +a

if [[ ! -f docker/mongo/keyfile ]]; then
  echo "==> Generating replica set keyfile"
  openssl rand -base64 756 > docker/mongo/keyfile
fi
chmod 644 docker/mongo/keyfile   # readable for the copy step; each node re-permissions its copy

echo "==> Generating MQTT password file"
: > docker/mosquitto/passwd
docker run --rm -v "$PWD/docker/mosquitto:/m" eclipse-mosquitto:2 sh -c "
  mosquitto_passwd -b /m/passwd '$MQTT_INGEST_USER' '$MQTT_INGEST_PASSWORD' &&
  mosquitto_passwd -b /m/passwd '$MQTT_GATEWAY_USER' '$MQTT_GATEWAY_PASSWORD' &&
  chmod 644 /m/passwd"

echo "==> Starting MongoDB nodes and MQTT broker"
docker compose up -d mongo1 mongo2 mongo3 mosquitto

echo "==> Waiting for MongoDB nodes to become healthy"
for c in mongo1 mongo2 mongo3; do
  until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c")" == healthy ]]; do sleep 2; done
  echo "    $c healthy"
done

MONGO_ENV=(-e MONGO_ROOT_USER -e MONGO_ROOT_PASSWORD -e MONGO_INGEST_PASSWORD -e MONGO_API_PASSWORD -e MONGO_ANALYST_PASSWORD)

echo "==> Initialising replica set"
# Works without credentials on first run (localhost exception); authenticates on re-runs.
if ! docker exec mongo1 mongosh --quiet --port 27017 --file /scripts/01-init-replica-set.js 2>/dev/null; then
  docker exec mongo1 mongosh --quiet --port 27017 -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase admin --file /scripts/01-init-replica-set.js
fi

echo "==> Creating users"
docker exec "${MONGO_ENV[@]}" mongo1 mongosh --quiet --port 27017 --file /scripts/02-create-users.js

echo "==> Creating collections, validators and indexes"
docker exec "${MONGO_ENV[@]}" mongo1 mongosh --quiet --port 27017 --file /scripts/03-create-schema.js

echo "==> Building and starting ingest service and API"
docker compose up -d --build ingest api

echo
echo "Done. API:  http://localhost:${API_PORT}/docs   (x-api-key: see API_KEY in .env)"
echo "Seed data:  docker compose run --rm --user \"$(id -u):$(id -g)\" api node scripts/seed.js --reset --export"
echo "Live data:  docker compose --profile sim up -d simulator"
