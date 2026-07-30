# YouData

YouData is an open-source, single-file embedded database for Node.js. It is built from scratch with a compact append-only binary log, in-memory indexes, deterministic compaction, collections, queries, accounts, an HTTP Gateway, and a global CLI.

## Install

```bash
npm install youdata
npm install -g youdata
```

## Library

```js
import { open } from 'youdata';

const db = open('./data/main.ydb');
const users = db.collection('users');
users.set('maycol', { name: 'Maycol', plan: 'free' });
console.log(users.get('maycol'));
console.log(users.find({ plan: 'free' }));

db.createAccount('admin', 'change-this-password', 'admin');
db.gateway({ port: 6380 }).start();
```

## CLI

```bash
youdata init ./data/main.ydb
youdata stats ./data/main.ydb
youdata compact ./data/main.ydb
youdata account create admin change-this-password admin ./data/main.ydb
youdata gateway 6380 ./data/main.ydb
youdata shell ./data/main.ydb
```

The file is a portable `.ydb` binary containing the complete database. Writes are appended for speed. `compact` removes obsolete records and rebuilds a minimal file without ZIP, GZip, or third-party storage engines.

## Design

- Single portable database file
- Custom length-prefixed binary records
- Append-only writes for fast mutation
- In-memory Map indexes for constant-time key access
- Explicit compaction for minimal storage
- Collections with `get`, `set`, `add`, `delete`, `find`, `first`, `count`, and iteration
- Built-in account credentials and bearer sessions
- Optional HTTP Gateway for external services
- Zero runtime dependencies

## License

YouData is distributed under the **YouData Personal Use License**.

You may use and modify it for personal, private, and non-commercial purposes. Private forks and private copies are allowed. You may not publish, redistribute, sublicense, sell, release, or offer the original or a modified fork as a public package, public service, hosted service, or commercial product.

See [`LICENSE`](LICENSE) for the complete terms. Copyright © 2026 SoyMaycol (Zyn).

## Concurrent server mode

For multiple processes, run `youdata-server` and connect using `YouDataClient`. The server is the single owner of the `.ydb` file and serializes writes through a TCP JSON protocol. Direct `open()` remains intended for one process.

YouData is general-purpose: it supports application data, services, automation, analytics, content, games, collaboration, and real-time systems. Server mode includes TCP, HTTP, WebSocket, TTL, pub/sub, persisted lists, sets, hashes, counters, batch reads, schemas, indexes, WAL recovery, and transactions. Its APIs are native YouData APIs, not claims of wire compatibility with Redis or MySQL.

See [`docs/SERVER.md`](docs/SERVER.md).


See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the storage, transport, correctness, and distributed-system boundaries.
