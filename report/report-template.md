# IoThings Sensors Database: NoSQL Design and Implementation Report

**Prepared for:** IoThings Home Automation Solutions
**Module:** CMP6207 Modern Data Stores
**Author:** _[Your name, student ID]_
**Date:** _[Month Year of submission]_

> Formatting required by the brief: font size 11, 1.5 line spacing, page numbers, readable screenshots. Append the BCU cover sheet. Submit as a PDF.
> Delete every _italic prompt_ and `> note` like this one before you submit.

---

## Contents

_[Generate this automatically in Word: References → Table of Contents]_

---

## 1. Introduction (≈300 words)

_Points to cover, in your own words:_
- [ ] Who IoThings is: a UK start-up SME that installs home-automation sensors
- [ ] Current systems: ERP, CRM, Financial, Order Processing/Sales, Logistics (all relational)
- [ ] The business need: store sensor-activation data sent over MQTT, then use it to give users feedback, predict activity, and keep homes safe
- [ ] The client's concerns: data security and a "three-cluster" MongoDB system
- [ ] The scope of this report: sensors database only, the Node.js MQTT server and the API
- [ ] What each following section covers (one sentence each)

**Figure 1:** _Overall system architecture (sensors → MQTT → Node.js ingest → MongoDB replica set → REST API)_
> Redraw the README diagram in draw.io or PowerPoint so it looks professional.

---

## 2. Principal Types of NoSQL Databases (≈800 words, cite sources)

> The client "knows little or nothing about NoSQL". Keep the language plain, but include theory.

### 2.1 What NoSQL means
- [ ] "Not Only SQL": a complement to relational databases, not a replacement
- [ ] Why NoSQL emerged: web scale, varied data shapes, horizontal scaling

### 2.2 Key-value stores
- [ ] Data model · example products (Redis, DynamoDB) · strengths · weaknesses · possible IoThings use (e.g. device session cache)

### 2.3 Document stores
- [ ] Data model (JSON/BSON documents) · examples (MongoDB, Couchbase) · strengths · weaknesses · why it suits sensor data

### 2.4 Wide-column stores
- [ ] Data model · examples (Cassandra, HBase) · strengths (write-heavy time series) · weaknesses

### 2.5 Graph databases
- [ ] Data model (nodes and edges) · example (Neo4j) · strengths · weaknesses · possible use (relationships between devices, rooms and homes)

### 2.6 Underlying theory
- [ ] The CAP theorem (Brewer; Gilbert and Lynch) and PACELC (Abadi)
- [ ] BASE compared with ACID (Pritchett)
- [ ] Horizontal scaling: replication and sharding

**Table 1:** _Summary of the four NoSQL types_

| Type | Data model | Example products | Strengths | Weaknesses | Relevance to IoThings |
|---|---|---|---|---|---|
| Key-value | | | | | |
| Document | | | | | |
| Wide-column | | | | | |
| Graph | | | | | |

---

## 3. Critical Comparison: Relational vs Document Databases (≈900 words, cite sources)

> The brief asks for this section to be **generic**, not MongoDB-specific. Weigh **both** sides for every point. That balance is what "critical" means.

- [ ] **Data model and schema:** fixed schema and normalisation vs flexible documents. Trade-off: speed of development vs data integrity.
- [ ] **Relationships:** joins and foreign keys vs embedding and referencing
- [ ] **Transactions and consistency:** ACID vs BASE and tunable consistency. Note that modern document stores now offer multi-document ACID transactions.
- [ ] **Scalability:** vertical scaling vs horizontal scaling (replication, sharding)
- [ ] **Query language:** standard SQL vs product-specific APIs and aggregation pipelines
- [ ] **Performance** for write-heavy time-series workloads
- [ ] **Maturity, tooling and skills:** availability of staff and support
- [ ] **Polyglot persistence:** IoThings keeps its relational ERP, CRM and finance systems and adds NoSQL for sensor data ("NoSQL extends SQL")
- [ ] Your **evaluation:** which approach fits which IoThings workload, and why

**Table 2:** _Relational vs document store comparison_

| Criterion | Relational | Document store | Evaluation for IoThings |
|---|---|---|---|
| Schema | | | |
| Relationships | | | |
| Consistency / transactions | | | |
| Scalability | | | |
| Query language | | | |
| Time-series write performance | | | |
| Maturity / skills | | | |

---

## 4. IoThings NoSQL Database Design and Implementation (≈1,200 words)

> Put each screenshot under its subsection, then explain in 1–2 sentences **what it proves**.

### 4.1 Technology choices
| Component | Choice | Version |
|---|---|---|
| Database | MongoDB (replica set `rs0`) | 7.0 |
| Message broker | Eclipse Mosquitto | 2 |
| Server runtime | Node.js (Express 4, MongoDB driver 6, MQTT.js 5) | 22 |
| Deployment | Docker Compose | v2 |

