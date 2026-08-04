# UNIFY Core

This directory is the clean implementation boundary for the standalone UNIFY control plane.

## Phase 1 status

Phase 1 intentionally contains only a compiled, tested service manifest. Business logic is added in later phases after the versioned contracts and database model are approved.

## Rules

- Native modules own identity, framework inventory, profiles, models, work, conversations, notifications, operations, and audit.
- Frameworks remain the source of truth for their runtime state; Core owns normalized control-plane state and orchestration.
- Production code in this directory must not import, call, proxy, or require any retired external control-plane application.
- No source code is copied from retired applications. Their behavior is recorded only in the capability inventory.
- Every mutation will use authorization, validation, idempotency/concurrency controls, operations, and audit as applicable.

## Commands

```bash
pnpm --filter @unify/core typecheck
pnpm --filter @unify/core test
```

See [`docs/rebuild/phase-01-scope.md`](../../docs/rebuild/phase-01-scope.md).
