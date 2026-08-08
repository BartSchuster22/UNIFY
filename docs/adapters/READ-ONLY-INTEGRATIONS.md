# Retired Read-Only Integrations

The migration-only integration subsystem has been deleted.

Production and local runtime no longer contain:

- legacy read adapters or adapter SDK clients;
- owner HTTP clients or login/session handling;
- integration refresh, normalized-resource, cross-owner search, event federation, or shadow-comparison routes;
- Agency, DMM, Worker, or `/CHAT` connection settings;
- feature flags capable of re-enabling migration readers.

The dedicated governed MemoryV4 boundary added later is specified independently in
[MEMORY-V4.md](MEMORY-V4.md). It is an exact route allowlist, not this retired
federation subsystem.

The retired Gateway routes return `404`:

- `/api/v1/integrations`
- `/api/v1/resources`
- `/api/v1/search`
- `/api/v1/events`
- `/api/v1/shadow`

Current runtime sources are native Core PostgreSQL state, Gateway access-plane PostgreSQL state, and explicitly registered Hermes framework control endpoints. Historical migration reports remain evidence only and are not operational instructions.

Run `pnpm standalone:check` to enforce this boundary.
