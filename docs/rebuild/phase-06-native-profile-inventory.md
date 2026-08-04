# Phase 6 — Native Inventory and Profile Lifecycle

## Status

Phase 6 makes profile and agent inventory a standalone Core capability. Core persists its own desired state and normalized projections while Hermes remains authoritative for native profile execution and observed runtime inventory. Agency is not a runtime owner, fallback, adapter, credential source, route, or deployment dependency.

## Ownership boundary

- Hermes owns native profile existence, native profile mutation execution, runtime profile metadata, and the authoritative source version.
- The UNIFY-owned Hermes control adapter translates the pinned native Hermes CLI into strict `hermes-control/v1` reads and commands without modifying Hermes.
- Core owns framework-linked canonical agents and profiles, assignments, desired state, observed projections, protection policy, optimistic resource versions, reconciliation evidence, and lifecycle evidence.
- Gateway does not route profile reads or writes through Agency. Historical Agency rows can remain in migration test fixtures, but production TypeScript rejects that owner and contains no Agency runtime configuration.

## Native control contract

The adapter exposes:

```text
GET  /control/v1/profiles
POST /control/v1/commands/profiles
```

Supported command operations are:

- `profile.create`
- `profile.update`
- `profile.delete`

Every command is authenticated, strictly validated, bound to a request ID, correlation ID, actor, and idempotency key, and may carry `expectedSourceVersion`. A stale source version is rejected before native execution. Successful execution is followed by authoritative inventory readback; the adapter does not treat CLI exit alone as proof of convergence.

`GET /control/v1/capabilities` advertises `profiles.execute` as supported with `authority: hermes-native` and `optimisticConcurrency: true`. This capability must not be advertised if native execution cannot be provided.

Native description changes use the supported non-interactive CLI form:

```text
hermes profile describe <profile> --text <description>
```

## Persistence

Forward-only migration `008_native_profile_inventory.sql` adds:

- `agents` — framework-linked native agent projections;
- `profiles` — desired and observed profile state, protection, source version, and optimistic resource version;
- `profile_assignments` — primary/fallback assignment state with one desired primary per agent;
- immutable `profile_inventory_observations`;
- immutable `profile_reconciliations`; and
- immutable `profile_lifecycle_evidence`.

It also adds `profiles.read` and `profiles.manage` to the native authorization inventory. Administrators and operators can manage profiles; viewers receive read access only.

All identifiers are canonical prefixed ULIDs. Immutable evidence tables reject update and delete. Profile and assignment updates use database resource versions; native mutations independently use the current Hermes source version.

## Lifecycle behavior

### Create

1. Validate framework scope, native reference, and display name.
2. Persist the Core desired profile.
3. Read the current Hermes inventory and source version.
4. Execute `profile.create` with that expected source version.
5. Perform authoritative post-write reconciliation.
6. Return the normalized persisted profile.

A duplicate Core native reference is rejected with `profile_conflict`.

### Update

The caller supplies the expected Core profile version. A stale version is rejected with `profile_version_conflict`. Description changes execute through Hermes and are then read back. Desired inactive state remains visible as drift when the native runtime cannot express the requested observed state; Core does not fabricate convergence.

### Delete

Protected profiles fail closed with `profile_protected`. For an unprotected profile, Core records desired deletion, executes the native delete with source-version concurrency, and verifies that authoritative inventory no longer contains the profile.

### Assignments

Assignments are framework-local. Core locks the agent and profile, verifies both expected versions, enforces one desired primary assignment per agent, and records immutable assignment evidence. Reconciliation derives native same-reference primary assignments while retaining explicit desired assignment state.

## Failure and retry semantics

Core intentionally persists desired state before calling Hermes. If native execution or authoritative readback fails:

- the desired state remains durable and visible;
- observed state remains unchanged, unknown, or drifted rather than being falsely advanced;
- immutable lifecycle evidence records `outcome: failed` and a bounded safe error code;
- the authoritative gateway exception is returned to the caller; and
- a retry uses a new current Hermes source version and the stable request-scoped identifiers/idempotency contract.

Evidence persistence is best-effort only when the evidence store itself is unavailable; it never masks the authoritative gateway failure.

## Reconciliation

Reconciliation reads Hermes inventory, rejects an explicitly stale expected source version, and transactionally:

- upserts framework-linked profiles and agents;
- updates observed state and observed versions;
- marks absent projected resources as `missing`;
- updates derived native assignments;
- writes the complete immutable inventory observation;
- computes desired-versus-observed drift; and
- writes immutable reconciliation and lifecycle evidence using stable request and correlation IDs.

A reconciliation is `converged` only when desired deletion is observed missing, desired active is observed present, and desired inactive is observed inactive. Otherwise it is truthfully `drifted`.

## Standalone boundary

Production Gateway source has no Agency adapter, owner client branch, session, credentials, profile routes, notification routing, or accepted owner query. `standalone-boundary.test.ts` scans production TypeScript and fails if Agency runtime code or configuration is reintroduced.

No `AGENCY_URL`, `AGENCY_USERNAME`, or `AGENCY_PASSWORD` is required by deployment. Legacy migration mode may still enable DMM, CHAT, Worker, and Memory readers while their own migrations remain active; it does not restore Agency.

## Verification

```bash
pnpm --filter @aquiero/contracts build
pnpm --filter @unify/core typecheck
pnpm --filter @unify/core test
pnpm --filter @aquiero/hermes-control-adapter typecheck
pnpm --filter @aquiero/hermes-control-adapter test
pnpm --filter @aquiero/gateway typecheck
pnpm --filter @aquiero/gateway test

CORE_PROFILE_TEST_DATABASE_URL='postgresql://.../unify_core_profile_test' \
  pnpm --filter @unify/core test
```

The live PostgreSQL suite covers fresh migration, RBAC, framework-linked inventory, create, protection, resource-version rejection, source-version rejection, assignments, authoritative reconciliation, desired-state persistence after gateway failure, successful and failed immutable evidence, and evidence mutation rejection.

Cutover still requires the repository-wide release gates and explicit production approval. This phase does not itself authorize retiring another service or changing traffic.
