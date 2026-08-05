import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticationService } from '../auth/service.js';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';
import { NativeWorkError, NativeWorkService, type WorkCommand } from './service.js';

const databaseUrl = process.env.UNIFY_WORK_TEST_DATABASE_URL;
const FRAMEWORK_ID = `frm_${ulid()}`;
const PROFILE_ONE = `prf_${ulid()}`;
const PROFILE_TWO = `prf_${ulid()}`;
const USER_ID = `usr_${ulid()}`;
const actor: AuthenticatedPrincipal = {
  kind: 'user',
  id: USER_ID,
  username: 'work-test',
  displayName: 'Work Test',
  roles: ['core.admin'],
  permissions: ['work.read', 'work.manage'],
  mfaVerified: true,
  passwordChangeRequired: false,
  sessionId: `ses_${ulid()}`,
};
const context: RequestContext = {
  remoteAddress: '127.0.0.1',
  requestId: `req_${ulid()}`,
  correlationId: `cor_${ulid()}`,
};
let sequence = 0;
const command = (
  suffix: string,
  expectedVersion?: number,
  expectedSourceVersion?: number,
): WorkCommand => ({
  commandId: `cmd_${ulid()}`,
  idempotencyKey: `phase8:${suffix}:${++sequence}:${ulid()}`,
  ...(expectedVersion === undefined ? {} : { expectedVersion }),
  ...(expectedSourceVersion === undefined ? {} : { expectedSourceVersion }),
});