- [ ] Justify each choice in your own words

### 4.2 Installation and configuration of the three-node cluster
| Member | Host:port | Priority | Role |
|---|---|---|---|
| mongo1 | mongo1:27017 | 2 | Preferred primary |
| mongo2 | mongo2:27018 | 1 | Secondary |
| mongo3 | mongo3:27019 | 1 | Secondary |

- [ ] Explain why three members (majority voting), and what `setup.sh` does step by step

**Figure 2:** _`docker-compose.yml`, the three mongo services_
**Figure 3:** _`setup.sh` output (replica set initialised, users created, schema created)_
**Figure 4:** _`docker compose ps`, all containers healthy_
**Figure 5:** _`rs.conf()`, members and priorities_
**Figure 6:** _`rs.status()`, one PRIMARY and two SECONDARY members_

### 4.3 Security
| Layer | Measure |
|---|---|
| Between cluster members | Keyfile authentication |
| Database users | RBAC: `admin` (root), `iothings_ingest` (readWrite), `iothings_api` (readWrite + clusterMonitor), `iothings_analyst` (read) |
| MQTT | Anonymous access disabled; `ingest` and `gateway` password accounts |
| API | `x-api-key` header, 100 KB body limit, field allow-listing |
| UK GDPR | 730-day TTL on events; erasure through `DELETE /homes/{id}`; personal data stays in the CRM (`customerRef`) |

- [ ] Explain least privilege and why each service has its own user

**Figure 7:** _`demo-rbac.js`, the analyst read succeeds and the delete is refused_

### 4.4 Data model
| Collection | Type | Purpose | Indexes |
|---|---|---|---|
| `homes` | `$jsonSchema` validated | Property, rooms, preferences, CRM link | `homeId` unique, `customerRef`, `address.postcode` |
| `devices` | `$jsonSchema` validated | 11 device types, `lastState` | `deviceId` unique, `{homeId, type}` |
| `sensor_events` | Time-series (`ts`/`meta`, seconds, TTL 730 days) | Every activation | `{meta.homeId, ts}`, `{meta.deviceId, ts}`, `{meta.type, ts}` |
| `alerts` | `$jsonSchema` validated | Smoke, night-door, temperature alerts | `{homeId, acknowledged, ts}`, `{severity, ts}` |

- [ ] Explain your design decisions: why a time-series collection; referencing vs embedding devices; the deliberately duplicated `lastState`; `customerRef` instead of copying customer data

**Figure 8:** _Example document from each collection_
**Figure 9:** _`getCollectionInfos()`, the time-series options and a validator_
**Figure 10:** _`db.sensor_events.getIndexes()`_

### 4.5 MQTT ingest service
- Topic: `iothings/<homeId>/<deviceId>/state`, QoS 1, persistent session
- Pipeline: parse the topic → look up the device (cached for 60 s) → validate the payload for its type → build the event → check the alert rules → buffer → `insertMany` (every 500 events or 1 s) → update `lastState`
- Alert rules: smoke (critical); door unlocked or opened during night hours in UK time (warning); temperature ≥35 °C or ≤5 °C (warning). Notifications are published to `iothings/<homeId>/notifications`.

- [ ] Explain why messages are batched and validated

**Figure 11:** _Smoke alarm → alert → notification (simulator `--smoke H007`)_
**Figure 12:** _Ingest log showing 4 invalid messages rejected and the stats line_

### 4.6 Data management (CRUD and queries)
**Figure 13:** _`demo-queries.js`, CREATE and a schema validation rejection_
**Figure 14:** _READ with `$lookup`_
**Figure 15:** _UPDATE_
**Figure 16:** _Aggregation: average temperature by hour of day_
**Figure 17:** _`explain()` showing the index used_
**Figure 18:** _DELETE (GDPR erasure across collections)_

### 4.7 Distributed data management: failover test
Measured results:
- The primary was killed with `docker kill mongo1`
- A new primary (mongo2) was elected in about **10 seconds**
- Writes kept succeeding with one node down (HTTP 201, `w: majority` = 2 of 3)
- mongo1 rejoined as a SECONDARY, caught up from the oplog, then regained PRIMARY (priority 2)

- [ ] Explain elections, the oplog, write concern and read preference

**Figure 19:** _Full `failover-demo.sh` output_

---

## 5. API Implementation and Documentation (≈450 words)

- [ ] Design: REST, versioned under `/api/v1`, JSON responses, OpenAPI 3 documentation at `/docs`
- [ ] Authentication (`x-api-key`) and error handling (400 / 401 / 404 / 409 / 503)
- [ ] How the analytics endpoints turn raw events into feedback for users

