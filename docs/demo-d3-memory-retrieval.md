# D3 memory retrieval, bounded context and management

D3 connects D2's canonical memory store to the actual server, preload/IPC bridge,
development preview and Settings → Data controls. `withu:memory:list`, `:context`,
`:save`, `:correct` and `:delete` use the server's existing exclusive SQLite connection.
They do not reopen or weaken the database's lifetime owner lock.

Management shows scoped records, object/state versions, evidence excerpts and
versions, explicit save permission, validity and the complete deletion impact.
Correction requires both CAS versions. Confirmed deletion tombstones the memory,
its source evidence, shared dependants and transitive derived references. The
impact projection follows that same graph. A deleted ID cannot be corrected back
into existence. Pending operations disable scope/retrieval controls and old list
responses are discarded. Chinese and English use the existing language setting;
controls have labels, keyboard focus indicators, error alerts and status regions.

`MemoryIndex` is the replaceable retrieval adapter interface. The default
`LocalMemoryIndex` supports local exact phrase matching and returns
`semantic_index_unavailable` for semantic requests. The GUI displays that state
with no substituted or inferred results. There is no embedding model, semantic
service, paid provider request or external memory runtime in this implementation.

Comfort text replies and independently generated realtime replies receive at most
six active, open-ended confirmed memory records, capped at 6,000 serialized fact
characters. Facts contain their IDs, object versions and evidence references;
they are quoted as data and current user wishes take priority. Other scopes do
not inherit Comfort memory. Correction or deletion cancels affected text replies
and ends active Comfort realtime sessions so their stale snapshots cannot keep
running. The next explicitly started request reloads the current facts.

Settings → Data controls includes a small explicit-entry form for stable facts,
preferences, and experiences. The form is an unsaved candidate until the user
checks the initially unchecked permission box and submits. Editing the candidate
clears that permission. `withu:memory:save` strictly accepts only these text fields,
the allowed kind, explicit true permission, scope, and the global CAS version.
The server generates IDs, timestamps, confirmation, and user-entry evidence, then
atomically writes memory and evidence through the existing SQLite owner. Failed
commits leave neither record behind. Client-supplied evidence, audio/transcript
fields, affect hypotheses, denied scopes, and stale state versions are rejected.

The management/context path accepts only eligible canonical records. Unconfirmed
affect, missing save permission, token/audio fields and stale source versions are
rejected. No automatic candidate extraction or Live transcript persistence is
connected. Live still stores only call-duration summaries. Users can explicitly
enter necessary facts in Settings; automatic collection from conversations remains
outside this Demo boundary.

## Repeatable isolated validation

Run from the D3 worktree:

```powershell
node checks/memory-save-rpc.mjs
node checks/memory-rpc.mjs
node checks/memory-context-wire.mjs
node checks/memory-gui.mjs
node checks/memory-preview.mjs
```

The existing fixture replays create fresh data under `output/d3/` with a
`D3_TEST_FIXTURE` marker. The explicit-save RPC replay uses a fresh OS temporary
directory and no seeded records. It covers atomic rollback, permission/schema
rejection, CAS, restart, correction, deletion and anti-resurrection.
The RPC replay covers empty/positive/exact reads, context bounds, scope isolation,
semantic unavailable, correction CAS and permission failures, deletion cascade,
restart, durable tombstones, anti-resurrection and actual server disconnection.
The context replay checks the real outgoing HTTP and independent realtime
WebSocket payloads at local controllable endpoints, including corrections,
deletions and Live transcript exclusion. Those are transport assertions, not a
claim about a real cloud model's response quality or physical audio behavior.
The GUI check uses Electron with the real preview owner/server, tests correction,
confirmed deletion, errors, English/Chinese and token/origin rejection, and saves
screenshots plus `results.json`.

`node checks/memory-preview.mjs` serves
`http://127.0.0.1:4176/#/settings/data-privacy`. The page explicitly says D3 test
preview / isolated fixture / real local server. All memory operations go to the
actual Rust backend. Startup fails if the backend cannot start; RPC failure is
shown as an error and never replaced with simulated success. Stop with Ctrl+C.

Semantic indexing remains unavailable: there is no configured embedding provider
or model. Exact matching is not presented as semantic search. Automatic candidate
collection remains outside this Demo; explicit confirmation and canonical saving
are connected through Settings. Real cloud voice behavior remains
an independent authorized device/provider acceptance step. No package or version
changes are included in D3.
