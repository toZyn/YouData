# YouData API

## `open(file = './youdata.ydb', options)`

Opens or creates a YouData database. `open` acquires a process lock and throws if another active process owns the file.

Useful options include:

- `tokenTTL`: session lifetime in milliseconds
- `rateLimitMax`: failed authentication attempts allowed per window
- `rateLimitWindow`: authentication rate-limit window in milliseconds
- `maxNameLength`: maximum username length
- `maxBodySize`: maximum HTTP request body size
- `maxWalSize`: automatic checkpoint threshold
- `autoCheckpoint`: checkpoint on WAL threshold and close

## `db.collection(name)`

Returns a collection organized by category. Values must be non-array objects.

### Collection methods

- `get(key)`
- `has(key)`
- `set(key, value)`
- `add(value, key = value.id ?? random UUID)`
- `delete(key)`
- `clear()`
- `keys()`
- `values()`
- `entries()`
- `find(query = {}, options = {})`
- `first(query = {}, options = {})`
- `count(query = {})`
- `createIndex(field)`
- `dropIndex(field)`
- `listIndexes()`

`find` options:

- `sort`: `{ field: 'asc' }` or `{ field: 'desc' }`
- `skip`: number of records to skip
- `limit`: maximum number of records
- `fields`: array of fields to project

Supported query operators are `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$regex`, and `$exists`.

## Transactions

`db.begin()` returns a transaction with:

- `set(collection, key, value)`
- `delete(collection, key)`
- `commit()`
- `rollback()`

Transaction writes are applied in memory and persisted as a batch on commit.

## Schemas

Import `Schema` or `createSchema` from `src/schema.js`:

```js
import { createSchema } from 'youdata/schema';

const schema = createSchema({
  name: { type: 'string', required: true },
  active: { type: 'boolean', default: true }
});

db.setSchema('users', schema);
```

`db.getSchema(collection)` returns the schema or `null`. Passing `null` to `setSchema` removes it.

Supported field types:

- `string`
- `number`
- `boolean`
- `integer`
- `array`
- `object`
- `any`
- `email`
- `url`
- `date`

## Authentication

`db.createAccount(username, password, role = 'user')` creates a hashed account. Passwords use salted `scrypt`; legacy SHA-256 records remain verifiable.

`db.authenticate(username, password)` returns `{ token, username, role }` or `null`. Authentication is rate-limited.

`db.authorize(token, role)` validates a session, checks token TTL, and allows administrators to pass role checks.

## Maintenance

- `db.checkpoint()` writes the live state and clears the WAL.
- `db.compact()` checkpoints and returns the database size in bytes.
- `db.backup(destination)` checkpoints and copies the database.
- `db.stats()` returns file, WAL, collection, index, schema, account, session, and version details.
- `db.metricsSnapshot()` returns operation counters and timing information.
- `db.close()` checkpoints when configured, closes the WAL, clears sessions, and releases the file lock.

## Gateway

`db.gateway({ host, port, key, cert, resp }).start()` starts either an HTTP/HTTPS gateway or a RESP-compatible gateway.

HTTP routes:

- `GET /health`
- `GET /metrics`
- `GET /stats`
- `GET /collections/:collection`
- `GET /collections/:collection/:key`
- `POST /collections/:collection`
- `PUT /collections/:collection/:key`
- `DELETE /collections/:collection/:key`

All routes except `/health` and `/metrics` require `Authorization: Bearer <token>`. HTTP collection queries support JSON `query`, `sort`, `limit`, `skip`, and comma-separated `fields` parameters.

The RESP mode supports `PING`, `GET`, `SET`, `DEL`, `KEYS`, and `STATS`.

## Storage model

The database uses a custom `YDATA02` binary header and version 2. Records are length-prefixed JSON payloads. The WAL uses the same length-prefixed record approach. Recovery replays pending WAL records. Checkpoints are synchronized and atomically replace the main file.
