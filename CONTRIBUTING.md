# Development rules

1. Add product decisions only to the authoritative v3 specification before changing a
   contract here.
2. Keep server state authoritative. Renderer and window packages may cache views but
   must not own task, memory, approval, or provider state.
3. Every persisted object and event carries a schema version. Breaking changes create
   a new contract version; compatibility shims for earlier products are out of scope.
4. Provider credentials are references to the OS credential store. Never place a
   secret value in bridge payloads, logs, memory, fixtures, or exports.
5. Run the complete build and check command list in `README.md` before committing.

