# YouData Server

The server is the single owner of a database file. Clients connect through TCP and never open the file directly, allowing multiple applications to read and write concurrently through one serialized write queue.

Start it with:

```bash
youdata-server ./data/main.ydb
```

The protocol is newline-delimited JSON. Every request has an `id`, an `op`, and an `args` object.

```json
{"id":1,"op":"health","args":{}}
{"id":2,"op":"set","args":{"collection":"users","key":"u1","value":{"name":"Maycol"}},"token":"..."}
```

## Client

```js
import { YouDataClient } from 'youdata/client';

const client = new YouDataClient({ port: 6380 });
await client.auth('admin', 'password');
await client.set('users', 'u1', { name: 'Maycol' });
```

## TTL

```js
users.setWithTTL('session', { active: true }, 60_000);
users.ttl('session');
```

Expired keys are removed lazily on access and query. TTL is persisted in the WAL and checkpoints.

## Pub/Sub

```js
await client.subscribe('events', message => console.log(message));
await client.publish('events', { type: 'created' });
```

## Data structures

Collections provide lightweight persisted structures:

- `rpush(key, ...values)` and `list(key)`
- `sadd(key, ...values)` and `smembers(key)`
- `hset(key, field, value)` and `hgetall(key)`

These are server-managed operations, not claims of full Redis protocol compatibility.

## Concurrency boundary

Direct `open()` remains a single-process API. For multiple processes, run one `YouDataServer` process and connect with `YouDataClient`. This avoids concurrent direct file access and serializes mutations. Replication, failover, clustering, SQL joins, and a complete ACID isolation engine are not included in this release.

## SQL API

Server clients can execute the constrained SQL API:

```js
await client.sql("SELECT * FROM users WHERE age >= 18 LIMIT 20");
await client.sql("INSERT INTO users (name, age) VALUES ('Maycol', 25)");
await client.sql("UPDATE users SET age = 26 WHERE name = 'Maycol'");
await client.sql("DELETE FROM users WHERE name = 'Maycol'");
```

This is not full MySQL compatibility. It intentionally supports basic single-collection operations only.
