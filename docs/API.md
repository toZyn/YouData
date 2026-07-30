# API

## `open(file, options)`

Opens or creates a YouData file.

## `db.collection(name)`

Returns a collection. Collections are categories equivalent to tables or keyspaces.

## Collection methods

- `get(key)`
- `has(key)`
- `set(key, object)`
- `add(object, key)`
- `delete(key)`
- `clear()`
- `keys()`
- `values()`
- `entries()`
- `find(query)`
- `first(query)`
- `count(query)`

Queries support exact values and `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, and `$in` operators.

## Authentication

`db.createAccount(username, password, role)` creates an account. `db.authenticate(username, password)` returns a bearer session. `db.authorize(token, role)` validates it.

## Gateway

`db.gateway({ host, port }).start()` exposes health, stats, collection reads, and collection mutations over HTTP. Every route except `/health` requires `Authorization: Bearer <token>`.

## Storage

The database header is followed by length-prefixed records inside a custom binary container. Compaction writes only the latest live state to a temporary file and atomically replaces the original.
