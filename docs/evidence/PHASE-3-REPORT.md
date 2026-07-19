# Phase 3 verification — read-only integrations

Date: 2026-07-19

## Result

Phase 3 read-only federation is implemented and verified without production resource mutations or owner cutover.

## Delivered

- Provenance-rich normalized resources and collision-safe canonical IDs.
- Agency/Hermes, DMM, Worker, Chat, and MemoryV4 read adapters.
- Unified integration status, resources, search, events, notifications, and shadow APIs.
- Owner-specific RBAC and named-user enforcement.
- Opaque cursor pagination with bounded page sizes.
- Explicit current/empty/partial/unavailable/failed truth states.
- Recursive secret redaction before caching, indexing, evidence hashing, or output.
- Owner readback shadow comparison with stable SHA-256 evidence.
- OpenAPI and generated TypeScript SDK updates.

## Automated evidence

- Full TypeScript typecheck: passed.
- Full workspace build: passed.
- Gateway tests: 31 passed; 42 repository tests passed in total.
- Contract tests cover authenticated reads, malformed/degraded collections, collision-safe identity, secret removal, Chat expansion, unified search/events/notifications, drift detection, and route RBAC.

## Live authoritative comparison

A real read-only probe used each live owner endpoint and the actual configured authentication mechanism. MemoryV4 was verified in its Python 3.12 container against an isolated ephemeral database because no production MemoryV4 service was listening locally. One marker record was created only in that temporary container.

| Owner | Source status | Expected | Direct readback | Shadow | Drift |
|---|---:|---:|---:|---|---:|
| Agency | current | 1 | 1 | match | 0 |
| Hermes | current | 6 | 6 | match | 0 |
| DMM | current | 312 | 312 | match | 0 |
| Worker | current | 11 | 11 | match | 0 |
| Chat | current | 6,806 | 6,806 | match | 0 |
| MemoryV4 | current | 1 | 1 | match | 0 |

Observed resource kinds included frameworks, profiles, providers, models, catalog snapshots, projects, Kanban boards, tasks, cron jobs, Chat sessions/messages/routes, and MemoryV4 records.

The first probe used incorrect host ports for Agency, DMM, and Worker and truthfully returned `unavailable`; correcting the deployment configuration produced current source states and zero-drift comparisons. No failure was hidden as an empty success.

The hardened Compose stack was then rebuilt and exercised through the real named-user Gateway boundary. Login, paginated resources, integration status, and shadow routes all returned HTTP 200; all five adapters reported `current`, all six owners reported `match`, and a five-item page truthfully returned `hasMore: true`.

## Non-effects

- No existing Agency, DMM, Worker, Chat, Hermes, or MemoryV4 production record was changed.
- No scheduler, dispatcher, Kanban writer, chat responder, webhook, provider catalog, or profile ownership moved to UNIFY.
- No deployment activation or production traffic cutover occurred.
