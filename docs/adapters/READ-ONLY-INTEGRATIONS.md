# Phase 3 read-only integrations

> **MIGRATION-ONLY:** These adapters read legacy applications for import/parity diagnostics. They are not authoritative Hermes adapters, cannot establish framework truth, and have `writeEnabled: false`.

## Ownership and scope

UNIFY federates legacy snapshots without becoming a second owner. Every normalized item carries `authoritative: false`, `sourceRole: migration-only`, a provenance `ResourceRef`, adapter ID, source version when available, observation time, fetched time, truth state, searchable text, and recursively redacted source data.

| Adapter | Migration-only reads | Default host endpoint |
|---|---|---|
| `agency-hermes-read-v1` | Agency frameworks; Hermes profiles through Agency inventory | `http://127.0.0.1:18082` |
| `dmm-read-v1` | Providers, models, catalog snapshots | `http://127.0.0.1:4100` |
| `worker-read-v1` | Projects, Kanban boards, tasks, cron jobs, notification inbox | `http://127.0.0.1:8891` |
| `memory-v4-read-v1` | Records and owner-native search | deployment-specific; local default `http://127.0.0.1:18804` |

The only upstream POST used by these adapters is login for Agency and DMM session authentication. No domain resource is created, edited, deleted, activated, scheduled, dispatched, or acknowledged.

## Gateway routes

- `GET /api/v1/integrations` — visible integration status.
- `GET /api/v1/resources?owner=&kind=&cursor=&limit=&refresh=` — normalized resources.
- `GET /api/v1/search?q=&owner=&kind=&cursor=&limit=` — cross-owner search plus MemoryV4 owner-native search.
- `GET /api/v1/events?cursor=&limit=` — bounded unified observation and shadow events.
- `GET /api/v1/notifications?cursor=&limit=` — Worker notifications and truthful source-failure notices.
- `GET /api/v1/shadow?owner=` — direct owner readback comparison with evidence hash.

Collection limits default to 100 and accept 1–500. Cursors are opaque and versioned. An invalid or no-longer-valid cursor is rejected rather than silently restarting a page.

## Truth handling

- `current`: every configured collection was read successfully and at least one resource exists.
- `empty`: every configured collection was read successfully and the owner returned no resources.
- `partial`: one or more collections succeeded and one or more failed.
- `unavailable`: the adapter is not configured or every configured collection failed.
- `failed`: an unexpected adapter-level failure was contained by the federation service.

Failures produce bounded, secret-free warning codes. They are never converted to a successful empty result. One failing owner does not hide healthy owners.

## Credentials

Gateway accepts direct variables or `_FILE` equivalents:

| Source | URL | Credentials |
|---|---|---|
| Agency | `AGENCY_URL` | `AGENCY_USERNAME`, `AGENCY_PASSWORD` |
| DMM | `DMM_URL` | `DMM_USERNAME`, `DMM_PASSWORD` |
| Worker | `WORKER_URL` | optional `WORKER_TOKEN` |
| MemoryV4 | `MEMORY_V4_URL` | `MEMORY_V4_TOKEN` |

Compose mounts all credentials as files. `pnpm compose:secrets` creates permission-restricted empty integration files without copying credentials from authoritative repositories. Operators must populate only the required files. Values are never emitted by the preparation script. Local Compose runs Gateway on the host network, binds it to `127.0.0.1`, and publishes PostgreSQL only on `127.0.0.1` so it can read owner services that themselves intentionally listen only on host loopback.

## Shadow comparison

A cached UNIFY normalized snapshot is compared with a new direct read from the same adapter. Comparison fingerprints include canonical identity and redacted authoritative data while excluding fetch/observation timestamps. Evidence reports counts plus missing, unexpected, and changed canonical IDs and a SHA-256 evidence hash.

A source outage returns `unavailable`, not `match`. Drift creates a `shadow.comparison.mismatch` event. Shadow is read-only and requires `audit.read` or `operations.read` in addition to owner read access.

## Security boundaries

- Named Gateway session required.
- Owner-specific RBAC filters all resources, search hits, events, statuses, and notifications.
- Secrets and credential-like fields are recursively replaced with `[REDACTED]` before caching, searching, hashing, or returning data.
- Bounded upstream deadlines, read retries, rate-limit handling, and circuit breaking come from `@aquiero/adapter-sdk`.
- Source bodies are treated as untrusted data.
- No production cutover or write ownership transfer is implied.
