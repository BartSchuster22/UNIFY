# UNIFY Core

This directory is the clean implementation boundary for the standalone UNIFY control plane.

## Current status

Phase 1 established the isolated package boundary. Phase 2 added native Core v1 contracts and capability negotiation. Phase 3 added the fresh PostgreSQL schema, checksum-locked migration runner, durable event/cursor foundation, concurrency controls, and tamper-evident audit chain. Phase 4 adds production authentication: one-shot administrator bootstrap, Argon2id passwords, opaque sessions, strict CSRF, throttling and locking, password history and revocation, scoped RBAC, replay-resistant TOTP MFA, service credentials, and complete authentication auditing.

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
pnpm --filter @unify/core auth:test
pnpm --filter @unify/core test
CORE_DATABASE_URL='postgresql://...' CORE_DATABASE_SSL=require pnpm --filter @unify/core db:migrate
CORE_DATABASE_URL='postgresql://...' CORE_DATABASE_SSL=require pnpm --filter @unify/core db:verify
# After migration, with CORE_AUTH_* secrets and bootstrap identity variables injected:
pnpm --filter @unify/core auth:bootstrap
```

See [`phase-03-database-foundation.md`](../../docs/rebuild/phase-03-database-foundation.md) and [`phase-04-authentication.md`](../../docs/rebuild/phase-04-authentication.md).
