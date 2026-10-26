# D2 Canonical Memory Persistence

D2 adds the local, application-owned persistence boundary for Withu canonical relationship memory. It is implemented in `crates/withu-memory` over the SQLite transaction layer in `crates/withu-storage`; no third-party memory service or OpenViking runtime is required.

The database migration is additive and moves `PRAGMA user_version` from 0/1 to schema version 2. It creates a global memory state revision, scoped evidence, canonical objects, derived rows, dependency links and durable tombstones. A newer database version fails closed at startup. SQLite transactions include the state CAS, all rows and the minimum audit fact, so injected or real failures roll back together and reopen performs integrity and dependency checks. The persistence DTOs are described by `contracts/v1/memory-persistence.schema.json`, `contracts/v1/evidence-persistence.schema.json` and `contracts/v1/tombstone.schema.json`; the original P0 schemas remain unchanged.

Long-term memory accepts only `stable_fact`, `explicit_preference` and `explicit_experience` records with `confirmed=true`, explicit `save_permission=true`, a non-empty source evidence chain and exact object/state versions. Current-turn affect hypotheses are not accepted by the existing `MemoryStore`, and the persistent facade does not perform semantic extraction or automatic writes. Evidence is user-speaker, bounded, text-only and never stores raw audio, PCM or credentials.

The public facade supports:

- exact scope reads and phrase lookup;
- evidence and canonical memory correction with object and global CAS;
- relationship-summary and recoverable-item derived DTOs;
- background candidate capture and stale-revision rejection;
- deletion of an object or evidence with dependency invalidation, tombstones and ID reuse protection;
- restart-safe export that rejects credential and audio fields.

This batch intentionally does not add server IPC routes, GUI controls, renderer wiring or semantic retrieval. The remaining integration point is to map future `withu:memory:list`, `:correct` and `:delete` server handlers to `PersistentMemoryStore` while preserving the same scope, version, permission and tombstone checks.
