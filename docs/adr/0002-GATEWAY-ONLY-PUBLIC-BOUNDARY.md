# ADR 0002 — Gateway Is the Only New Public Integration Boundary

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Legacy products use different auth models and expose domain-specific contracts. Direct browser integration would leak topology, duplicate policy and prevent coherent audit, idempotency, authorization and client compatibility.

## Decision

All new browser, PWA, native, CLI and external clients use the versioned Unified Gateway. UNIUI never calls Hermes, AGENCY, DMM, WORKER, CHAT or MemoryV4 directly.

Enforcement uses same-origin routing, private service networking, CSP `connect-src`, service credentials available only to Gateway and automated browser-network tests. Legacy mutation APIs become private/protected only when their domain cutover is accepted and reversible.

## Consequences

- Central identity, RBAC, policy, audit, evidence and client schemas are enforceable.
- Gateway availability becomes a critical dependency and needs strong readiness/resilience.
- Existing applications remain usable during migration.
- Adapters must preserve owner truth rather than fabricate uniformity.

## Rejected alternatives

- Browser calls to each service: rejected for security and coupling.
- Immediate legacy shutdown: rejected because parity and rollback are not yet proven.
