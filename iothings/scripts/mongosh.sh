#!/usr/bin/env bash
# Open mongosh against the replica set as one of the configured users.
#   scripts/mongosh.sh [admin|api|ingest|analyst] [script.js]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

case "${1:-admin}" in
  admin)   USER=$MONGO_ROOT_USER;   PW=$MONGO_ROOT_PASSWORD;   AUTHDB=admin ;;
  api)     USER=iothings_api;       PW=$MONGO_API_PASSWORD;     AUTHDB=iothings ;;
  ingest)  USER=iothings_ingest;    PW=$MONGO_INGEST_PASSWORD;  AUTHDB=iothings ;;
  analyst) USER=iothings_analyst;   PW=$MONGO_ANALYST_PASSWORD; AUTHDB=iothings ;;
  *) echo "unknown user $1"; exit 1 ;;
esac

URI="mongodb://mongo1:27017,mongo2:27018,mongo3:27019/iothings?replicaSet=rs0&authSource=$AUTHDB"
ARGS=(mongosh "$URI" -u "$USER" -p "$PW" --quiet)
if [[ -n "${2:-}" ]]; then
  # scripts under mongo/ are mounted at /scripts inside the containers
  ARGS+=(--file "/scripts/$(basename "$2")")
  docker exec mongo2 "${ARGS[@]}"
else
  docker exec -it mongo2 "${ARGS[@]}"
fi
