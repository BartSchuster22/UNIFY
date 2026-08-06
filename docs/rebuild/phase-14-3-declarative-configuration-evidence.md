# Phase 14.3 Declarative Configuration and Registration Evidence

**Status:** PASS
**Date:** 2026-08-06 UTC
**Production changed:** No

## Declarative installation inputs

`deploy/five-service/installation-inputs.example.json` defines the versioned `unify-five-service-installation/v1` input contract. It owns all installation-specific values that were previously implicit or tied to ALICA-v1 paths:

- release identity;
- public host and origin;
- separate Alica and Herman data paths;
- secrets and backup paths;
- PostgreSQL and Caddy volume names;
- immutable digest references for the Hermes runtime, Core, and Caddy images.

`scripts/validate-five-service-installation.mjs` rejects unknown fields, relative/root/overlapping paths, duplicate volumes, invalid hosts/origins, mutable image references, and malformed release IDs. Its successful result is a non-secret Compose environment map for the Phase 14.4 installer.

```text
$ node scripts/validate-five-service-installation.mjs deploy/five-service/installation-inputs.example.json
{"schemaVersion":"unify-five-service-installation/v1","valid":true,"composeEnvironment":{...}}
```

No secret value is accepted by or emitted from this installation declaration.

## Declarative framework registrations

`deploy/five-service/frameworks.json` is the versioned `unify-framework-registrations/v1` source of truth for the two local endpoints:

| Framework | Endpoint | Core auth reference |
|---|---|---|
| `hermes-alica` | `https://alica:28082` | `env:ALICA_FRAMEWORK_TOKEN` |
| `hermes-herman` | `https://herman:28082` | `env:HERMAN_FRAMEWORK_TOKEN` |

Each declaration pins:

- framework identity and display name;
- control endpoint;
- a secret reference, never a token value;
- granted scopes;
- `hermes-control/v1`;
- Hermes `0.20.0`;
- upstream commit `b8b17b8cee50b85adb7fba6ea332dc06731b86f4`;
- enabled state.

The declaration is embedded read-only in the Core image. `reconcile-frameworks` runs as an ephemeral hardened Compose job on only the database and two control networks. Before writing, it:

1. strictly validates the versioned declaration;
2. rejects duplicate identities and reused auth references;
3. resolves token secret files without exposing references through the public API;
4. probes identity, version, and capabilities over authenticated TLS;
5. validates the observed framework ID, contract, release, and commit, while the declaration schema constrains allowed scopes;
6. upserts only when desired registration state differs.

An exact reinstall still performs the fail-closed probe but preserves `created_at`, `updated_at`, `verified_at`, the registration row, and the audit chain. Reconciliation is serialized by a PostgreSQL advisory lock. A changed declaration emits one immutable `framework.reconcile` audit event containing only a declaration digest and safe contract/provenance metadata. If a prior run stopped between registration and audit persistence, the next run repairs the missing evidence without rewriting the converged registration. An already evidenced no-op emits no audit event.

## Least-privilege adapter database roles

Migration `007_framework_adapter_roles` creates:

- non-login grant role `unify_hermes_adapter_runtime`;
- login identities `unify_alica_adapter` and `unify_herman_adapter`, initially disabled with `NOLOGIN`.

The runtime grant is restricted to:

- database connection;
- `USAGE` on the application schema;
- `SELECT`, `INSERT`, and `UPDATE` on the three adapter event/idempotency/audit tables;
- required identity-sequence usage.

It receives no Core users, sessions, registrations, governance, notification, project, work, or conversation table privileges; no `DELETE`, DDL, database creation, role creation, replication, or superuser capability.

The `reconcile-database-roles` job validates that both supplied database URLs target the Core database with the exact expected role identities. On fresh installation it activates each role and installs its supplied password. On reinstall it authenticates with the existing secret and performs no password rewrite. It fails closed if the existing secret no longer authenticates, rather than silently replacing it. Runtime verification also deliberately queried `framework_registrations` through each adapter role and required PostgreSQL permission denial.

## Backup and QA topology

`scripts/backup-gateway.sh` now:

- targets Compose service `unify-postgres` rather than the retired `postgres` service assumption;
- accepts the Compose file and project as installation inputs;
- records all three five-service image IDs;
- captures the resolved five-service Compose manifest;
- includes migration and declarative-framework checksums in the encrypted archive.

The old ALICA-v1 deployment snapshot was not rewritten or activated.

## Checksums

```text
22ca30a63c5d1541fc30e9a4ce0396445a88c3151ab97e96b98076770fca3359  deploy/five-service/frameworks.json
7d93a64c57a6995e2ab1d7c7f06c23e34a7eef267d8df0dc80d4c3e5a39e9276  deploy/five-service/installation-inputs.example.json
7b1403611cf6b5adc9ea3f65d386b1d0af4a48d70a20b775dc43ce8948ac8f5c  apps/gateway/migrations/007_framework_adapter_roles.up.sql
34fd99dabd49e669127b164990b138e585a315c1daa28ea65f19361995040558  scripts/backup-gateway.sh
```

Tested Core image:

```text
sha256:546f6fbd7c84d4c4707515d775e68502206564d02a22e4fc88f9859b8da8ec73
```

## Unit and static gates

```text
$ pnpm --filter @aquiero/gateway typecheck
PASS

$ pnpm --filter @aquiero/gateway test
Test Files  11 passed (11)
Tests       62 passed (62)

$ pnpm five-service:check
Five-service Compose static and security contract: PASS
```

Tests cover strict declaration parsing, duplicate/reused-reference rejection, authenticated pinned registration, unavailable credentials, invalid endpoints, identity mismatch, and no-write exact reconciliation.

## Fresh install, reinstall, and restart acceptance

```text
$ FIVE_SERVICE_SKIP_CADDY_BUILD=1 pnpm five-service:verify
Five-service Compose clean-fixture acceptance: PASS project=unify-phase143-3257110-1786011315429 containers=5 ports=42909,37619
```

The clean-fixture gate performed:

1. migration through `007_framework_adapter_roles`;
2. first database-role reconciliation: exactly two changes;
3. same-version database-role reconciliation: zero changes;
4. verification that both password verifiers were unchanged;
5. startup of the exact five steady-state services with separate adapter database credentials;
6. first framework reconciliation: exactly two registrations and two safe audit events;
7. same-version framework reconciliation: zero changes;
8. byte-equivalent registration timestamps/evidence and unchanged audit count;
9. TLS identity probes from Core to Alica and Herman;
10. complete five-container restart and return to healthy;
11. post-restart database-role and framework reconciliation: zero changes;
12. post-restart proof that password verifiers remained unchanged;
13. fixture removal with no retained one-shot containers.

This proves fresh install, same-version reinstall, and restart convergence without duplicate registrations, password replacement, secret exposure, or unexpected registration/audit mutation.

## Repository QA

```text
$ pnpm qa
PASS
```

The complete repository gate passed lint, TypeScript checking, 62 Gateway tests plus all other workspace tests, all production builds, generated-contract reproducibility, standalone runtime boundaries, backup retention, identity capacity, production canary self-test, and formatting.

## Scope boundary

Phase 14.3 supplies validated declarations and idempotent reconciliation primitives. Phase 14.4 remains responsible for the non-interactive installer/upgrade/rollback orchestration that materializes paths and secret files, invokes these jobs in order, and records a release manifest. No production path, secret, database, Compose project, backup schedule, or running container was changed in this phase.
