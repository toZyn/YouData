# Multiprocess Deployment

YouData has two access modes.

## Embedded mode

`open(file)` opens a `.ydb` file for one process. File locking prevents two independent database engines from mutating the same file.

## Server mode

Server mode is the multiprocess architecture. Start exactly one `YouDataServer` for each database file. That process owns the file, WAL, checkpoints, and durable writes. Every application process connects through `YouDataClient`, TCP, HTTP, or WebSocket.

```text
Application process A ─┐
Application process B ─┼─ network ─ YouDataServer ─ WAL ─ main.ydb
Application process C ─┘
```

This is how several web workers, API processes, background jobs, realtime gateways, and other services use the same database without competing for the file lock.

## Rules

- Never call `open()` on the same file from several application processes.
- Run one server owner per database file.
- Use clients for all remote operations.
- Put the server behind an application load balancer when more application processes are needed.
- Use Pub/Sub for live process-to-process events through the server.
- Treat the WAL as the durability boundary.

## Client example

```js
import { YouDataClient } from 'youdata/client';

const client = new YouDataClient({
  host: process.env.YOUDATA_HOST,
  port: Number(process.env.YOUDATA_PORT)
});

await client.auth(process.env.YOUDATA_USER, process.env.YOUDATA_PASSWORD);
await client.set('records', 'record-1', { status: 'ready' });
```

## Scaling boundary

One server can serve multiple processes and concurrent connections. Horizontal database scaling requires multiple database servers, replication, node identity, failover, and shard routing. Those are separate distributed-system features and must not be simulated by opening one file from multiple processes.

## TLS TCP

Pass certificate material to the server to enable TLS for TCP connections:

```js
import fs from 'node:fs';
import { YouDataServer } from 'youdata/server';

const server = new YouDataServer('./data/main.ydb', {
  tls: {
    key: fs.readFileSync(process.env.YOUDATA_TLS_KEY),
    cert: fs.readFileSync(process.env.YOUDATA_TLS_CERT),
    requestCert: true,
    rejectUnauthorized: true,
    ca: fs.readFileSync(process.env.YOUDATA_TLS_CA)
  }
});
await server.start();
```

TLS protects the transport; application authentication remains token-based.

## Client pool

Use `YouDataClientPool` when one application process needs several concurrent connections:

```js
import { YouDataClientPool } from 'youdata/pool';

const pool = new YouDataClientPool({ size: 8 });
await pool.connect();
await pool.auth(process.env.YOUDATA_USER, process.env.YOUDATA_PASSWORD);
```
