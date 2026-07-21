# Hermes Control Contract v1

**Status:** Frozen for UNIFY Phase 1  
**Contract identifier:** `hermes-control/v1`  
**Supported Hermes release:** `0.18.0`  
**Supported Hermes commit:** `9e54eee44f1cbbe62247a36546e51ff8940373c6`

## Immutable-framework boundary

`hermes-control/v1` is a **UNIFY-owned adapter contract**. It is not an API that Hermes must implement, ship, import, or know about. Hermes Agent is an immutable external authority from UNIFY's perspective. All discovery, translation, compatibility handling, registration, authentication, pagination, source-version derivation, and event reconciliation required by this contract live in UNIFY-side adapter code.

UNIFY may use only Hermes interfaces that already exist and are independently supported by Hermes, such as its existing API, CLI, gateway, or read-only authoritative stores. A missing operation remains `unsupported`; it is never a reason to patch Hermes toward UNIFY. No file in a Hermes repository is changed by this phase.

## Baseline reconciliation

The supported baseline was selected from the clean tracked tree of the locally carried Hermes repository at `/home/herman/.hermes/hermes-agent`. The installed CLI identifies release `0.18.0 (2026.7.1)` and the carried commit `9e54eee4`. The separate live-lane checkout contains older Agency-specific control work plus pre-existing uncommitted changes; its contract identifier (`2026-07-full-agency-integration-v1`), routes, and mutable working tree are not a supported UNIFY control baseline.

UNIFY therefore fails closed unless all three values match exactly:

- contract: `hermes-control/v1`
- release: `0.18.0`
- commit: `9e54eee44f1cbbe62247a36546e51ff8940373c6`

This freeze does **not** claim that every domain capability can already be reached through existing Hermes interfaces. The pinned fixture reports unavailable operations as `unsupported`. Later UNIFY work may implement adapter support around existing Hermes surfaces; it must not add UNIFY-specific code or contracts to Hermes.

## Required UNIFY adapter endpoints

| Method | Path                       | Purpose                                                                   |
| ------ | -------------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/control/v1/identity`     | Stable source-framework and instance identity                             |
| `GET`  | `/control/v1/health`       | Safe health state and named checks                                        |
| `GET`  | `/control/v1/version`      | Release, full commit, upstream base, dirty state, and runtime version      |
| `GET`  | `/control/v1/capabilities` | Per-operation support, modes, scopes, reason, and constraints              |
| `GET`  | `/control/v1/events`       | Adapter replay/reconciliation stream; `Last-Event-ID` supports resumption |

Domain collections use cursor pagination with `items`, `page.hasMore`, and optional `page.nextCursor`. Commands use the frozen `HermesControlCommand` envelope with mode, idempotency key, expected source version, request/correlation IDs, actor, and payload.

## Envelope invariants

Every successful response carries:

- `contractVersion`
- `frameworkId`
- `frameworkVersion`
- full `frameworkCommit`
- `sourceVersion`
- `observedAt`
- typed `data`

Capability status is one of `supported`, `unsupported`, `unavailable`, or `forbidden`. These states are not interchangeable. A missing capability is treated as unsupported.

Events carry framework/version identity, durable event ID, monotonic sequence, source version, classification (`durable` or `ephemeral`), timestamp, optional correlation/operation/run IDs, and payload. Adapter events are derived access-plane evidence; Hermes remains the domain source of truth.

## Authentication and registration

Framework registration stores only an `env:NAME` service-auth reference and scoped grants. Raw credentials are rejected by schema and never returned by APIs or audit metadata. Registration requires an authenticated `settings.manage` principal and matching CSRF token. Reads require `frameworks.read`.

A registration points to a UNIFY-side adapter endpoint, not to a new Hermes API. It is persisted only after authenticated probes of identity, version, and capabilities validate against the frozen schemas and exact Hermes baseline. HTTPS is mandatory except for loopback HTTP fixtures. URL credentials, paths, query strings, fragments, redirects, unavailable auth references, probe failures, identity mismatch, and unsupported versions all fail closed.

Legacy Agency, DMM, Worker, and CHAT registrations remain outside this registry path and retain migration-only status.

## Verification fixture

`fixtures/hermes-control/pinned-baseline.json` and `scripts/hermes-pinned-fixture.mjs` implement a UNIFY-owned adapter fixture around a real Git checkout whose tracked tree is clean and whose `HEAD` equals the pinned full commit. The fixture reads Git/runtime identity and never writes to the Hermes checkout. `scripts/verify-hermes-pinned-contract.mjs` performs authenticated HTTP validation for identity, version, and capabilities and proves unauthenticated access is rejected.
