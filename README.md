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

MIT
