# UNIFY Core

This directory is the clean implementation boundary for the standalone UNIFY control plane.

## Current status

Phase 1 established the isolated package boundary. Phase 2 adds the native Core v1 TypeBox contracts, executable Hermes capability negotiation, and generated OpenAPI 3.1 document. Business persistence and service handlers are added in later phases against these contracts.

## Rules

- Native modules own identity, framework inventory, profiles, models, work, conversations, notifications, operations, and audit.
- Frameworks remain the source of truth for their runtime state; Core owns normalized control-plane state and orchestration.
- Production code in this directory must not import, call, proxy, or require any retired external control-plane application.
- No source code is copied from retired applications. Their behavior is recorded only in the capability inventory.
- Every mutation will use authorization, validation, idempotency/concurrency controls, operations, and audit as applicable.

## Commands

```bash
pnpm --filter @unify/core typecheck
pnpm --filter @unify/core generate:contracts
pnpm --filter @unify/core check:contracts
pnpm --filter @unify/core test
```

See [`docs/rebuild/phase-02-versioned-contracts.md`](../../docs/rebuild/phase-02-versioned-contracts.md).
