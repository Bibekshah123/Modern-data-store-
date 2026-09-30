# IoThings Sensors Platform

A NoSQL sensor-activation data store for **IoThings Home Automation Solutions**, a UK start-up that installs smart home sensors (door locks, lights, blinds, thermostats, smoke alarms and more).

Each sensor reports its activity over **MQTT**. A **Node.js** service validates the messages and stores them in a **three-node MongoDB replica set**. A **REST API** gives access to the stored data and processes it into useful feedback: device usage, energy use, daily routines, comfort recommendations and safety alerts.

---

## Contents

1. [Features](#1-features)
2. [Architecture](#2-architecture)
3. [How it works](#3-how-it-works)
4. [Prerequisites](#4-prerequisites)
5. [Installation and first run](#5-installation-and-first-run)
6. [Starting, stopping and resetting](#6-starting-stopping-and-resetting)
7. [Using the REST API](#7-using-the-rest-api)
8. [Sending sensor data over MQTT](#8-sending-sensor-data-over-mqtt)
9. [Working with MongoDB directly](#9-working-with-mongodb-directly)
10. [Demonstrations](#10-demonstrations)
11. [Data model](#11-data-model)
12. [Security](#12-security)
13. [Test dataset](#13-test-dataset)
14. [Configuration (.env)](#14-configuration-env)
15. [Running the Node.js code outside Docker](#15-running-the-nodejs-code-outside-docker)
16. [Tests](#16-tests)
17. [Troubleshooting](#17-troubleshooting)
18. [Project structure](#18-project-structure)
19. [Future work](#19-future-work)

---

## 1. Features

| Area | What is included |
|---|---|
| Distributed database | MongoDB 7 replica set `rs0` with 3 members. Majority write concern and automatic failover. |
| Security | Keyfile authentication between members. Role-based users: admin, ingest, api and a read-only analyst. MQTT requires a password. The API requires an API key. |
| Schema | JSON-schema validation, unique and compound indexes, a **time-series** collection for events, and a 2-year TTL for UK GDPR. |
| MQTT ingest | Checks each message against the device registry and payload rules, raises safety alerts, publishes notifications and writes events in batches. |
| REST API | Create/read/update/delete for homes, devices, events and alerts, plus analytics endpoints. Swagger/OpenAPI documentation is at `/docs`. |
| Analytics | Device usage and hours on, smart-plug energy (kWh), activity by hour, predicted daily routine, climate per room, recommendations, and an estate-wide overview. |
| Dataset | A reproducible synthetic dataset: 20 homes, 480 devices and about 290k events over 30 days. There is also a live MQTT simulator. |
| Demos | Scripts for create/read/update/delete, access control and failover, with output suitable for report screenshots. |

---

## 2. Architecture

```
                  MQTT topic: iothings/<homeId>/<deviceId>/state
 ┌──────────────┐        ┌────────────┐        ┌──────────────────┐
 │   Sensors /  │──────▶│ Mosquitto  │──────▶│  Ingest service  │
 │  simulator   │        │ MQTT broker│        │  (src/ingest.js) │
 └──────────────┘        └────────────┘        └────────┬─────────┘
        ▲                      ▲                         │ insertMany (w: majority)
        │  iothings/<homeId>/notifications (alerts)      ▼
        └──────────────────────┘          ┌──────────────────────────────┐
                                          │   MongoDB replica set rs0    │
 ┌──────────────┐   HTTP + x-api-key      │  mongo1:27017  PRIMARY (p=2) │
 │ Web / mobile │──────▶┌────────────┐──▶│  mongo2:27018  SECONDARY     │
 │   clients    │        │  REST API  │    │  mongo3:27019  SECONDARY     │
 └──────────────┘        │ :4000/docs │    └──────────────────────────────┘
                         └────────────┘
```

Every component runs in Docker and is defined in `docker-compose.yml`:

| Service | Container | Host port | Role |
|---|---|---|---|
| `mongo1` | mongo1 | 27017 | Replica set member (preferred primary, priority 2) |
| `mongo2` | mongo2 | 27018 | Replica set member |
| `mongo3` | mongo3 | 27019 | Replica set member |
| `mosquitto` | mosquitto | 1883 | MQTT broker |
| `ingest` | iothings-ingest | none | Moves data from MQTT into MongoDB |
| `api` | iothings-api | 4000 | REST API and Swagger UI |
| `simulator` | iothings-simulator | none | Sensor gateway simulator (the `sim` profile; only runs on demand) |

---

## 3. How it works

### 3.1 A sensor event, step by step

1. **A device publishes** a JSON message, for example the kitchen light turning on:
   ```
   topic:   iothings/H001/H001-kitchen-light/state
   payload: {"state": "on", "value": 80, "ts": "2026-09-28T18:02:11Z"}
   ```
   `ts` is optional. If it is missing, the time of receipt is used.
2. **Mosquitto** accepts the message only from an authenticated client, the `gateway` user.
3. **The ingest service** is subscribed to `iothings/+/+/state` with QoS 1 and a persistent session, so the broker queues messages while the service is down. For each message it:
   - checks the topic format
   - looks the device up in `devices` (cached for 60 s) and rejects unknown devices or a mismatched home
   - validates the payload against the device type: allowed states, value range and battery level (`src/devices.js`)
   - turns the message into a `sensor_events` document
   - checks the **safety rules**:
     - smoke leads to a *critical* alert
     - a door unlocked or opened during the owner's night hours (UK time) leads to a *warning*
     - a temperature of 35 °C or more, or 5 °C or less, leads to a *warning*

     Each alert is saved in `alerts` and published to `iothings/<homeId>/notifications`.
   - buffers events and writes them with `insertMany` every **1 s or 500 events**, whichever comes first. It then updates each device's `lastState` and `lastSeen`.
4. **MongoDB** saves the batch on the primary and copies it to the secondaries. A write is only acknowledged once a **majority (2 of 3)** of members have it, so acknowledged data survives the loss of any one server.
5. **The REST API** reads and processes the data with aggregation pipelines, for example grouping motion events by hour to find when a home is occupied.

### 3.2 High availability

- If the primary fails, the two remaining members **elect a new primary**, typically in about 10 seconds.
- The Node.js driver finds the new primary itself (`retryWrites` and `retryReads`), so the ingest service and the API keep working.
- When the failed server returns, it rejoins as a secondary and **catches up** from the operation log (oplog). `mongo1` has priority 2, so it takes the primary role back once it is up to date.

### 3.3 Where the data comes from

IoThings cannot share real customer data because of UK GDPR. `src/behaviour.js` therefore models realistic household routines instead: waking up, leaving for work, cooking, watching TV, bedtime, heating and humidity after showers. The **seed script** uses the model to produce 30 days of history, and the **simulator** replays today's routine over MQTT.

---

## 4. Prerequisites

| Requirement | Notes |
|---|---|
| Docker Engine with **Docker Compose v2** | Check with `docker compose version` |
| `openssl` | Used to generate passwords and the replica set keyfile |
| `curl` | Optional, for trying the API from the terminal |
| Node.js 20 or later with npm | Optional. Only needed to run the unit tests or the code outside Docker |
| Free ports | 27017, 27018, 27019, 1883 and 4000 |

The project was tested on Linux (Ubuntu). It also works on macOS and on Windows with WSL2 and Docker Desktop.

---

## 5. Installation and first run

```bash
cd iothings

# 1. Generate secrets, start the cluster, create users and schema, start ingest + API
./scripts/setup.sh

# 2. Load the test dataset (20 homes, 30 days) and export sample files to data/
docker compose run --rm --user "$(id -u):$(id -g)" api node scripts/seed.js --reset --export

# 3. Check that it works
curl localhost:4000/health
# {"status":"ok","replicaSet":"rs0","primary":"mongo1:27017"}
```

Then open **http://localhost:4000/docs**.

### What `setup.sh` does

1. Creates `.env` with random passwords and an API key. This only happens if `.env` does not exist yet.
2. Creates `docker/mongo/keyfile`, the shared secret between replica set members.
3. Creates `docker/mosquitto/passwd` with the MQTT users `ingest` and `gateway`.
4. Starts `mongo1`, `mongo2`, `mongo3` and `mosquitto`, then waits until they are healthy.
5. Runs `mongo/01-init-replica-set.js`, which calls `rs.initiate()` with the three members.
6. Runs `mongo/02-create-users.js`, which creates the admin and application users.
7. Runs `mongo/03-create-schema.js`, which creates the collections, validators and indexes.
8. Builds and starts the `ingest` and `api` containers.

The script is safe to run again. It reuses the existing `.env` and skips anything that has already been done.

---

## 6. Starting, stopping and resetting

```bash
docker compose ps                     # status of all containers
docker compose logs -f ingest         # follow the ingest log (statistics every 30 s)
docker compose logs -f api            # follow the API log

docker compose stop                   # stop containers, keep everything
docker compose up -d mongo1 mongo2 mongo3 mosquitto ingest api   # start again

docker compose down                   # remove containers; data stays in Docker volumes
docker compose down -v                # remove containers AND all database data
```

After `down -v`, run `./scripts/setup.sh` and the seed command again.

**Reload the dataset** without rebuilding anything:

```bash
docker compose run --rm --user "$(id -u):$(id -g)" api node scripts/seed.js --reset --export
```

| Seed option | Default | Meaning |
|---|---|---|
| `--homes N` | 20 | Number of homes to create |
| `--days N` | 30 | Days of history, ending yesterday |
| `--reset` | off | Empty all collections first |
| `--export` | off | Write sample files to `data/` |

**After changing any code** in `src/`, rebuild:

```bash
docker compose up -d --build ingest api
```

---

## 7. Using the REST API

### 7.1 Authentication

Every `/api/v1/...` request needs the API key in the `x-api-key` header. You can find the key in `.env`:

```bash
grep API_KEY .env
```

`/health`, `/docs` and `/openapi.json` are public.

### 7.2 Swagger UI (recommended)

1. Open **http://localhost:4000/docs**.
2. Click **Authorize**, paste the API key, then click **Authorize** again and **Close**.
3. Expand an endpoint, click **Try it out**, fill in the parameters and click **Execute**.

### 7.3 curl examples

```bash
K=$(grep ^API_KEY .env | cut -d= -f2)
H="x-api-key: $K"

# Homes
curl -H "$H" localhost:4000/api/v1/homes
curl -H "$H" localhost:4000/api/v1/homes/H001                    # the home plus all its devices

# Devices
curl -H "$H" "localhost:4000/api/v1/devices?homeId=H001&type=light"
curl -H "$H" localhost:4000/api/v1/devices/H001-hallway-door-lock

# Events (homeId or deviceId required; default window is the last 7 days)
curl -H "$H" "localhost:4000/api/v1/events?homeId=H001&type=door_lock&limit=5"
curl -H "$H" "localhost:4000/api/v1/events?deviceId=H001-kitchen-temperature&from=2026-09-20&to=2026-09-21"

# Alerts
curl -H "$H" "localhost:4000/api/v1/alerts?severity=critical&acknowledged=false"
curl -H "$H" -X POST localhost:4000/api/v1/alerts/<alertId>/acknowledge

# Analytics
curl -H "$H" localhost:4000/api/v1/analytics/overview
curl -H "$H" localhost:4000/api/v1/analytics/homes/H001/usage
curl -H "$H" localhost:4000/api/v1/analytics/homes/H001/activity-by-hour
curl -H "$H" localhost:4000/api/v1/analytics/homes/H005/routine
curl -H "$H" localhost:4000/api/v1/analytics/homes/H001/climate
curl -H "$H" localhost:4000/api/v1/analytics/homes/H003/recommendations

# Cluster
curl -H "$H" localhost:4000/api/v1/cluster/status
```

Create, update and delete (a full lifecycle):

```bash
J="content-type: application/json"
curl -H "$H" -H "$J" -d '{"homeId":"H950","customerRef":"CRM-99","address":{"city":"Leeds","postcode":"LS1 1AA"},"rooms":["kitchen"]}' localhost:4000/api/v1/homes
curl -H "$H" -H "$J" -d '{"deviceId":"H950-kitchen-light","homeId":"H950","type":"light","room":"kitchen"}' localhost:4000/api/v1/devices
curl -H "$H" -H "$J" -d '{"deviceId":"H950-kitchen-light","state":"on","value":80}' localhost:4000/api/v1/events
curl -H "$H" -H "$J" -X PATCH -d '{"preferences":{"targetTemperature":20}}' localhost:4000/api/v1/homes/H950
curl -H "$H" -X DELETE localhost:4000/api/v1/homes/H950     # removes the home, its devices, events and alerts
```

### 7.4 Endpoint reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | API and database status, and the current primary |
| GET | `/api/v1/cluster/status` | Each replica set member's state, health and replication time |
| GET, POST | `/api/v1/homes` | List homes (filters: `city`, `customerRef`) or create a home |
| GET, PATCH, DELETE | `/api/v1/homes/{homeId}` | Get a home with its devices, update it, or delete it together with all of its data |
| GET, POST | `/api/v1/devices` | List devices (filters: `homeId`, `type`, `room`, `status`) or register a device |
| GET, PATCH, DELETE | `/api/v1/devices/{deviceId}` | Get a device with its latest state, update it or delete it |
| GET, POST | `/api/v1/events` | Query events (`homeId`, `deviceId`, `type`, `room`, `from`, `to`, `limit`), or submit an event over HTTP |
| GET | `/api/v1/alerts` | List alerts (filters: `homeId`, `kind`, `severity`, `acknowledged`) |
| POST | `/api/v1/alerts/{id}/acknowledge` | Acknowledge an alert |
| GET | `/api/v1/analytics/overview` | Events per day and per type, device status and alert totals |
| GET | `/api/v1/analytics/homes/{id}/usage` | Activations, hours on and kWh for each device |
| GET | `/api/v1/analytics/homes/{id}/activity-by-hour` | Motion by hour of day and room (occupancy pattern) |
| GET | `/api/v1/analytics/homes/{id}/routine` | Median wake-up, leave and return times, for weekdays and weekends |
| GET | `/api/v1/analytics/homes/{id}/climate` | Daily average, minimum and maximum temperature and humidity per room |
| GET | `/api/v1/analytics/homes/{id}/recommendations` | Energy, comfort and safety tips |

### 7.5 Status codes

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | Success, created, or deleted |
| 400 | Invalid input, or the document failed MongoDB schema validation (details are included) |
| 401 | Missing or wrong `x-api-key` |
| 404 | The resource was not found |
| 409 | Duplicate `homeId` or `deviceId` |
| 503 | The database is unavailable (from `/health`) |

---

## 8. Sending sensor data over MQTT

### 8.1 The simulator

```bash
# Replay today's activity for every home (from midnight to now at 600x speed, then real time)
docker compose --profile sim run --rm simulator node src/simulator.js --speed 600

# Or run it in the background
docker compose --profile sim up -d simulator
docker compose --profile sim stop simulator

# Trigger a smoke alarm in home H007; the notification that comes back is printed
docker compose --profile sim run --rm simulator node src/simulator.js --smoke H007

# Send 4 invalid messages to show validation (then check the ingest log)
docker compose --profile sim run --rm simulator node src/simulator.js --invalid
docker compose logs ingest | tail
```

### 8.2 Publishing messages yourself

Use the `mosquitto_pub` and `mosquitto_sub` tools from the broker container. The passwords are in `.env`.

```bash
source .env

# listen for notifications from every home
docker exec -it mosquitto mosquitto_sub -u "$MQTT_GATEWAY_USER" -P "$MQTT_GATEWAY_PASSWORD" -t 'iothings/+/notifications' -v

# in another terminal: publish a temperature reading
docker exec mosquitto mosquitto_pub -u "$MQTT_GATEWAY_USER" -P "$MQTT_GATEWAY_PASSWORD" \
  -q 1 -t iothings/H001/H001-kitchen-temperature/state -m '{"value": 21.7}'
```

### 8.3 Message format

- Topic: `iothings/<homeId>/<deviceId>/state`
- Payload: a JSON object with a `state` or a `value` (or both), plus optional `ts` (ISO-8601) and `battery` (0 to 100)

| Device type | `state` values | `value` (unit, range) |
|---|---|---|
| `door_lock` | locked, unlocked | none |
| `door_contact` | open, closed | none |
| `motion` | detected, clear | none |
| `light` | on, off | brightness (%, 0–100) |
| `light_switch` | pressed | none |
| `blind` | none | position (%, 0–100) |
| `thermostat` | heating, idle | setpoint (°C, 5–30) |
| `temperature` | none | °C, -20 to 60 |
| `humidity` | none | %, 0–100 |
| `smoke_alarm` | clear, smoke, test | none |
| `smart_plug` | on, off | power (W, 0–3500) |

---

## 9. Working with MongoDB directly

`scripts/mongosh.sh` opens the MongoDB shell against the replica set as one of the configured users:

```bash
scripts/mongosh.sh admin        # root access
scripts/mongosh.sh api          # readWrite on iothings
scripts/mongosh.sh analyst      # read only
scripts/mongosh.sh api mongo/demo-queries.js    # run a script file from mongo/
```

Useful commands inside the shell:

```js
rs.status()                  // member states and health
rs.conf()                    // replica set configuration (hosts, priorities)
db.hello().primary           // the current primary

use iothings
show collections
db.homes.findOne()
db.devices.find({ homeId: "H001" })
db.sensor_events.find({ "meta.deviceId": "H001-hallway-door-lock" }).sort({ ts: -1 }).limit(5)
db.alerts.find({ severity: "critical" })
db.sensor_events.getIndexes()
db.sensor_events.find({ "meta.homeId": "H001" }).explain("executionStats")
```

### Connecting from MongoDB Compass or another GUI

The simplest option is a direct connection to one node:

```
mongodb://admin:<MONGO_ROOT_PASSWORD>@localhost:27017/?authSource=admin&directConnection=true
```

To connect to the whole replica set from your machine, first make the container names resolve locally, then use the replica set URI:

```bash
echo "127.0.0.1 mongo1 mongo2 mongo3" | sudo tee -a /etc/hosts
```

```
mongodb://admin:<MONGO_ROOT_PASSWORD>@mongo1:27017,mongo2:27018,mongo3:27019/?replicaSet=rs0&authSource=admin
```

---

## 10. Demonstrations

These scripts give clear output that you can screenshot for the report.

| Demonstration | Command |
|---|---|
| Replica set configuration and status | `scripts/mongosh.sh admin`, then `rs.conf()` and `rs.status()` |
| Create/read/update/delete, schema validation, `$lookup`, aggregation, `explain()`, GDPR delete | `scripts/mongosh.sh api mongo/demo-queries.js` |
| Role-based access: the analyst can read but not delete | `scripts/mongosh.sh analyst mongo/demo-rbac.js` |
| **Failover**: kill the primary, election, writes still succeed, the old primary rejoins | `scripts/failover-demo.sh` |
| MQTT end to end: smoke, then alert, then notification | `docker compose --profile sim run --rm simulator node src/simulator.js --smoke H007` |
| MQTT validation | `... simulator.js --invalid`, then `docker compose logs ingest` |
| API documentation | http://localhost:4000/docs |
| Live ingest statistics | `docker compose logs -f ingest` while the simulator runs |
| Ingest throughput (load test) | `docker compose --profile sim run --rm simulator node scripts/load-test.js --messages 100000` |
| Time-series granularity benchmark | `scripts/mongosh.sh admin mongo/benchmark-granularity.js` |

Example failover output:

```
2. Simulating a crash of the primary: docker kill mongo1
3. Waiting for the remaining members to elect a new primary
    new primary mongo2:27018 elected after 10s
4. Writes still succeed with one node down (w: majority = 2 of 3)
    POST /events -> HTTP 201
5. Restarting mongo1 - it rejoins as SECONDARY and catches up from the oplog
6. mongo1 has priority 2, so once it has caught up it is re-elected primary
```

---

## 11. Data model

Database: `iothings`

| Collection | Kind | Contents | Indexes |
|---|---|---|---|
| `homes` | Validated with `$jsonSchema` | Address, rooms, preferences (target temperature, night hours, notification contacts), and `customerRef` linking to the existing CRM | `homeId` (unique), `customerRef`, `address.postcode` |
| `devices` | Validated with `$jsonSchema` | Type (one of 11), room, manufacturer, model, firmware, status, plus a denormalised `lastState` and `lastSeen` | `deviceId` (unique), `{homeId, type}` |
| `sensor_events` | **Time-series** (`timeField: ts`, `metaField: meta`, granularity minutes, TTL 730 days) | One document per activation | `{meta.homeId, ts}`, `{meta.deviceId, ts}`, `{meta.type, ts}` |
| `alerts` | Validated with `$jsonSchema` | kind, severity, message, time and acknowledgement | `{homeId, acknowledged, ts}`, `{severity, ts}` |

Example documents:

```js
// homes
{ homeId: "H001", customerRef: "CRM-10001", name: "Liverpool home 1",
  address: { line1: "208 Station Road", city: "Liverpool", postcode: "L8 3GG" },
  rooms: ["hallway", "living_room", "kitchen", "bedroom", "bathroom"],
  preferences: { targetTemperature: 19, nightStart: "23:00", nightEnd: "06:30", notifyContacts: ["owner1@example.com"] },
  profile: "shift", createdAt: ISODate(...) }

// devices
{ deviceId: "H001-hallway-door-lock", homeId: "H001", type: "door_lock", room: "hallway",
  manufacturer: "Yale", model: "DOO-412", firmware: "2.3.7", status: "active",
  installedAt: ISODate(...), lastSeen: ISODate(...), lastState: { state: "locked" } }

// sensor_events
{ ts: ISODate("2026-09-27T22:17:17Z"),
  meta: { homeId: "H001", deviceId: "H001-hallway-door-lock", type: "door_lock", room: "hallway" },
  state: "locked" }

// alerts
{ homeId: "H007", deviceId: "H007-hallway-smoke-alarm", kind: "smoke", severity: "critical",
  message: "Smoke detected in hallway", ts: ISODate(...), acknowledged: false }
```

### Design decisions

- **Time-series collection for events.** MongoDB groups readings from the same device into compressed buckets, which suits append-only sensor data and makes time-range queries fast.
- **`minutes` granularity, chosen by measurement.** Most devices report only a few times an hour. With `seconds` granularity, buckets close after one hour and hold only about 3 events each. `mongo/benchmark-granularity.js` compares the options on the same data: `minutes` needs 3.6 MB against 19.2 MB for `seconds` and 26.2 MB for a plain collection, and reads fewer buckets per query. `hours` is slightly smaller, but its buckets span up to 30 days, which is too coarse for day-level queries.
- **Reference (not embed) devices in homes.** A home can have many devices, and devices are updated often, so they get their own collection. `GET /homes/{id}` joins the two with `$lookup`.
- **Denormalised `lastState` on each device.** Dashboards can show the current state without scanning events.
- **`customerRef`** links to the existing CRM or ERP systems instead of copying customer personal data into the new store.

---

## 12. Security

| Layer | Measure |
|---|---|
| Between cluster members | Shared keyfile (`--keyFile`). Nodes without it cannot join. |
| Database users | Role-based access (RBAC) with least privilege. Each service has its own account (below). |
| MQTT | `allow_anonymous false`, with a password file (hashed) for the `ingest` and `gateway` users |
| API | `x-api-key` header compared in constant time. Request bodies are limited to 100 KB. Clients can only write listed fields. Internal errors are hidden from clients. |
| Data quality | Schema validation in MongoDB, plus payload validation in the ingest service and API |
| UK GDPR | Events expire after 2 years (TTL). `DELETE /homes/{id}` erases all of a home's data. Customer personal details stay in the CRM. |
| Secrets | `.env`, the keyfile and the MQTT password file are generated locally and listed in `.gitignore` |

| MongoDB user | Auth DB | Roles | Used by |
|---|---|---|---|
| `admin` | admin | root | Administration and setup |
| `iothings_ingest` | iothings | readWrite@iothings | Ingest service |
| `iothings_api` | iothings | readWrite@iothings, clusterMonitor | REST API |
| `iothings_analyst` | iothings | read@iothings | Analysts and reporting |

---

## 13. Test dataset

`scripts/seed.js` generates the dataset from the behaviour model in `src/behaviour.js`. It uses a seeded random number generator, so the data is **reproducible**.

| Item | Default |
|---|---|
| Homes | 20, spread over 8 UK cities |
| Occupant profiles | commuter, remote worker, shift worker |
| Rooms per home | hallway, living room, kitchen, bedroom, bathroom |
| Devices | 24 per home, 480 in total |
| Period | The last 30 days |
| Events | About 290,000 |
| Alerts | About 60 (burnt-dinner smoke, late-night door use) |

The model includes:

- **Daily routines in UK local time:** wake-up, commute, cooking, TV and bedtime. Weekends and weekdays differ.
- **Heating:** thermostat heating and idle cycles. Room temperature follows the heating, readings arrive every 15 minutes and the kitchen warms up while cooking.
- **Humidity:** readings every 30 minutes, with peaks after showers.
- **Smoke alarms:** tested monthly, with occasional real smoke events.
- **Night-time door use:** occasional, which triggers security alerts.

Every generated message goes through the same validation and alert rules as live MQTT traffic.

With `--export`, sample files are written to `data/`:

| File | Contents |
|---|---|
| `sample-homes.json` | The first 2 homes |
| `sample-devices.json` | Their 48 devices |
| `sample-sensor-events-one-day.csv` | One day of events for home H001 |
| `dataset-summary.json` | Totals and the date range |

---

## 14. Configuration (.env)

`setup.sh` generates `.env`. You can edit it and then restart with `docker compose up -d ingest api`.

| Variable | Purpose |
|---|---|
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` | MongoDB administrator |
| `MONGO_INGEST_PASSWORD`, `MONGO_API_PASSWORD`, `MONGO_ANALYST_PASSWORD` | Application users |
| `MONGO_URI_INGEST`, `MONGO_URI_API` | Connection strings used by the containers |
| `MONGO_DB` | Database name (`iothings`) |
| `MQTT_URL` | Broker address (`mqtt://mosquitto:1883` inside Docker) |
| `MQTT_INGEST_USER` / `MQTT_INGEST_PASSWORD` | Broker login for the ingest service |
| `MQTT_GATEWAY_USER` / `MQTT_GATEWAY_PASSWORD` | Broker login for sensors and the simulator |
| `API_PORT` | Host port for the API (default 4000) |
| `API_KEY` | Key required in `x-api-key` |
| `INGEST_BATCH_SIZE` | Optional, default 500 |
| `INGEST_BATCH_INTERVAL_MS` | Optional, default 1000 |

If you change a password in `.env` after setup, also update it in MongoDB (run `./scripts/setup.sh` again, which updates the application users) or in the MQTT password file.

---

## 15. Running the Node.js code outside Docker

This is useful for development. The databases and broker still run in Docker.

```bash
npm install
echo "127.0.0.1 mongo1 mongo2 mongo3" | sudo tee -a /etc/hosts     # once

set -a; source .env; set +a
export MQTT_URL=mqtt://localhost:1883
export MONGO_URI="$MONGO_URI_API"

docker compose stop api        # free port 4000
npm run api                    # REST API on :4000
npm run simulate -- --smoke H001
MONGO_URI="$MONGO_URI_INGEST" npm run ingest
```

---

## 16. Tests

```bash
npm install
npm test
```

The unit tests (`test/devices.test.js`, using `node:test`) cover:

- parsing MQTT topics
- payload validation for each device type
- UK night-time handling (GMT and BST)
- the alert rules
- that the generated dataset is deterministic and valid

---

## 17. Troubleshooting

| Problem | Fix |
|---|---|
| Messages lost during large bursts; broker log says `Outgoing messages are being dropped` | Mosquitto's default queue (1,000 messages per client) is too small. `docker/mosquitto/mosquitto.conf` raises it (`max_queued_messages 200000`, `max_inflight_messages 500`). Restart with `docker compose restart mosquitto`. |
| `port is already allocated` | Another program is using the port. Change `API_PORT` in `.env`, or edit the port mapping in `docker-compose.yml`. |
| `setup.sh` waits forever for "healthy" | Check `docker compose logs mongo1`. A common cause is a missing or unreadable `docker/mongo/keyfile`. Delete it and run setup again. |
| API returns `401` | Send the header `x-api-key: <API_KEY from .env>`. |
| `/health` returns `503` | The replica set has no primary. Check `docker compose ps`; at least 2 of the 3 mongo containers must be running. |
| Seed fails with `EACCES` writing to `data/` | Run it with `--user "$(id -u):$(id -g)"` as shown above. |
| Ingest log shows `rejected message from unregistered device` | Register the device first (`POST /api/v1/devices`) or run the seed script. |
| `getaddrinfo ENOTFOUND mongo1` when running from the host | Add `127.0.0.1 mongo1 mongo2 mongo3` to `/etc/hosts`, or use `directConnection=true` (section 9). |
| Start completely from scratch | `docker compose down -v && rm .env docker/mongo/keyfile docker/mosquitto/passwd && ./scripts/setup.sh` |

---

## 18. Project structure

```
iothings/
├── docker-compose.yml          All services: 3× mongod, mosquitto, ingest, api, simulator
├── Dockerfile                  Image for the Node.js services
├── openapi.yaml                API specification (served at /docs)
├── package.json
├── docker/
│   ├── mongo/keyfile           (generated) replica set shared secret
│   └── mosquitto/
│       ├── mosquitto.conf      Broker configuration (no anonymous access)
│       └── passwd              (generated) MQTT users
├── mongo/
│   ├── 01-init-replica-set.js  rs.initiate() with 3 members
│   ├── 02-create-users.js      Admin and least-privilege users
│   ├── 03-create-schema.js     Collections, validators, time-series, TTL, indexes
│   ├── demo-queries.js         Create/read/update/delete and aggregation demo
│   ├── demo-rbac.js            Read-only user demo
│   └── benchmark-granularity.js  Storage/query benchmark of time-series granularities
├── scripts/
│   ├── setup.sh                One-command installation
│   ├── seed.js                 Dataset generator
│   ├── failover-demo.sh        High-availability demo
│   ├── load-test.js            MQTT → MongoDB throughput test
│   └── mongosh.sh              Shell access as any user
├── src/
│   ├── config.js               Environment configuration
│   ├── db.js                   MongoDB connection (majority writes, retries)
│   ├── devices.js              Device catalogue, topics, validation, alert rules
│   ├── behaviour.js            Synthetic household behaviour model
│   ├── ingest.js               MQTT → MongoDB service
│   ├── simulator.js            MQTT sensor gateway simulator
│   └── api/
│       ├── server.js           Express application
│       ├── middleware.js       Auth, errors, query helpers
│       └── routes/             homes, devices, events, alerts, analytics, cluster
├── test/devices.test.js        Unit tests
└── data/                       (generated) dataset samples for the appendix
```

---

## 19. Future work

- **Customer front end:** a web or mobile dashboard that visualises the sensor data and recommendations through this API.
- **Transport security:** TLS for MongoDB, MQTT (port 8883) and the API (HTTPS).
- **Encryption at rest:** encrypt stored data, and use client-side field-level encryption for sensitive fields.
- **Per-customer access:** OAuth2 or JWT, so each customer can only see their own home.
- **Scaling:** sharding on `meta.homeId` as the number of homes grows, and a geographically distributed replica set.
- **Machine learning:** prediction models for activity and anomaly detection, trained on the stored events.
- **Operations:** automated backups (`mongodump` or snapshots), monitoring and alerting (Prometheus and Grafana), and integration with the existing ERP and CRM.
