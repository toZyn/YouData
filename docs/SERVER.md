# YouData Server

YouData Server is the general-purpose network mode for applications that need concurrent clients, durable writes, and real-time events. It is not limited to social applications.

## Start

```bash
youdata-server ./data/main.ydb
```

The server owns the database file. Applications should connect through a client or a supported network transport instead of opening the same file from several processes.

## Transports

### TCP

The TCP protocol uses newline-delimited JSON. Each request contains an `id`, an `op`, and an `args` object.

```json
{"id":1,"op":"health","args":{}}
```

Node.js client example:

```js
import { YouDataClient } from 'youdata/client';

const client = new YouDataClient({
  host: '127.0.0.1',
  port: 6380
});

await client.auth('admin', 'password');
await client.set('users', 'u1', { name: 'Maycol' });
```

### HTTP JSON

The HTTP transport accepts the same operation objects through the configured API endpoint. Use the actual host and HTTP port selected by your server configuration; applications should not hard-code an endpoint that was not configured for their deployment.

### WebSocket

The native WebSocket transport accepts the same request objects and returns JSON responses. It can be used for bidirectional application events, live updates, chat, collaboration, monitoring, and other real-time workloads.

## Operations

The server exposes key/value access, queries, mutations, generated keys, TTL, batch reads, counters, lists, sets, hashes, Pub/Sub, metrics, authentication, and the constrained SQL API.

```js
await client.setnx('users', 'username:maycol', { userId: 'u1' });
await client.incr('counters', 'views', 1);
await client.publish('events', { type: 'updated' });
```

## Pub/Sub

```js
await client.subscribe('events', message => {
  console.log(message);
});

await client.publish('events', {
  type: 'record-created'
});
```

Pub/Sub is process-local to the running server. It is not a replacement for durable event storage or cross-node replication.

## TTL and structures

```js
users.setWithTTL('session', { active: true }, 60_000);
users.ttl('session');
users.rpush('queue', 'a', 'b');
users.hset('profile', 'name', 'Maycol');
users.sadd('roles', 'admin', 'developer');
```

## SQL

The server supports basic single-collection `SELECT`, `INSERT`, `UPDATE`, and `DELETE` statements with simple conditions and `LIMIT`. It is intentionally constrained and is not full MySQL compatibility.

## Concurrency and durability

- Reads can be served concurrently.
- Mutations are serialized by the server.
- Mutations are persisted through the WAL.
- Checkpoints rebuild the portable database file.
- TTL metadata is persisted.
- Direct embedded access remains a single-process mode.

## Deployment boundary

The server is suitable as a general application data service. Replication, consensus, automatic failover, sharding, and cluster membership need explicit multi-node protocols and failure testing; they must not be inferred from a single server process.
