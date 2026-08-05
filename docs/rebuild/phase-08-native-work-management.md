# Phase 08 — Hermes-native work management

## Ownership boundary

UNIFY Core is the authoritative store for projects, project boards, tasks, task assignments, schedules, runs, operations, events, evidence, and work notifications. Hermes is the only framework control API used for framework-native work execution. The Gateway no longer instantiates a Worker reader or Worker mutation client and no production configuration requires `WORKER_URL` or `WORKER_TOKEN`.

Worker is not a fallback, replication target, shadow writer, or runtime prerequisite. Legacy Worker migration code may only be used offline against an exported backup; it is not constructed by the production server.

## Schema

Migration `010_native_work_management.sql` creates:

- `core.work_projects` and `core.work_project_profiles`
- `core.work_boards`
- `core.work_tasks` and `core.work_task_assignments`
- `core.work_schedules` and `core.work_runs`
- immutable `core.work_evidence`
- `work.read` and `work.manage` authorization permissions

Every mutable aggregate has a database-managed resource `version`. Projects, boards, tasks, schedules, and runs also have `source_version`, which is incremented for every accepted native mutation.

## Command guarantees

Mutating service calls require:

- a canonical command ID;
- an actor-scoped idempotency key;
- expected resource and source versions for updates and transitions;
- `work.manage` authorization;
- a valid lifecycle transition.

A successful command atomically persists:

1. its `core.operations` row;
2. the resource mutation;
3. immutable work evidence;
4. a sequenced durable event;
5. a notification where the action is user-visible.

Reusing an idempotency key and identical payload returns the stored result. Reusing it for a different payload fails with `idempotency_conflict`. Concurrent commands lock the aggregate; after the first commit, stale versions fail closed.

## Lifecycle rules

Projects follow:

`saved|scheduled → active ⇄ paused → finished → reflected → archived`

Archiving is also allowed from saved, scheduled, active, paused, or finished. Restoring an archived project returns it to saved so activation requirements are evaluated again. Scheduled activation is executed as an idempotent, version-checked lifecycle command.

Tasks follow:

- `open → running → completed`
- `open|running → blocked → open`
- active or completed states may be archived
- moving a task changes its lane without inventing a lifecycle transition

Assignments are limited to profiles already attached to the project. One assignee and one reviewer slot are enforced per task.

## Scheduling and runs

Schedules support one-shot (`at`), interval (`every`), and cron expressions with an explicit timezone. A schedule targets exactly one project or task. Pause, resume, run-now, and delete are version-checked command operations.

Due-run claiming uses `FOR UPDATE SKIP LOCKED` and a unique `(schedule_id, scheduled_for)` constraint. Multiple schedulers can poll concurrently without duplicating a run. One-shot schedules disable themselves when claimed. Run completion stores either a result or a safe error, never both. Schedule deletion is a soft deletion: it removes the schedule from active inventory while preserving immutable run history.

## Deployment

1. Back up PostgreSQL and record the restore reference.
2. Stop old Worker mutation and polling traffic.
3. Deploy Core and apply migrations 001–010.
4. Run `pnpm --filter @unify/core db:verify`.
5. Import any approved legacy export through a one-shot, checksum-verified migration procedure; never enable dual writes.
6. Verify project/task counts, assignment membership, schedule next-run timestamps, operation/evidence parity, and notification delivery.
7. Deploy Gateway without Worker URL/token settings.
8. Keep the retired Worker service stopped during the observation window, then remove it after backup-retention approval.

## Monitoring

Alert on:

- failed or long-running `core.operations`;
- repeated `version_conflict` or `source_version_mismatch` errors;
- queued runs past `scheduled_for`;
- failed runs and notification deliveries;
- a mismatch between succeeded work operations, durable events, and work evidence;
- any production process containing Worker URL/token configuration.

## Rollback

Rollback is restore-based, not dual-write based:

1. stop writes and schedulers;
2. preserve operation, event, evidence, notification, and run records;
3. restore the pre-migration database backup;
4. redeploy the prior Core/Gateway release;
5. reconcile commands accepted after the backup from immutable evidence before reopening writes.

Do not restart Worker as an automatic fallback and do not reverse-copy partially applied native state into Worker.

## Verification

Run:

```bash
pnpm --filter @unify/core test
UNIFY_WORK_TEST_DATABASE_URL=postgresql://.../unify_core_work_test_phase8 \
  node --test --test-concurrency=1 apps/core/dist/work/work.integration.test.js
pnpm contracts:generate
pnpm qa
```

The PostgreSQL test covers migration, project/board creation, task assignment and lifecycle, idempotent replay/conflict, source-version rejection, concurrent update exclusion, schedule pause/resume, concurrent due-run claiming, run completion, operations, evidence, events, notifications, and evidence immutability.
