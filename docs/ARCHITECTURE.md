# YouData Architecture

YouData is a general-purpose database and application data platform. Its scope includes embedded applications, APIs, services, automation, analytics, content, games, collaboration, caches, and real-time systems.

## Storage

The `.ydb` format is a portable single file with append-only WAL records, checkpointing, recovery, TTL metadata, schemas, indexes, and local transactions.

Direct `open()` access is a single-process mode. Multi-process applications use one server process as the file owner and connect through network clients. This prevents independent processes from competing for the file lock while still allowing many application processes to manage the same database concurrently.

## Data model

Collections support JSON-compatible values: objects, arrays, strings, numbers, booleans, and null. Object collections can use schemas and indexes. The API includes key/value access, batch reads, compare-before-set writes, counters, TTL, lists, sets, hashes, queries, and transactions.

## Network model

The server exposes a common operation model through:

- TCP newline-delimited JSON
- HTTP JSON
- Native WebSocket frames
- Pub/Sub channels

All transports use the same authorization and persistence boundary.

## Query model

The current SQL endpoint supports basic single-collection `SELECT`, `INSERT`, `UPDATE`, and `DELETE` statements. It is a constrained compatibility layer, not a full MySQL parser or protocol implementation.

## Correctness boundary

Server writes are serialized and persisted through the WAL. Server reads can run concurrently. A transaction is atomic within one server process. Pub/Sub messages are live process-local events and are not durable records.

## Distributed systems boundary

Replication, consensus, failover, sharding, and cluster membership require multiple processes, node identity, durable replication logs, quorum rules, recovery procedures, and failure-injection tests. These features are separate distributed protocols and are not implied by a single `.ydb` file or a single server process.

## Design goal

YouData provides one general API across local embedded access and network access while keeping storage portable, dependencies minimal, and the correctness boundary explicit.

## WAL integrity

WAL v2 frames include a magic marker, payload length, CRC32 checksum, and JSON payload. Complete legacy frames remain readable for migration compatibility. An incomplete final frame is treated as a crash tail; a checksum failure in a complete frame is reported as corruption instead of silently discarding data.
