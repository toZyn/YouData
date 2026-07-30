# YouData Architecture

YouData is a general-purpose embedded database and network data platform. It is designed for applications, services, automation, analytics, content systems, games, collaboration tools, and social products without making any one use case the product boundary.

## Storage

The `.ydb` format is a single portable file with an append-only WAL, checkpointing, recovery, schemas, indexes, TTL metadata, and transactions. Direct file access is a single-process mode. Multi-process deployments use one server owner and network clients.

## Transports

- TCP newline-delimited JSON for low-overhead service-to-service access
- HTTP JSON for request/response integrations
- Native WebSocket frames for bidirectional events
- Pub/Sub channels for application events

All transports use the same operation model and authorization boundary.

## Data model

Collections accept JSON-compatible values, including objects, arrays, strings, numbers, booleans, and null. Object collections can use schemas and indexes. Built-in operations include key/value access, batch reads, compare-before-set semantics, counters, TTL, lists, sets, hashes, queries, and transactions.

## Query model

The current SQL endpoint provides a deliberately constrained compatibility layer for basic single-collection SELECT, INSERT, UPDATE, and DELETE statements. It is not a MySQL parser. The internal query model is the extension point for joins, grouping, aggregates, ordering, range indexes, and constraints.

## Distributed roadmap

Replication, consensus, failover, sharding, and cluster membership require multiple processes and failure-injection tests. They must be implemented as explicit protocols rather than claimed from a single-file server. Until those protocols are implemented and tested, the server is authoritative for one database process and can be placed behind an application-level load balancer.

## Correctness boundary

Writes are serialized by the server and persisted through the WAL. Reads are served concurrently. Atomicity applies to a transaction submitted to one server. Cross-node durability, distributed transactions, and automatic failover are not implied by this mode.
