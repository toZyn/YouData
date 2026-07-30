# YouData

YouData is an open-source, single-file embedded database for Node.js. It is built from scratch around a compact binary database file, a write-ahead log, in-memory indexes, schemas, transactions, authentication, and multiple gateway protocols.

> Current storage format: **YDATA02 / version 2**

## Highlights

- Single portable `.ydb` database file
- Write-ahead log (`.wal`) with recovery after an interrupted write
- File locking to prevent unsafe concurrent writers
- Atomic checkpoints and compaction
- Optional backups
- Collections with fast key access through `Map`
- Secondary indexes for equality lookups
- Query operators, sorting, pagination, and field projection
- Transactions with commit and rollback
- Schemas with validation, required fields, defaults, and common types
- Scrypt password hashing with backward-compatible SHA-256 verification
- Session tokens with expiration and authentication rate limiting
- HTTP, HTTPS, and RESP-compatible gateways
- Health and metrics endpoints
- CLI and interactive shell
- Zero runtime dependencies

## Requirements

- Node.js 18 or newer

## Install

```bash
npm install youdata
npm install -g youdata
```

## Library

```js
import { open } from 'youdata';
import { createSchema } from 'youdata/schema';

const db = open('./data/main.ydb');
const users = db.collection('users');

users.set('maycol', { name: 'Maycol', plan: 'free', active: true });
console.log(users.get('maycol'));
console.log(users.find({ plan: 'free' }, { sort: { name: 'asc' }, limit: 20 }));

users.createIndex('plan');

db.setSchema('users', createSchema({
  name: { type: 'string', required: true },
  plan: { type: 'string', default: 'free' },
  active: { type: 'boolean', default: true }
}));

db.createAccount('admin', 'change-this-password', 'admin');
const session = db.authenticate('admin', 'change-this-password');

db.gateway({ port: 6380 }).start();
```

## Collections and queries

```js
const posts = db.collection('posts');

posts.set('1', { title: 'Hello', views: 10, published: true });
posts.set('2', { title: 'World', views: 30, published: true });

posts.find(
  { views: { $gte: 10 }, published: true },
  { sort: { views: 'desc' }, skip: 0, limit: 10, fields: ['title', 'views'] }
);

posts.find({ title: { $regex: '^Hello' } });
posts.find({ published: { $exists: true } });
```

Supported query operators:

- `$gt`, `$gte`, `$lt`, `$lte`
- `$ne`, `$in`
- `$regex`, `$exists`

## Transactions

```js
const transaction = db.begin();
transaction.set('users', '1', { name: 'Maycol' });
transaction.set('users', '2', { name: 'Ana' });
transaction.commit();
```

Use `transaction.rollback()` to restore the state captured when the transaction started.

## Schemas

```js
import { createSchema } from 'youdata/schema';

const schema = createSchema({
  email: { type: 'email', required: true },
  age: { type: 'integer' },
  active: { type: 'boolean', default: true }
});

db.setSchema('users', schema);
```

Available types include `string`, `number`, `boolean`, `integer`, `array`, `object`, `any`, `email`, `url`, and `date`.

## Indexes

```js
const users = db.collection('users');
users.createIndex('email');
console.log(users.listIndexes());
users.dropIndex('email');
```

Indexes are persisted in the database and rebuilt when the file is opened.

## CLI

```bash
youdata init ./data/main.ydb
youdata stats ./data/main.ydb
youdata metrics ./data/main.ydb
youdata checkpoint ./data/main.ydb
youdata compact ./data/main.ydb
youdata backup ./data/main.ydb ./data/main.backup.ydb
youdata account create admin change-this-password admin ./data/main.ydb
youdata schema set users '{"name":{"type":"string","required":true}}' ./data/main.ydb
youdata index create users email ./data/main.ydb
youdata gateway 6380 ./data/main.ydb
youdata gateway 6380 ./data/main.ydb --resp
youdata shell ./data/main.ydb
```

The interactive shell supports statistics, metrics, checkpoints, backups, CRUD operations, queries, schemas, and indexes.

## Gateway

Start the HTTP gateway:

```js
db.gateway({ port: 6380 }).start();
```

Supported HTTP routes include:

- `GET /health`
- `GET /metrics`
- `GET /stats`
- `GET /collections/:collection`
- `GET /collections/:collection/:key`
- `POST /collections/:collection`
- `PUT /collections/:collection/:key`
- `DELETE /collections/:collection/:key`

Collection reads accept `query`, `sort`, `limit`, `skip`, and `fields` query parameters as JSON where applicable. Protected routes require `Authorization: Bearer <token>`.

HTTPS is available with `db.gateway({ key, cert, port }).start()`.

For Redis-style integrations, start the RESP gateway:

```js
db.gateway({ port: 6380, resp: true }).start();
```

The RESP gateway supports `PING`, `GET`, `SET`, `DEL`, `KEYS`, and `STATS`.

## Durability and storage

The `.ydb` file stores the complete database state in a custom length-prefixed binary format. Changes are first written to the WAL and synchronized before being applied to the in-memory state. On the next open, an existing WAL is replayed and checkpointed.

`checkpoint()` writes the current live state to a temporary file, synchronizes it, atomically replaces the database file, and clears the WAL. `compact()` performs the same operation and returns the resulting file size. `backup(path)` creates a synchronized copy after checkpointing.

YouData does not use ZIP, GZip, SQLite, Redis, or another storage engine.

## Development

```bash
npm test
```

## License

MIT
