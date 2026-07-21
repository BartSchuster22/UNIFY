# Hermes Source-of-Truth Phase 6 Verification

Date: 2026-07-21
Release: `unify-hermes-work-cutover`

## Scope

This cutover makes native Hermes authoritative for the Work domain:

- Hermes Projects owns the project registry.
- Hermes Kanban owns boards and tasks.
- Hermes cron owns schedules.
- Worker remains an execution engine and is not a Work-state owner.
- UNIUI reads and mutates Work only through the authenticated Gateway and Hermes Control adapter.

## Implemented boundary

The Hermes Control contract and adapter now expose typed project, board, task, and cronjob collections plus governed Work commands. Commands cover project create/rename/archive, task create/promote/block/unblock/complete, and cron create/run/pause/resume/delete. Execute-mode commands use the existing idempotent adapter journal and publish Work events.

The Gateway exposes authenticated Hermes Work reads and routes `work.*` mutations to `HermesGatewayService`, not the migration-only owner client. Migration `005_hermes_work_cutover` adds `work.manage` to the Administrator role.

UNIUI Work reads call the dedicated Hermes project, board, task, and cronjob routes. Its Work source contains no `worker.*` mutation calls and no generic integration-resource fallback.

Production policy is `mutation-canary` with only `work` execution enabled. Legacy writes remain contained.

## Verification

The final `pnpm qa` run passed all gates:

- ESLint and workspace-boundary checks
- Hermes source-of-truth policy check
- TypeScript typechecks for all workspaces
- Unit and integration tests
- Production builds
- Reproducible OpenAPI and TypeScript SDK generation
- Legacy-route inventory check
- Prettier formatting check

Relevant suites passed:

- Hermes Control adapter: 12 tests
- Gateway: 82 tests
- UNIUI: 19 tests
- Contracts: 8 tests

The adapter test suite includes a complete Work-command schema request. The Gateway suite verifies that Hermes-owned Work operations reach Hermes Control without invoking the legacy owner client.

## Production deployment

Migration `005_hermes_work_cutover` applied successfully. Gateway and UNIUI were rebuilt and recreated from the final source and became healthy. The systemd-managed Hermes Control adapter was rebuilt, restarted, and remained active.

The adapter systemd unit was corrected to:

- quote the display-name environment assignment correctly;
- permit writes to authoritative Hermes runtime state required by SQLite WAL, Kanban, and cron;
- retain read-only protection for the pinned Hermes executable/source trees.

This fixed a production-only Projects read failure caused by `ProtectHome=read-only` preventing SQLite from opening the Projects WAL.

A second production-only defect was found through live validation: the Work command schema intersected an `additionalProperties: false` base object, causing valid `operation` and `targetId` fields to be rejected. The schema was replaced with one closed object containing all command fields, and a regression test was added.

## Live authenticated evidence

Final authenticated Gateway checks returned:

- health: ready, release `unify-hermes-work-cutover`;
- Projects: HTTP 200, Hermes owner;
- Boards: HTTP 200, Hermes owner, 3 boards;
- Tasks: HTTP 200 across all 3 boards, 7 tasks;
- Cronjobs: HTTP 200, Hermes owner, 1 cronjob;
- cutover status: `mutation-canary`, only `work` enabled, legacy writes contained;
- governed `work.task.create` in `validate` mode: HTTP 201, operation state `verified`, Hermes owner, terminal status `validated`;
- logout: HTTP 204.

The validation command did not create a Hermes task or alter production Work state.

## Pinned Hermes integrity

The pinned Hermes commit remained `9e54eee44f1cbbe62247a36546e51ff8940373c6`. Its tracked and staged trees remained unchanged. A pre-existing untracked backup file remains outside this change and was not modified.

## Rollback

Remove `work` from `MUTATION_DOMAINS`, clear its acceptance reference, and redeploy to disable Work execution while retaining reads. Migration 005 can be rolled back using the governed database rollback procedure if the permission must also be removed.
