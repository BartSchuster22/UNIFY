# Standalone UNIFY Core Acceptance Criteria

These are release gates, not aspirations. A criterion passes only with automated test output or captured operational evidence from the candidate deployment.

## A. Build and dependency isolation

- **AC-01 Clean package:** `apps/core` builds and tests from a clean checkout with pinned dependencies.
- **AC-02 No retired runtime dependency:** production source, lockfile dependency graph, image, environment and network configuration contain no client/import/database/filesystem/runtime requirement for any retired control-plane application.
- **AC-03 Retired services unavailable:** the full acceptance suite passes while all four retired applications are stopped and their hosts/routes are network-blocked.
- **AC-04 Single deployable:** Core is built as one non-root, production-only image; PostgreSQL is a separate service.

## B. Contracts and persistence

- **AC-05 Versioned contracts:** all public commands, queries, events and errors use documented versioned schemas and reject invalid input.
- **AC-06 Fresh schema:** a blank PostgreSQL database migrates to current and rolls back/reapplies according to migration policy.
- **AC-07 Durable truth:** restart and host-reboot tests preserve users, sessions as policy permits, projects, tasks, conversations, messages, mappings, operations, notifications, cursors and audit.
- **AC-08 Concurrency:** conflicting writes are rejected with source-version evidence; repeated commands with the same idempotency key do not duplicate effects.
- **AC-09 Backup restore:** an encrypted backup restores into a fresh database and the post-restore integrity suite passes.

## C. Identity and security

- **AC-10 Authentication:** bootstrap, Argon2id password verification, secure cookie sessions, logout/revocation, CSRF, throttling and lockout tests pass.
- **AC-11 Authorization:** scoped RBAC and service credentials deny cross-scope and insufficient-role actions; privileged actions are audited.
- **AC-12 Secrets:** no API response, log, audit event, database dump or image layer exposes password, provider token, bot token or framework credential values.
- **AC-13 Public exposure:** only the HTTPS reverse proxy is publicly reachable; PostgreSQL and private framework endpoints are not public.

## D. Framework control

- **AC-14 Independent registration:** Alica and Herman register with separate identities and credentials; one framework failing does not corrupt or block the other.
- **AC-15 Capability truth:** health, versions, identity, profile/model inventory and advertised capabilities are validated and normalized without inventing unsupported operations.
- **AC-16 Reconciliation:** desired and observed states, retries, timeouts, circuit breaking, drift reporting and credential rotation are evidenced.

## E. Replacement capability parity

- **AC-17 Profiles/agents:** profile create/read/update/delete or archive, protected-profile policy, identity, model assignment, runtime action, discovery and usage flows pass against supported frameworks.
- **AC-18 Models/providers:** provider/model discovery, credential-reference lifecycle, validation, selectable inventory, defaults/fallbacks/routing and refresh/diff flows pass.
- **AC-19 Work:** project, board, task, comment, lifecycle, assignment, schedule, cron, run, approval, notification, retention/reflection and recovery flows pass.
- **AC-20 Conversations:** native and external-thread sessions, history, send, streamed response, attachments, ownership-preserving archive/delete behavior, channel routing and idempotent system messages pass.
- **AC-21 Realtime:** authorized realtime delivery uses durable monotonically ordered events, resumes from a persisted cursor and recovers after disconnect/restart without silent loss.
- **AC-22 Operations/audit:** every asynchronous or privileged mutation exposes durable status, evidence, actor, target, timestamps, outcome and redacted error details.

## F. Resilience and quality

- **AC-23 Failure containment:** framework timeout, invalid response, partial mutation, database restart and realtime disconnect tests produce truthful degraded states and recover safely.
- **AC-24 Performance budgets:** health/readiness endpoints remain bounded; API and realtime load tests meet budgets defined before production QA without unbounded memory growth.
- **AC-25 Supply-chain gates:** typecheck, unit, integration, contract, migration, security, SBOM and vulnerability gates pass with no unresolved release-blocking findings.
- **AC-26 QA10:** ten consecutive clean end-to-end runs pass on the production-equivalent candidate, including at least one container restart and one host reboot cycle.

## Retirement gate

Old applications may be retired only when AC-01 through AC-26 are all evidenced, production backup/restore is proven, rollback is rehearsed, and the user explicitly approves cutover.