**Table 3:** _API endpoints_

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/simulate/door` | A person opens a door: alert raised and light switched on |
| GET | `/api/v1/rooms/{homeId}/{room}` | Door state, light state and latest door alerts |
| GET | `/api/v1/alerts` | List alerts (e.g. kind `door_opened`) |
| GET | `/api/v1/homes` | List homes |
| GET | `/api/v1/homes/{homeId}` | One home with its devices (`$lookup`) |
| GET | `/api/v1/devices` | List devices |
| GET | `/api/v1/events` | Query stored sensor readings |
| GET | `/api/v1/analytics/homes/{id}/routine` | Predicted wake, leave and return times (`$median`) |
| GET | `/health` | Status and current primary |
| GET | `/api/v1/cluster/status` | Replica set member states |

**Figure 20:** _Swagger UI overview_
**Figure 21:** _`routine` response for H005 (weekday leave 08:07, return 17:50)_
**Figure 22:** _`simulate/door` response: alert raised and light switched on_
**Figure 23:** _`401` response without an API key_

---

## 6. Summary and Conclusion (≈350 words)

- [ ] Summarise what was delivered
- [ ] Why IoThings should invest: availability, scalability, flexible schema for new device types, analytics, security and GDPR
- [ ] Honest limitations: no TLS yet, single-site deployment, synthetic data, a simple rule-based "prediction"

### 6.1 Future work
- [ ] Customer frontend or dashboard built on the `/analytics` endpoints
- [ ] TLS (MongoDB, MQTTS on 8883, HTTPS) and encryption at rest
- [ ] OAuth2 or JWT per-customer access
- [ ] Sharding on `meta.homeId`; a geographically distributed replica set
- [ ] Machine-learning activity prediction and anomaly detection
- [ ] Backups, monitoring, integration with the ERP and CRM

---

## References

> Harvard style. Check every entry and **only list sources you actually cite**.

- Abadi, D. (2012) 'Consistency tradeoffs in modern distributed database system design', *Computer*, 45(2), pp. 37–42.
- Angles, R. and Gutierrez, C. (2008) 'Survey of graph database models', *ACM Computing Surveys*, 40(1), pp. 1–39.
- Brewer, E. (2012) 'CAP twelve years later: how the "rules" have changed', *Computer*, 45(2), pp. 23–29.
- Cattell, R. (2011) 'Scalable SQL and NoSQL data stores', *ACM SIGMOD Record*, 39(4), pp. 12–27.
- Chang, F. et al. (2006) 'Bigtable: a distributed storage system for structured data', *OSDI '06*.
- Codd, E.F. (1970) 'A relational model of data for large shared data banks', *Communications of the ACM*, 13(6), pp. 377–387.
- DeCandia, G. et al. (2007) 'Dynamo: Amazon's highly available key-value store', *SOSP '07*.
- Gilbert, S. and Lynch, N. (2002) 'Brewer's conjecture and the feasibility of consistent, available, partition-tolerant web services', *ACM SIGACT News*, 33(2), pp. 51–59.
- MongoDB Inc. (n.d.) *MongoDB Manual: Replication; Time Series; Schema Validation*. Available at: https://www.mongodb.com/docs/manual/ (Accessed: _date_).
- OASIS (2019) *MQTT Version 5.0*. OASIS Standard.
- Pritchett, D. (2008) 'BASE: an ACID alternative', *ACM Queue*, 6(3), pp. 48–55.
- Sadalage, P.J. and Fowler, M. (2012) *NoSQL Distilled*. Upper Saddle River, NJ: Addison-Wesley.
- Stonebraker, M. (2010) 'SQL databases v. NoSQL databases', *Communications of the ACM*, 53(4), pp. 10–11.

---

## Appendix A: Dataset Used for Testing

| Item | Value |
|---|---|
| Source | Synthetic, from a behaviour model (`src/behaviour.js`); real data is protected by UK GDPR |
| Homes | 20, in 10 UK cities; commuter, remote-worker and shift-worker profiles |
| Rooms / devices | 5 rooms, 24 devices per home, 480 devices, 11 types |
| Period | 30 days |
| Events | 289,646 |
| Alerts | 64 |
| Reproducibility | Seeded random generator; `scripts/seed.js --homes 20 --days 30` |
| Export files | `data/sample-homes.json`, `sample-devices.json`, `sample-sensor-events-one-day.csv`, `dataset-summary.json` |

- [ ] Describe what the model simulates (routines, heating, humidity, smoke tests, night-time door use)

**Figure A1:** _Extract from `sample-sensor-events-one-day.csv`_
**Figure A2:** _`dataset-summary.json`_

## Appendix B: Test Data for CRUD and Distributed Management
- [ ] Demo home H900, device H900-kitchen-smoke-alarm (`demo-queries.js`)
- [ ] API lifecycle test with home H950
- [ ] Invalid MQTT messages: value 999, state "banana", an unknown device, non-JSON text
- [ ] Failover test procedure and results

## Appendix C: Unit Tests
- [ ] `npm test`: 5 tests passing (topic parsing, validation, UK night time, alert rules, dataset determinism)