test(
  'native work management is transactional, idempotent, concurrent and evidence-backed on PostgreSQL',
  { skip: !databaseUrl },
  async () => {
    const parsed = new URL(databaseUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_work_test(?:_|$)/,
      'integration database name must start with unify_core_work_test',
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 8 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      const migrated = await migrateDatabase(pool);
      assert.deepEqual(migrated.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      await verifyDatabase(pool);
      await pool.query(
        `INSERT INTO core.frameworks(id,name,endpoint,credential_reference,desired_state) VALUES($1,'Work Test','https://10.70.0.3','secret://frameworks/work-test','active')`,
        [FRAMEWORK_ID],
      );
      await pool.query(
        `INSERT INTO core.profiles(id,framework_id,native_reference,name,desired_state,observed_state) VALUES($1,$3,'one','One','active','active'),($2,$3,'two','Two','active','active')`,
        [PROFILE_ONE, PROFILE_TWO, FRAMEWORK_ID],
      );
      await pool.query(
        `INSERT INTO core.identities(id,username,display_name,password_hash) VALUES($1,'work-test','Work Test','$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')`,
        [USER_ID],
      );

      const authentication = {
        authorize: async () => undefined,
      } as unknown as AuthenticationService;
      const service = new NativeWorkService(pool, authentication);
      const createCommand = command('project-create');
      const input = {
        name: 'Native Project',
        goal: 'Prove Phase 8',
        profileIds: [PROFILE_ONE, PROFILE_TWO],
        projectManagerProfileId: PROFILE_ONE,
        activate: true,
      };
      const created = await service.createProject(input, createCommand, actor, context);
      const project = created.project as Record<string, unknown>;
      const projectId = String(project.id);
      const defaultBoardId = String(created.boardId);
      assert.equal(project.state, 'active');

      const replay = await service.createProject(input, createCommand, actor, context);
      assert.equal(replay.replayed, true);
      assert.equal((replay.project as Record<string, unknown>).id, projectId);
      await assert.rejects(
        service.createProject({ ...input, name: 'Different' }, createCommand, actor, context),
        (error: unknown) =>
          error instanceof NativeWorkError && error.code === 'idempotency_conflict',
      );

      const boardCreated = await service.createBoard(
        projectId,
        { name: 'Delivery', lanes: ['backlog', 'ready', 'in-progress', 'blocked', 'done'] },
        command('board-create', 1, 1),
        actor,
        context,
      );
      const boardId = String((boardCreated.board as Record<string, unknown>).id);
      assert.notEqual(boardId, defaultBoardId);

      const currentProject = (await service.inventory(actor, context, projectId))
        .projects[0] as Record<string, unknown>;
      const updatedProject = await service.updateProject(
        projectId,
        { name: 'Native Project Updated' },
        command(
          'project-update',
          Number(currentProject.version),
          Number(currentProject.source_version),
        ),
        actor,
        context,
      );
      assert.equal(
        (updatedProject.project as Record<string, unknown>).name,
        'Native Project Updated',
      );

      const taskCreated = await service.createTask(
        {
          projectId,
          boardId,
          lane: 'ready',
          title: 'Implement native work',
          priority: 'urgent',
          assigneeProfileId: PROFILE_ONE,
        },
        command('task-create'),
        actor,
        context,
      );
      const task = taskCreated.task as Record<string, unknown>;
      const taskId = String(task.id);
      assert.equal(task.state, 'open');

      await assert.rejects(
        service.transitionTask(
          taskId,
          'start',
          {},
          command('stale-source', Number(task.version), 999),
          actor,
          context,
        ),
        (error: unknown) =>
          error instanceof NativeWorkError && error.code === 'source_version_mismatch',
      );
      const started = await service.transitionTask(
        taskId,
        'start',
        {},
        command('task-start', Number(task.version), Number(task.source_version)),
        actor,
        context,
      );
      const startedTask = started.task as Record<string, unknown>;
      assert.equal(startedTask.state, 'running');

      const expectedVersion = Number(startedTask.version);
      const expectedSource = Number(startedTask.source_version);
      const concurrent = await Promise.allSettled([
        service.updateTask(
          taskId,
          { title: 'Winner A' },
          command('concurrent-a', expectedVersion, expectedSource),
          actor,
          context,
        ),
        service.updateTask(
          taskId,
          { title: 'Winner B' },
          command('concurrent-b', expectedVersion, expectedSource),
          actor,
          context,
        ),
      ]);
      assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);

      const inventoryAfterUpdate = await service.inventory(actor, context, projectId);
      const current = inventoryAfterUpdate.tasks.find((item) => item.id === taskId)! as Record<
        string,
        unknown
      >;
      const assigned = await service.assignTask(
        taskId,
        PROFILE_TWO,
        command('assign', Number(current.version), Number(current.source_version)),
        actor,
        context,
      );
      assert.equal(assigned.assigneeProfileId, PROFILE_TWO);

      const afterAssignee = (await service.inventory(actor, context, projectId)).tasks.find(
        (item) => item.id === taskId,
      )! as Record<string, unknown>;
      const reviewer = await service.assignTask(
        taskId,
        PROFILE_ONE,
        command('reviewer', Number(afterAssignee.version), Number(afterAssignee.source_version)),
        actor,
        context,
        'reviewer',
      );
      assert.equal(reviewer.assignedProfileId, PROFILE_ONE);

      const afterAssign = (await service.inventory(actor, context, projectId)).tasks.find(
        (item) => item.id === taskId,
      )! as Record<string, unknown>;
      const blocked = await service.transitionTask(
        taskId,
        'block',
        { reason: 'Awaiting review' },
        command('block', Number(afterAssign.version), Number(afterAssign.source_version)),
        actor,
        context,
      );
      assert.equal((blocked.task as Record<string, unknown>).state, 'blocked');

      const blockedTask = blocked.task as Record<string, unknown>;
      const commented = await service.addTaskComment(
        taskId,
        'Blocked on upstream evidence.',
        ['evd-external'],
        command('comment', Number(blockedTask.version), Number(blockedTask.source_version)),
        actor,
        context,
      );
      assert.equal(
        (commented.comment as Record<string, unknown>).body,
        'Blocked on upstream evidence.',
      );

      const dueAt = new Date(Date.now() - 1_000);
      const scheduleResult = await service.upsertSchedule(
        undefined,
        {
          taskId,
          kind: 'at',
          expression: dueAt.toISOString(),
          timezone: 'UTC',
          enabled: true,
          nextRunAt: dueAt,
        },
        command('schedule'),
        actor,
        context,
      );
      const schedule = scheduleResult.schedule as Record<string, unknown>;
      const scheduleId = String(schedule.id);
      const paused = await service.scheduleAction(
        scheduleId,
        'pause',
        command('schedule-pause', Number(schedule.version), Number(schedule.source_version)),
        actor,
        context,
      );
      const pausedSchedule = paused.schedule as Record<string, unknown>;
      assert.equal(pausedSchedule.enabled, false);
      const resumed = await service.scheduleAction(
        scheduleId,
        'resume',
        command(
          'schedule-resume',
          Number(pausedSchedule.version),
          Number(pausedSchedule.source_version),
        ),
        actor,
        context,
      );
      assert.equal((resumed.schedule as Record<string, unknown>).enabled, true);
      const [claimedA, claimedB] = await Promise.all([
        service.enqueueDueRuns(10),
        service.enqueueDueRuns(10),
      ]);
      assert.equal(claimedA.length + claimedB.length, 1);
      const run = (claimedA[0] ?? claimedB[0])!;
      const finished = await service.finishRun(
        String(run.id),
        'succeeded',
        { verified: true },
        command('run-finish', Number(run.version), Number(run.source_version)),
        actor,
        context,
      );
      assert.equal((finished.run as Record<string, unknown>).state, 'succeeded');

      const interval = await service.upsertSchedule(
        undefined,
        { taskId, kind: 'every', expression: '5m', timezone: 'UTC', enabled: true },
        command('interval-schedule'),
        actor,
        context,
      );
      assert.ok(
        new Date(String((interval.schedule as Record<string, unknown>).next_run_at)) > new Date(),
      );
      const intervalSchedule = interval.schedule as Record<string, unknown>;
      const manual = await service.scheduleAction(
        String(intervalSchedule.id),
        'run-now',
        command(
          'manual-run',
          Number(intervalSchedule.version),
          Number(intervalSchedule.source_version),
        ),
        actor,
        context,
      );
      const manualRun = manual.run as Record<string, unknown>;
      const cancelled = await service.runAction(
        String(manualRun.id),
        'cancel',
        'Operator cancelled',
        command('run-cancel', Number(manualRun.version), Number(manualRun.source_version)),
        actor,
        context,
      );
      const cancelledRun = cancelled.run as Record<string, unknown>;
      assert.equal(cancelledRun.state, 'cancelled');
      const retried = await service.runAction(
        String(cancelledRun.id),
        'retry',
        'Transient cancellation',
        command('run-retry', Number(cancelledRun.version), Number(cancelledRun.source_version)),
        actor,
        context,
      );
      assert.equal((retried.run as Record<string, unknown>).state, 'queued');
      const deletedSchedule = await service.scheduleAction(
        String(intervalSchedule.id),
        'delete',
        command(
          'schedule-delete',
          Number(intervalSchedule.version),
          Number(intervalSchedule.source_version),
        ),
        actor,
        context,
      );
      assert.equal(deletedSchedule.deleted, true);
      assert.equal(
        (await service.inventory(actor, context, projectId)).schedules.some(
          (item) => item.id === intervalSchedule.id,
        ),
        false,
      );
      assert.equal(
        Number(
          (
            await pool.query(`SELECT count(*)::int AS count FROM core.work_runs WHERE id=$1`, [
              manualRun.id,
            ])
          ).rows[0].count,
        ),
        1,
      );

      const activationAt = new Date(Date.now() + 1_000);
      const scheduledProject = await service.createProject(
        { ...input, name: 'Scheduled Project', scheduledActivationAt: activationAt },
        command('scheduled-project'),
        actor,
        context,
      );
      assert.equal((scheduledProject.project as Record<string, unknown>).state, 'scheduled');
      const activated = await service.activateDueProjects(
        actor,
        context,
        new Date(activationAt.getTime() + 1_000),
      );
      assert.equal((activated[0]!.project as Record<string, unknown>).state, 'active');

      const counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM core.operations WHERE status='succeeded') operations,
      (SELECT count(*)::int FROM core.work_evidence) evidence,
      (SELECT count(*)::int FROM core.events) events,
      (SELECT count(*)::int FROM core.notifications) notifications`);
      assert.ok(counts.rows[0].operations >= 7);
      assert.equal(counts.rows[0].operations, counts.rows[0].evidence);
      assert.equal(counts.rows[0].operations, counts.rows[0].events);
      assert.ok(counts.rows[0].notifications >= 3);
      await assert.rejects(pool.query(`UPDATE core.work_evidence SET action=action`), /immutable/i);
    } finally {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE').catch(() => undefined);
      await pool.end();
    }
  },
);
