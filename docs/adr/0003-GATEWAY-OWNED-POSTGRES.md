# ADR 0003 — PostgreSQL Stores Only Gateway-Owned Durable State

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

UNIFY needs durable named identity, sessions, mappings, operations, audit correlation, idempotency, event cursors, notifications and preferences. Copying full downstream inventories would create a competing source of truth.

## Decision

Use PostgreSQL 16 for Gateway-owned durable state. Downstream inventories remain with their owners. Any derived cache table records owner/provenance, observation time, expiry and stale state and is never authoritative.

Gateway-owned categories:

- users, roles, permissions and scopes;
- sessions, refresh tokens and revocations;
- framework registrations and non-secret references;
- resource mappings;
- operations and idempotency;
- central audit/correlation and evidence references;
- event cursors and notifications;
- app registrations and UI preferences.

## Consequences

- PostgreSQL backup/restore and migration evidence are production gates.
- Adapter reads remain necessary for current truth.
- Outage behavior must distinguish unavailable source from stale derived cache.
- Domain data migration requires a separate ADR and cutover procedure.

## Rejected alternatives

- One universal replicated inventory database: rejected as duplicate ownership.
- SQLite for Gateway production: rejected due central multi-client concurrency, session and operation requirements.
