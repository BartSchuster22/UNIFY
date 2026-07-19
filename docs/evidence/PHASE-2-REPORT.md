# Phase 2 — Gateway Foundation Verification

**Scope:** repository/build foundation, canonical contracts and SDK, Gateway-owned PostgreSQL, identity/security, governance records, adapter resilience, and hardened local containers.

## Delivered increments

| Capability | Verification |
|---|---|
| Reproducible pnpm/TypeScript monorepo | pinned Node/pnpm, frozen lockfile, workspace boundaries, lint/typecheck/test/build/format gates |
| OpenAPI 3.1 and generated SDK | canonical contract generation and clean-tree reproducibility check |
| PostgreSQL migrations | PostgreSQL 16 clean apply, rollback, reapply, advisory lock, governance guard migration |
| Named users and sessions | scrypt+pepper passwords, opaque server-side sessions, only token hashes persisted |
| RBAC, CSRF, revocation | server permission resolution, session-bound double-submit CSRF, immediate revocation |
| Audit and operations | canonical payload hashes, idempotent replay/conflict, lifecycle transitions, immutable evidence/audit records, recursive redaction |
| Adapter SDK | deadline/cancellation, safe bounded retry, idempotency-aware mutations, circuit breaker, normalized failures, protocol checks |
| Containers and Compose | non-root, read-only rootfs, capability drop, no-new-privileges, health checks, secret files, loopback ports |

## PostgreSQL and live HTTP evidence

Migration integration previously verified:

```text
tables=22 permissions=21 roles=4
tables_after_rollback=0
reapply_count=1
immutable_triggers=3
migrations=2
```

PostgreSQL-backed authentication previously verified:

```text
ready=200
login=200
me=200
admin_role=true
logout_without_csrf=403
logout_with_csrf=204
me_after_revocation=401
```

Governance integration previously verified:

```json
{"created":"created","replayed":"replayed","conflict":true,"state":"verified","evidenceRedacted":true,"auditImmutable":true}
```

## Container verification — 2026-07-19

Images:

```text
unify-gateway:local built
unify-uniui:local built
deployed-runtime-import=ok
```

A real local Compose start completed with PostgreSQL and migrations ordered before Gateway and Gateway healthy before UNIUI. Runtime probes returned:

```text
gateway_ready=200
uniui_health=200
uniui_proxy_ready=200
login_status=200
me_status=200
role=Administrator
logout_status=204
me_after_logout=401
```

Runtime isolation returned:

```text
postgres uid=70 gid=70 rootfs_readonly=ok
Gateway uid=10001 gid=10001 rootfs_readonly=ok
UNIUI uid=10001 gid=10001 rootfs_readonly=ok
readonly=true capdrop=["ALL"] security=["no-new-privileges:true"] health=healthy
```

The one-time Compose bootstrap created named administrator `admin` without printing its password. Secrets were supplied from ignored local files with owner-only modes and explicit container-UID ACLs.

## Security boundary

No legacy production service was changed. PostgreSQL is private to the Compose network; public test bindings are loopback-only. The Gateway remains the sole API boundary exposed to UNIUI, whose same-origin proxy forwards `/api/*`. Secret values are absent from this report and repository.

## Final repository QA

A clean-artifact run (`pnpm clean && pnpm qa`) passed:

```text
lint and workspace boundaries: passed
typecheck: passed
Gateway tests: 24 passed
Adapter SDK tests: 7 passed
Contract tests: 3 passed
Generated SDK tests: 1 passed
production builds: passed
OpenAPI/SDK reproducibility: passed
formatting: passed
JSON files parsed: 19
Markdown files checked: 19, local links valid
secret scan: passed; local secret values absent
Docker Compose config validation: passed
git diff --check: passed
```

## Acceptance

Phase 2 is accepted when the committed push, remote-HEAD equality, and clean working tree checks succeed. Final Git evidence is recorded in the completion response.
