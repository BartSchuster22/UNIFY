# UNIFY

Aquiero's unified Hermes Gateway and Mantine operator UI.

UNIFY provides one authenticated, policy-controlled API boundary and one operator experience across Hermes-native resources and the existing AGENCY, DMM, WORKER, CHAT, and MemoryV4 domains. It is implemented as a strangler migration: existing applications remain usable until each domain cutover is independently accepted and reversible.

## Non-negotiable rules

- New browser and focused-app clients communicate only with the Unified Gateway.
- Hermes remains authoritative for Hermes-native state.
- Domain-owned state remains with its explicit owner until a reviewed migration changes that boundary.
- Unsupported, unavailable, stale, partial, empty, forbidden, failed, and current are distinct states.
- Rendering a route never mutates state.
- Important writes require capability and policy checks, exact-payload preflight, explicit confirmation, idempotency, optimistic concurrency, authoritative execution, and readback verification.
- UNIFY does not introduce a second Kanban writer, scheduler, dispatcher, webhook owner, or chat responder.
- Existing production resources are not mutated during discovery or ordinary verification.

## Phase 1 documentation

- [Discovery and contract-bootstrap report](docs/discovery/PHASE-1-REPORT.md)
- [Complete building plan](docs/plans/BUILDING-PLAN.md)
- [Source-of-truth matrix](docs/architecture/SOURCE-OF-TRUTH.md)
- [Canonical resource identity](docs/architecture/RESOURCE-IDENTITY.md)
- [Capability and truth contract](docs/contracts/CAPABILITY-AND-TRUTH-CONTRACT.md)
- [`/api/v1` outline](docs/contracts/API-V1-OUTLINE.md)
- [Initial threat model](docs/threat-model/INITIAL-THREAT-MODEL.md)
- [Baseline authorization matrix](docs/security/AUTHORIZATION-MATRIX.md)
- [Architecture decisions](docs/adr/)
- [Sanitized discovery evidence](docs/evidence/discovery-manifest.json)

## Planned deployables

```text
apps/gateway       Unified API, identity, policy, operations, audit and adapters
apps/uniui         Mantine browser operator application
apps/chat-pwa      Focused Chat PWA using shared packages
apps/alerts-pwa    Focused Alerts PWA using shared packages
packages/*         Contracts, generated SDK, auth/events/resource refs and UI components
```

## Status

Phase 1 — Repository and contract bootstrap: documentation baseline committed. No product implementation or production cutover is implied by this status.
