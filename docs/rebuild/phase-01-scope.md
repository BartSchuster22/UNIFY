# Phase 1 — Frozen Baseline and Standalone Scope

## Frozen reference

| Item | Value |
|---|---|
| Reference commit | `4ff0dd9dec4f642a6fb85e60cfc6779ab1e70695` |
| Annotated tag | `unify-standalone-baseline-20260804` |
| Rebuild branch | `rebuild/standalone-core-v1` |
| New implementation boundary | `apps/core` |

The tag preserves the complete pre-rebuild UNIFY tree as read-only historical reference. The rebuild branch starts at that exact commit. Existing applications and `apps/gateway` are reference material only and are not the implementation base for `apps/core`.

## Objective

Build one clean, lightweight and robust UNIFY Core that natively supplies the replacement control-plane functionality formerly spread across four external applications. Core must continue to integrate with registered agent frameworks, but it must run when all retired control-plane applications are stopped and network-blocked.

## Native bounded contexts

1. **Identity** — users, secure authentication, sessions, CSRF, MFA/RBAC/service credentials, authorization and authentication audit.
2. **Frameworks** — framework registration, health, identity, versions, capabilities, discovery and normalized desired/observed state.
3. **Profiles** — agent/profile inventory, lifecycle, assignments, identity files, model configuration, runtime controls and protected-profile policy.
4. **Models** — provider/model inventory, credentials by reference, validation, availability, defaults, fallbacks and routing policy.
5. **Work** — projects, boards, tasks, comments, lifecycle, assignments, scheduling, runs, approvals, retention/reflection and execution evidence.
6. **Conversations** — agents, sessions, messages, attachments, streaming/realtime, channel bindings, external-thread projection and delivery routing.
7. **Notifications** — inbox, channels, targets, delivery/test, read state and delivery audit.
8. **Operations** — durable command state, retries, reconciliation, health/diagnostics and recovery evidence.
9. **Audit** — immutable security and control-plane mutation evidence.

## Source-of-truth boundaries

| Data | Source of truth |
|---|---|
| Users, roles, sessions, policy, operations and audit | UNIFY Core/PostgreSQL |
| Normalized projects, conversations, notifications and mappings | UNIFY Core/PostgreSQL |
| Framework runtime capabilities and observed profile/model state | Registered framework, projected and reconciled by Core |
| Framework-owned identity/configuration files | Registered framework; mutations issued and evidenced by Core |
| Secret values | Secret manager/runtime injection; Core stores references and metadata only |
| Realtime resume cursors | UNIFY Core/PostgreSQL |

## In scope

- Every mandatory capability in `capability-inventory.md`.
- A native versioned API and event contract; old endpoints may inform behavior but do not constrain the new design.
- A fresh PostgreSQL schema and migrations.
- Authentication and authorization for browser users and machine clients.
- Direct private-network framework integrations with explicit capability negotiation.
- Desired-versus-observed reconciliation, idempotency, optimistic concurrency and durable operations.
- A standalone deployable image and public HTTPS ingress.
- Migration tooling that reads exported legacy data without making a retired application a runtime dependency.

## Out of scope

- Copying or patching a retired application into Core.
- Runtime HTTP, database, filesystem, package or container dependency on a retired control-plane application.
- Reusing a retired application's database as the Core database.
- Managing framework internals that are not advertised through a supported framework contract.
- Tenant-specific PSI behavior; UNIFY remains standalone and tenant-neutral.
- Deploying Core, migrating production data or retiring old applications before later build and QA phases.

## Clean-build constraints

- `apps/core` is a new package with no imports from existing UNIFY runtime applications.
- Retired-application names are allowed in planning/migration documentation and tests that enforce absence; they are not production integration types.
- Contracts are defined before feature implementation.
- No compatibility proxy is allowed in the production dependency graph.
- New secrets are generated for the standalone deployment; existing runtime secrets are not copied.
- Every phase must compile, test and produce objective acceptance evidence before the next phase is accepted.

## Phase 1 deliverables

- [x] Baseline commit preserved with an annotated tag.
- [x] Clean rebuild branch created from the baseline.
- [x] Isolated, compilable and tested `apps/core` package created.
- [x] Legacy capability inventory documented with dispositions.
- [x] Standalone acceptance criteria documented.
- [x] No existing runtime source modified as part of Phase 1.
