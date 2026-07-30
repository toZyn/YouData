# YouData

YouData is a universal single-file database and concurrent application data server for Node.js. It supports local embedded use and a server mode for applications, APIs, automation, analytics, content, games, collaboration, and real-time systems.

## Version

```text
0.3.0
```

## Install

```bash
npm install youdata
```

## Embedded mode

```js
import { open } from 'youdata';

const db = open('./data/main.ydb');
const users = db.collection('users');

users.set('maycol', { name: 'Maycol', plan: 'free' });
console.log(users.get('maycol'));
console.log(users.find({ plan: 'free' }));

db.close();
```

Embedded mode is intended for one process opening a database file directly. Do not open the same `.ydb` file from several application processes.

## Server mode

For multiple application processes and concurrent clients, start one server as the owner of the `.ydb` file. This is the supported multiprocess mode:

```bash
youdata-server ./data/main.ydb
```

Connect from Node.js:

```js
import { YouDataClient } from 'youdata/client';

const client = new YouDataClient({
  host: '127.0.0.1',
  port: 6380
});

await client.auth('admin', 'password');
await client.set('users', 'maycol', { name: 'Maycol' });
const user = await client.get('users', 'maycol');
```

Server mode is the multiprocess architecture. It provides TCP, HTTP JSON, native WebSocket transport, concurrent reads, serialized durable writes, authentication, request limits, and Pub/Sub. Multiple application processes communicate through the server; only the server opens the database file.

## Data operations

```js
const values = db.collection('values');

values.set('name', 'Maycol');
values.set('enabled', true);
values.set('views', 0);
values.incr('views', 1);
values.setnx('unique-key', { created: true });
values.mget(['name', 'views']);
values.setWithTTL('temporary', { active: true }, 60_000);
```

Collections also support queries, schemas, indexes, transactions, lists, sets, hashes, and generated keys through `addWithKey()`.

## SQL API

The server includes a small SQL compatibility API for basic single-collection operations:

```js
await client.sql("SELECT * FROM users WHERE age >= 18 LIMIT 20");
await client.sql("INSERT INTO users (name, age) VALUES ('Maycol', 25)");
await client.sql("UPDATE users SET age = 26 WHERE name = 'Maycol'");
await client.sql("DELETE FROM users WHERE name = 'Maycol'");
```

This is a native constrained API, not full MySQL protocol compatibility.

## Persistence and correctness

- Portable single `.ydb` file
- Append-only WAL
- Checkpointing and recovery
- In-memory indexes
- TTL metadata
- Schemas and validation
- Local transactions
- Serialized server writes
- Concurrent server reads
- No runtime dependencies

## CLI

```bash
youdata init ./data/main.ydb
youdata stats ./data/main.ydb
youdata compact ./data/main.ydb
youdata shell ./data/main.ydb
```

## Scope

YouData is designed as a general-purpose platform rather than a product limited to one application category. Replication, automatic failover, distributed consensus, sharding, and cluster coordination require a multi-node protocol and dedicated failure-injection tests; they are not implied by the single-server mode.

## License

YouData is distributed under the **YouData Personal Use License**. See [`LICENSE`](LICENSE) for the complete terms. Copyright © 2026 SoyMaycol (Zyn).

See [`docs/SERVER.md`](docs/SERVER.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the complete architecture, multiprocess deployment, and server API.
