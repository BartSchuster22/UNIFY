# Core PostgreSQL Migrations

These are the fresh, forward-only migrations for standalone UNIFY Core. They do not import or modify any legacy application schema.

## Rules

1. Applied migration files are immutable. The runner stores and verifies a SHA-256 checksum.
2. New changes use the next contiguous three-digit version.
3. Each migration runs in its own transaction under a session-scoped advisory lock.
4. There are no destructive automatic down migrations.
5. Production uses a dedicated migration-owner credential. Runtime grants are provisioned separately and must not include schema ownership.
6. PostgreSQL 16 is the supported baseline.

## Commands

```bash
CORE_DATABASE_URL='postgresql://...' CORE_DATABASE_SSL=require \
  pnpm --filter @unify/core db:migrate

CORE_DATABASE_URL='postgresql://...' CORE_DATABASE_SSL=require \
  pnpm --filter @unify/core db:verify
```

`CORE_DATABASE_SSL` defaults to `require`. Local isolated tests must explicitly select `disable`.

Migration `006_authentication_runtime.sql` is the Phase 4 authentication delta. It extends the Phase 3 identity tables with password/session runtime state, replay-resistant MFA counters, password history, atomic throttle buckets, the one-shot bootstrap singleton, the MFA key registry, and authentication-specific permissions. Like every migration in this directory, it is forward-only and checksum locked after application.
