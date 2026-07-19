# Source-of-Truth and Ownership Matrix

## Purpose

UNIFY normalizes access; it does not silently transfer ownership. Every API response identifies its owner, source status, observation time, generation time, and freshness. Gateway caches are derived state only.

## Matrix

| Entity or operation | Authoritative owner | Gateway role | Write rule |
|---|---|---|---|
| Framework identity, capabilities, health and framework-native events | Exact Hermes instance | Registry, normalization, provenance and aggregation | Capability required; no guessed health or availability. |
| Profile inventory, identity, model routing, runtime and Hermes usage | Exact Hermes instance | Policy and operation orchestration, preferably through a stable direct contract or proven Agency adapter | Exact framework/profile target; preflight and authoritative readback. |
| Provider/model availability and configured framework roles | Exact Hermes instance | Collision-safe normalized catalog | Global catalog is read-only; no seeded or fictional entries. |
| DMM encrypted credential records | DMM until an approved migration | Central authorization, policy and evidence correlation | Secret stays server-side. Vault deletion is not framework uninstall. |
| Catalog snapshots, diffs and DMM audit history | DMM | Read normalization and correlation | Preserve DMM provenance. |
| Worker project metadata, activation schedules, policy ceilings, approvals and rollback plans | WORKER | Normalize and cross-link to Hermes resources | Preserve Save versus Save-and-Start and Worker policy semantics. |
| Kanban boards/cards/lanes, execution, dispatcher and native cron | Hermes | Read and route through authoritative adapter | Never add a competing writer, scheduler or dispatcher. |
| Chat sessions/messages, attachments, mirror ingest, routes and outbound reconciliation | CHAT | Central identity/authz and normalized client contract | Route capability decides writability; mirror ingest never starts a duplicate turn. |
| Memory records, scopes, governance audit and retrieval events | MemoryV4 | Central principal mapping and safe facade | Initially only policy-permitted working/evidence writes; no arbitrary canonical/live creation or promotion. |
| Users, roles, permissions, sessions and external-client tokens | Gateway | Authoritative owner | Named identity, revocation, CSRF and scoped authorization. |
| Framework registrations and non-secret connection references | Gateway | Authoritative owner | Secrets remain in mounted secret files or secret manager. |
| Canonical resource mappings | Gateway | Authoritative owner of inspected mapping records | Stale, missing or ambiguous mapping blocks writes. |
| Operations, idempotency and cross-system correlation audit | Gateway | Authoritative owner | Every meaningful write has an operation lifecycle and evidence. |
| Event cursors, central notifications and UI preferences | Gateway | Authoritative owner unless explicitly delegated | Permission-aware, deduplicated and provenance-bearing. |
| Derived cache | Gateway, explicitly derived | Availability/performance optimization | Record source, observation, expiry and stale state; never masquerade as current authority. |

## Ownership invariants

1. A label is never a join key.
2. The owner named in an API response must be the system that supplied the authoritative observation.
3. Source outage never becomes an authoritative empty result or a fabricated zero.
4. Derived data is read-only while stale.
5. A write must target one exact owner and one exact framework where applicable.
6. Dual writes require a separately approved, idempotent and test-proven migration design.
7. Existing external-channel webhook and relay ownership remains singular.
8. MemoryV3 is not treated as MemoryV4, and no V3-to-V4 cutover is implied or approved.

## Ownership-change procedure

An ownership transfer requires an ADR, schema and semantic comparison, backup, reversible migration, shadow reads, consistency evidence, feature-flagged cutover, authoritative readback, and rollback rehearsal. UI uniformity alone is not a reason to migrate data.
