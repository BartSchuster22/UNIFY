import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import type { AuthenticationService } from '../auth/service.js';

export class NativeWorkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'NativeWorkError';
  }
}

export interface WorkCommand {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly expectedVersion?: number;
  readonly expectedSourceVersion?: number;
}

export interface ProjectInput {
  readonly name: string;
  readonly goal?: string;
  readonly profileIds?: readonly string[];
  readonly projectManagerProfileId?: string;
  readonly activate?: boolean;
  readonly scheduledActivationAt?: Date;
  readonly workspaceReference?: string;
}
export interface ProjectUpdateInput {
  readonly name?: string;
  readonly goal?: string;
  readonly profileIds?: readonly string[];
  readonly projectManagerProfileId?: string | null;
  readonly workspaceReference?: string | null;
}
export interface TaskInput {
  readonly projectId: string;
  readonly boardId: string;
  readonly lane: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly assigneeProfileId?: string;
}
export interface ScheduleInput {
  readonly projectId?: string;
  readonly taskId?: string;
  readonly kind: 'at' | 'every' | 'cron';
  readonly expression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextRunAt?: Date;
}

interface ResourceRow extends QueryResultRow {
  id: string;
  version: string | number;
  source_version: string | number;
  [key: string]: unknown;
}
interface OperationRow extends QueryResultRow {
  command_type: string;
  payload_digest: Buffer;
  status: string;
  result: Record<string, unknown> | null;
}

export class NativeWorkService {
  constructor(
    private readonly pool: Pool,
    private readonly authentication: AuthenticationService,
  ) {}

  async inventory(actor: AuthenticatedPrincipal, context: RequestContext, projectId?: string) {
    await this.authentication.authorize(
      actor,
      'work.read',
      projectId ? { kind: 'project', id: projectId } : undefined,
      context,
    );
    const parameter = projectId ? [projectId] : [];
    const projectWhere = projectId ? ' WHERE id=$1' : '';
    const childWhere = projectId ? ' WHERE project_id=$1' : '';
    const scheduleWhere = projectId
      ? ' WHERE deleted_at IS NULL AND (project_id=$1 OR task_id IN (SELECT id FROM core.work_tasks WHERE project_id=$1))'
      : ' WHERE deleted_at IS NULL';
    const [projects, boards, tasks, assignments, schedules, runs] = await Promise.all([
      this.pool.query(
        `SELECT * FROM core.work_projects${projectWhere} ORDER BY created_at,id`,
        parameter,
      ),
      this.pool.query(
        `SELECT * FROM core.work_boards${childWhere} ORDER BY created_at,id`,
        parameter,
      ),
      this.pool.query(
        `SELECT * FROM core.work_tasks${childWhere} ORDER BY created_at,id`,
        parameter,
      ),
      this.pool.query(
        `SELECT assignment.* FROM core.work_task_assignments assignment
         JOIN core.work_tasks task ON task.id=assignment.task_id${projectId ? ' WHERE task.project_id=$1' : ''}
         ORDER BY assignment.created_at,assignment.task_id`,
        parameter,
      ),
      this.pool.query(
        `SELECT * FROM core.work_schedules${scheduleWhere} ORDER BY created_at,id`,
        parameter,
      ),
      this.pool.query(
        `SELECT run.* FROM core.work_runs run JOIN core.work_schedules schedule ON schedule.id=run.schedule_id${projectId ? ' WHERE schedule.project_id=$1 OR schedule.task_id IN (SELECT id FROM core.work_tasks WHERE project_id=$1)' : ''}
         ORDER BY run.created_at,run.id`,
        parameter,
      ),
    ]);
    return {
      projects: projects.rows,
      boards: boards.rows,
      tasks: tasks.rows,
      assignments: assignments.rows,
      schedules: schedules.rows,
      runs: runs.rows,
    };
  }

  async createProject(
    input: ProjectInput,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    if (!input.name.trim() || input.name.length > 500) throw invalid('project_name_invalid');
    if (input.activate && (!input.goal?.trim() || !input.profileIds?.length))
      throw invalid('project_activation_requirements_missing');
    if (input.scheduledActivationAt && !input.activate)
      throw invalid('scheduled_activation_requires_activation');
    const projectId = id('prj');
    const boardId = id('brd');
    return this.execute(
      'work.project.create.v1',
      'project',
      projectId,
      input,
      command,
      actor,
      context,
      async (client, operationId) => {
        const state = input.activate
          ? input.scheduledActivationAt && input.scheduledActivationAt > new Date()
            ? 'scheduled'
            : 'active'
          : 'saved';
        const project = await client.query<ResourceRow>(
          `INSERT INTO core.work_projects(id,name,goal,state,project_manager_profile_id,workspace_reference,scheduled_activation_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            projectId,
            input.name.trim(),
            input.goal?.trim() || null,
            state,
            input.projectManagerProfileId ?? null,
            input.workspaceReference ?? null,
            input.scheduledActivationAt ?? null,
          ],
        );
        await client.query(
          `INSERT INTO core.work_boards(id,project_id,name) VALUES($1,$2,'Main')`,
          [boardId, projectId],
        );
        const profiles = [
          ...new Set([
            ...(input.profileIds ?? []),
            ...(input.projectManagerProfileId ? [input.projectManagerProfileId] : []),
          ]),
        ];
        for (const profileId of profiles)
          await client.query(
            `INSERT INTO core.work_project_profiles(project_id,profile_id,role) VALUES($1,$2,$3)`,
            [
              projectId,
              profileId,
              profileId === input.projectManagerProfileId ? 'manager' : 'member',
            ],
          );
        await this.record(client, operationId, 'project', projectId, 'created', null, 1, 1, {
          state,
          boardId,
          profiles,
        });
        return { project: project.rows[0], boardId };
      },
    );
  }

  async updateProject(
    projectId: string,
    changes: ProjectUpdateInput,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(
      actor,
      'work.manage',
      { kind: 'project', id: projectId },
      context,
    );
    if (
      !Object.keys(changes).length ||
      (changes.name !== undefined && (!changes.name.trim() || changes.name.length > 500))
    )
      throw invalid('project_update_invalid');
    return this.execute(
      'work.project.update.v1',
      'project',
      projectId,
      changes,
      command,
      actor,
      context,
      async (client, operationId) => {
        const before = await lock(client, 'work_projects', projectId);
        assertExpected(before, command);
        if (changes.profileIds !== undefined) {
          const profiles = [
            ...new Set([
              ...(changes.profileIds ?? []),
              ...(changes.projectManagerProfileId ? [changes.projectManagerProfileId] : []),
            ]),
          ];
          await client.query(`DELETE FROM core.work_project_profiles WHERE project_id=$1`, [
            projectId,
          ]);
          for (const profileId of profiles)
            await client.query(
              `INSERT INTO core.work_project_profiles(project_id,profile_id,role) VALUES($1,$2,$3)`,
              [
                projectId,
                profileId,
                profileId === changes.projectManagerProfileId ? 'manager' : 'member',
              ],
            );
        } else if (Object.hasOwn(changes, 'projectManagerProfileId')) {
          await client.query(
            `UPDATE core.work_project_profiles SET role='member' WHERE project_id=$1 AND role='manager'`,
            [projectId],
          );
          if (changes.projectManagerProfileId)
            await client.query(
              `INSERT INTO core.work_project_profiles(project_id,profile_id,role) VALUES($1,$2,'manager') ON CONFLICT(project_id,profile_id) DO UPDATE SET role='manager'`,
              [projectId, changes.projectManagerProfileId],
            );
        }
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_projects SET name=coalesce($2,name),goal=coalesce($3,goal),
         project_manager_profile_id=CASE WHEN $4 THEN $5 ELSE project_manager_profile_id END,
         workspace_reference=CASE WHEN $6 THEN $7 ELSE workspace_reference END,source_version=source_version+1
         WHERE id=$1 RETURNING *`,
          [
            projectId,
            changes.name?.trim() ?? null,
            changes.goal?.trim() ?? null,
            Object.hasOwn(changes, 'projectManagerProfileId'),
            changes.projectManagerProfileId ?? null,
            Object.hasOwn(changes, 'workspaceReference'),
            changes.workspaceReference ?? null,
          ],
        );
        const row = updated.rows[0]!;
        if (row.state === 'active') {
          const member = await client.query(
            `SELECT 1 FROM core.work_project_profiles WHERE project_id=$1 LIMIT 1`,
            [projectId],
          );
          if (!String(row.goal ?? '').trim() || !member.rowCount)
            throw invalid('project_activation_requirements_missing');
        }
        await this.record(
          client,
          operationId,
          'project',
          projectId,
          'updated',
          number(before.version),
          number(row.version),
          number(row.source_version),
          { fields: Object.keys(changes) },
        );
        return { project: row };
      },
    );
  }

  async transitionProject(
    projectId: string,
    action: 'start' | 'pause' | 'resume' | 'finish' | 'reflect' | 'archive' | 'restore',
    reason: string,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(
      actor,
      'work.manage',
      { kind: 'project', id: projectId },
      context,
    );
    return this.execute(
      'work.project.lifecycle.v1',
      'project',
      projectId,
      { action, reason },
      command,
      actor,
      context,
      async (client, operationId) => {
        const row = await lock(client, 'work_projects', projectId);
        assertExpected(row, command);
        const next = projectTransition(String(row.state), action);
        if (action === 'start') {
          const member = await client.query(
            `SELECT 1 FROM core.work_project_profiles WHERE project_id=$1 LIMIT 1`,
            [projectId],
          );
          if (!String(row.goal ?? '').trim() || !member.rowCount)
            throw invalid('project_activation_requirements_missing');
        }
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_projects SET state=$2,source_version=source_version+1,
         archived_at=CASE WHEN $2='archived' THEN clock_timestamp() ELSE NULL END
         WHERE id=$1 RETURNING *`,
          [projectId, next],
        );
        const result = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'project',
          projectId,
          action,
          number(row.version),
          number(result.version),
          number(result.source_version),
          { reason, from: row.state, to: next },
        );
        await this.notify(
          client,
          actor,
          operationId,
          `work.project.${action}`,
          `Project ${action}`,
          reason,
          projectId,
        );
        return { project: result };
      },
    );
  }

  async activateDueProjects(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    now = new Date(),
  ): Promise<readonly Record<string, unknown>[]> {
    const due = await this.pool.query<ResourceRow>(
      `SELECT * FROM core.work_projects WHERE state='scheduled' AND scheduled_activation_at <= $1 ORDER BY scheduled_activation_at,id`,
      [now],
    );
    const activated: Record<string, unknown>[] = [];
    for (const project of due.rows) {
      const scheduled = new Date(String(project.scheduled_activation_at)).toISOString();
      try {
        activated.push(
          await this.transitionProject(
            String(project.id),
            'start',
            'Scheduled activation',
            {
              commandId: id('cmd'),
              idempotencyKey: `scheduled-activation:${project.id}:${scheduled}`,
              expectedVersion: number(project.version),
              expectedSourceVersion: number(project.source_version),
            },
            actor,
            context,
          ),
        );
      } catch (error) {
        if (!(
          error instanceof NativeWorkError &&
          (error.code === 'version_conflict' || error.code === 'idempotency_conflict')
        ))
          throw error;
      }
    }
    return activated;
  }

  async createBoard(
    projectId: string,
    input: { name: string; lanes?: readonly string[] },
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(
      actor,
      'work.manage',
      { kind: 'project', id: projectId },
      context,
    );
    if (
      !input.name.trim() ||
      input.name.length > 500 ||
      input.lanes?.some((lane) => !/^[a-z0-9][a-z0-9-]{0,99}$/.test(lane)) ||
      (input.lanes && new Set(input.lanes).size !== input.lanes.length)
    )
      throw invalid('board_input_invalid');
    const boardId = id('brd');
    return this.execute(
      'work.board.create.v1',
      'board',
      boardId,
      input,
      command,
      actor,
      context,
      async (client, operationId) => {
        const project = await lock(client, 'work_projects', projectId);
        assertExpected(project, command);
        const created = await client.query<ResourceRow>(
          `INSERT INTO core.work_boards(id,project_id,name,lanes) VALUES($1,$2,$3,$4) RETURNING *`,
          [
            boardId,
            projectId,
            input.name.trim(),
            JSON.stringify(
              (input.lanes ?? ['backlog', 'ready', 'in-progress', 'blocked', 'done']).map(
                (key, position) => ({
                  key,
                  label: key.charAt(0).toUpperCase() + key.slice(1).replaceAll('-', ' '),
                  position,
                }),
              ),
            ),
          ],
        );
        await client.query(
          `UPDATE core.work_projects SET source_version=source_version+1 WHERE id=$1`,
          [projectId],
        );
        await this.record(client, operationId, 'board', boardId, 'created', null, 1, 1, {
          projectId,
          lanes: input.lanes ?? null,
        });
        return { board: created.rows[0] };
      },
    );
  }

  async archiveBoard(
    boardId: string,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.board.action.v1',
      'board',
      boardId,
      { action: 'archive' },
      command,
      actor,
      context,
      async (client, operationId) => {
        const board = await lock(client, 'work_boards', boardId);
        assertExpected(board, command);
        const activeTasks = await client.query(
          `SELECT 1 FROM core.work_tasks WHERE board_id=$1 AND state <> 'archived' LIMIT 1`,
          [boardId],
        );
        if (activeTasks.rowCount)
          throw new NativeWorkError('board_not_empty', 'Board has active tasks', 409);
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_boards SET state='archived',source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [boardId],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'board',
          boardId,
          'archived',
          number(board.version),
          number(row.version),
          number(row.source_version),
          {},
        );
        return { board: row };
      },
    );
  }

  async createTask(
    input: TaskInput,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(
      actor,
      'work.manage',
      { kind: 'project', id: input.projectId },
      context,
    );
    if (!input.title.trim() || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(input.lane))
      throw invalid('task_input_invalid');
    const taskId = id('tsk');
    return this.execute(
      'work.task.create.v1',
      'task',
      taskId,
      input,
      command,
      actor,
      context,
      async (client, operationId) => {
        const board = await lock(client, 'work_boards', input.boardId);
        if (board.project_id !== input.projectId || board.state !== 'active')
          throw missing('board_not_found');
        const lanes = Array.isArray(board.lanes) ? board.lanes : [];
        if (
          !lanes.some(
            (lane) =>
              lane === input.lane ||
              (lane &&
                typeof lane === 'object' &&
                (lane as Record<string, unknown>).key === input.lane),
          )
        )
          throw invalid('board_lane_invalid');
        const created = await client.query<ResourceRow>(
          `INSERT INTO core.work_tasks(id,project_id,board_id,lane,title,description,priority)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            taskId,
            input.projectId,
            input.boardId,
            input.lane,
            input.title.trim(),
            input.description?.trim() || null,
            input.priority ?? 'normal',
          ],
        );
        if (input.assigneeProfileId)
          await this.assign(client, taskId, input.projectId, input.assigneeProfileId, actor);
        await this.record(client, operationId, 'task', taskId, 'created', null, 1, 1, {
          boardId: input.boardId,
          lane: input.lane,
          assigneeProfileId: input.assigneeProfileId ?? null,
        });
        return { task: created.rows[0] };
      },
    );
  }

  async updateTask(
    taskId: string,
    changes: { title?: string; description?: string | null; priority?: TaskInput['priority'] },
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.task.update.v1',
      'task',
      taskId,
      changes,
      command,
      actor,
      context,
      async (client, operationId) => {
        const row = await lock(client, 'work_tasks', taskId);
        assertExpected(row, command);
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_tasks SET title=coalesce($2,title),description=CASE WHEN $3 THEN $4 ELSE description END,
         priority=coalesce($5,priority),source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [
            taskId,
            changes.title?.trim() || null,
            Object.hasOwn(changes, 'description'),
            changes.description?.trim() || null,
            changes.priority ?? null,
          ],
        );
        const result = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'task',
          taskId,
          'updated',
          number(row.version),
          number(result.version),
          number(result.source_version),
          { fields: Object.keys(changes) },
        );
        return { task: result };
      },
    );
  }

  async transitionTask(
    taskId: string,
    action: 'start' | 'move' | 'block' | 'unblock' | 'complete' | 'archive',
    options: { lane?: string; reason?: string },
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.task.transition.v1',
      'task',
      taskId,
      { action, ...options },
      command,
      actor,
      context,
      async (client, operationId) => {
        const row = await lock(client, 'work_tasks', taskId);
        assertExpected(row, command);
        const next = taskTransition(String(row.state), action);
        if (action === 'move' && (!options.lane || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(options.lane)))
          throw invalid('task_lane_invalid');
        if (action === 'move') {
          const board = await lock(client, 'work_boards', String(row.board_id));
          const lanes = Array.isArray(board.lanes) ? board.lanes : [];
          if (
            !lanes.some(
              (lane) =>
                lane === options.lane ||
                (lane &&
                  typeof lane === 'object' &&
                  (lane as Record<string, unknown>).key === options.lane),
            )
          )
            throw invalid('board_lane_invalid');
        }
        if (action === 'block' && !options.reason?.trim())
          throw invalid('task_block_reason_required');
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_tasks SET state=$2,lane=coalesce($3,lane),block_reason=$4,
         started_at=CASE WHEN $2='running' THEN coalesce(started_at,clock_timestamp()) ELSE started_at END,
         completed_at=CASE WHEN $2='completed' THEN clock_timestamp() ELSE completed_at END,
         archived_at=CASE WHEN $2='archived' THEN clock_timestamp() ELSE archived_at END,
         source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [taskId, next, options.lane ?? null, next === 'blocked' ? options.reason!.trim() : null],
        );
        const result = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'task',
          taskId,
          action,
          number(row.version),
          number(result.version),
          number(result.source_version),
          { from: row.state, to: next, lane: result.lane, reason: options.reason ?? null },
        );
        await this.notify(
          client,
          actor,
          operationId,
          `work.task.${action}`,
          `Task ${action}`,
          options.reason ?? String(result.title),
          taskId,
        );
        return { task: result };
      },
    );
  }

  async assignTask(
    taskId: string,
    profileId: string | null,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    assignmentKind: 'assignee' | 'reviewer' = 'assignee',
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.task.assignment.v1',
      'task',
      taskId,
      { profileId, assignmentKind },
      command,
      actor,
      context,
      async (client, operationId) => {
        const task = await lock(client, 'work_tasks', taskId);
        assertExpected(task, command);
        await client.query(
          `DELETE FROM core.work_task_assignments WHERE task_id=$1 AND assignment_kind=$2`,
          [taskId, assignmentKind],
        );
        if (profileId)
          await this.assign(
            client,
            taskId,
            String(task.project_id),
            profileId,
            actor,
            assignmentKind,
          );
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_tasks SET source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [taskId],
        );
        const result = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'assignment',
          taskId,
          profileId ? 'assigned' : 'unassigned',
          number(task.version),
          number(result.version),
          number(result.source_version),
          { profileId, assignmentKind },
        );
        await this.notify(
          client,
          actor,
          operationId,
          'work.task.assignment',
          'Task assignment changed',
          profileId ?? 'Unassigned',
          taskId,
        );
        return {
          task: result,
          assignmentKind,
          assignedProfileId: profileId,
          ...(assignmentKind === 'assignee' ? { assigneeProfileId: profileId } : {}),
        };
      },
    );
  }

  async addTaskComment(
    taskId: string,
    body: string,
    evidenceReferences: readonly string[],
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    if (!body.trim() || body.length > 100_000 || evidenceReferences.length > 100)
      throw invalid('task_comment_invalid');
    const commentId = id('cmt');
    return this.execute(
      'work.task.comment.v1',
      'task',
      taskId,
      { body, evidenceReferences },
      command,
      actor,
      context,
      async (client, operationId) => {
        const task = await lock(client, 'work_tasks', taskId);
        assertExpected(task, command);
        const comment = await client.query(
          `INSERT INTO core.work_task_comments(id,task_id,operation_id,author_kind,author_id,body,evidence_references) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            commentId,
            taskId,
            operationId,
            actor.kind,
            actor.id,
            body.trim(),
            JSON.stringify(evidenceReferences),
          ],
        );
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_tasks SET source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [taskId],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'task',
          taskId,
          'commented',
          number(task.version),
          number(row.version),
          number(row.source_version),
          { commentId, evidenceReferences },
        );
        return { task: row, comment: comment.rows[0] };
      },
    );
  }

  async upsertSchedule(
    scheduleId: string | undefined,
    input: ScheduleInput,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(
      actor,
      'work.manage',
      input.projectId ? { kind: 'project', id: input.projectId } : undefined,
      context,
    );
    if (Boolean(input.projectId) === Boolean(input.taskId))
      throw invalid('schedule_target_invalid');
    validateSchedule(input);
    const nextRunAt = input.enabled
      ? (input.nextRunAt ?? nextScheduled(input.kind, input.expression, new Date(), input.timezone))
      : null;
    if (input.enabled && !nextRunAt) throw invalid('schedule_no_future_occurrence');
    const targetId = scheduleId ?? id('sch');
    return this.execute(
      'work.schedule.upsert.v1',
      'schedule',
      targetId,
      input,
      command,
      actor,
      context,
      async (client, operationId) => {
        let before: ResourceRow | undefined;
        if (scheduleId) {
          before = await lock(client, 'work_schedules', scheduleId);
          if (before.deleted_at)
            throw new NativeWorkError('schedule_deleted', 'Schedule is deleted', 409);
          assertExpected(before, command);
          if (
            String(before.project_id ?? '') !== String(input.projectId ?? '') ||
            String(before.task_id ?? '') !== String(input.taskId ?? '')
          )
            throw new NativeWorkError(
              'schedule_target_conflict',
              'A schedule target cannot be changed',
              409,
            );
        }
        const result = scheduleId
          ? await client.query<ResourceRow>(
              `UPDATE core.work_schedules SET kind=$2,expression=$3,timezone=$4,enabled=$5,next_run_at=$6,source_version=source_version+1 WHERE id=$1 RETURNING *`,
              [scheduleId, input.kind, input.expression, input.timezone, input.enabled, nextRunAt],
            )
          : await client.query<ResourceRow>(
              `INSERT INTO core.work_schedules(id,project_id,task_id,kind,expression,timezone,enabled,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                targetId,
                input.projectId ?? null,
                input.taskId ?? null,
                input.kind,
                input.expression,
                input.timezone,
                input.enabled,
                nextRunAt,
              ],
            );
        const row = result.rows[0]!;
        await this.record(
          client,
          operationId,
          'schedule',
          targetId,
          scheduleId ? 'updated' : 'created',
          before ? number(before.version) : null,
          number(row.version),
          number(row.source_version),
          {
            kind: input.kind,
            expression: input.expression,
            timezone: input.timezone,
            enabled: input.enabled,
          },
        );
        return { schedule: row };
      },
    );
  }

  async scheduleAction(
    scheduleId: string,
    action: 'run-now' | 'pause' | 'resume' | 'delete',
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ) {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.schedule.action.v1',
      'schedule',
      scheduleId,
      { action },
      command,
      actor,
      context,
      async (client, operationId) => {
        const schedule = await lock(client, 'work_schedules', scheduleId);
        if (schedule.deleted_at)
          throw new NativeWorkError('schedule_deleted', 'Schedule is deleted', 409);
        assertExpected(schedule, command);
        if (action === 'delete') {
          const deleted = await client.query<ResourceRow>(
            `UPDATE core.work_schedules SET enabled=false,next_run_at=NULL,deleted_at=clock_timestamp(),source_version=source_version+1 WHERE id=$1 RETURNING *`,
            [scheduleId],
          );
          const row = deleted.rows[0]!;
          await this.record(
            client,
            operationId,
            'schedule',
            scheduleId,
            'deleted',
            number(schedule.version),
            number(row.version),
            number(row.source_version),
            {},
          );
          return { schedule: row, deleted: true };
        }
        if (action === 'run-now') {
          const runId = id('run');
          const run = await client.query<ResourceRow>(
            `INSERT INTO core.work_runs(id,schedule_id,scheduled_for,operation_id) VALUES($1,$2,clock_timestamp(),$3) RETURNING *`,
            [runId, scheduleId, operationId],
          );
          await this.record(client, operationId, 'run', runId, 'queued', null, 1, 1, {
            scheduleId,
            manual: true,
          });
          return { schedule, run: run.rows[0] };
        }
        const enabled = action === 'resume';
        if ((enabled && schedule.enabled === true) || (!enabled && schedule.enabled === false))
          throw new NativeWorkError(
            'schedule_transition_invalid',
            `Schedule is already ${enabled ? 'enabled' : 'paused'}`,
            409,
          );
        const resumeNext =
          enabled && !schedule.next_run_at
            ? nextScheduled(
                String(schedule.kind) as ScheduleInput['kind'],
                String(schedule.expression),
                new Date(),
                String(schedule.timezone),
              )
            : schedule.next_run_at;
        if (enabled && !resumeNext) throw invalid('schedule_no_future_occurrence');
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_schedules SET enabled=$2,next_run_at=$3,source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [scheduleId, enabled, resumeNext],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'schedule',
          scheduleId,
          action,
          number(schedule.version),
          number(row.version),
          number(row.source_version),
          { enabled },
        );
        return { schedule: row };
      },
    );
  }

  async enqueueDueRuns(
    limit: number,
    now = new Date(),
  ): Promise<readonly Record<string, unknown>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('run_limit_invalid');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<ResourceRow>(
        `SELECT * FROM core.work_schedules WHERE enabled AND next_run_at <= $1 ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const runs: Record<string, unknown>[] = [];
      for (const schedule of due.rows) {
        const inserted = await client.query(
          `INSERT INTO core.work_runs(id,schedule_id,scheduled_for) VALUES($1,$2,$3) ON CONFLICT(schedule_id,scheduled_for) DO NOTHING RETURNING *`,
          [id('run'), schedule.id, schedule.next_run_at],
        );
        if (inserted.rows[0]) runs.push(inserted.rows[0]);
        const scheduledFor = new Date(String(schedule.next_run_at));
        const next = nextScheduled(
          String(schedule.kind) as ScheduleInput['kind'],
          String(schedule.expression),
          scheduledFor,
          String(schedule.timezone),
        );
        await client.query(
          `UPDATE core.work_schedules SET last_run_at=$2,next_run_at=$3,enabled=CASE WHEN $3::timestamptz IS NULL THEN false ELSE enabled END,source_version=source_version+1 WHERE id=$1`,
          [schedule.id, schedule.next_run_at, next],
        );
      }
      await client.query('COMMIT');
      return runs;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async finishRun(
    runId: string,
    outcome: 'succeeded' | 'failed' | 'cancelled',
    detail: Record<string, unknown>,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.run.finish.v1',
      'run',
      runId,
      { outcome, detail },
      command,
      actor,
      context,
      async (client, operationId) => {
        const before = await lock(client, 'work_runs', runId);
        assertExpected(before, command);
        if (!['queued', 'running'].includes(String(before.state)))
          throw new NativeWorkError('run_not_active', 'Run is not active', 409);
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_runs SET state=$2,result=CASE WHEN $2='succeeded' THEN $3::jsonb ELSE NULL END,
         safe_error=CASE WHEN $2='failed' THEN $3::jsonb ELSE NULL END,finished_at=clock_timestamp(),source_version=source_version+1
         WHERE id=$1 RETURNING *`,
          [runId, outcome, detail],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'run',
          runId,
          outcome,
          number(before.version),
          number(row.version),
          number(row.source_version),
          { detail },
        );
        await this.notify(
          client,
          actor,
          operationId,
          `work.run.${outcome}`,
          `Work run ${outcome}`,
          runId,
          runId,
        );
        return { run: row };
      },
    );
  }

  async runAction(
    runId: string,
    action: 'cancel' | 'retry',
    reason: string | undefined,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    if (action === 'retry') return this.retryRun(runId, command, actor, context, reason);
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.run.action.v1',
      'run',
      runId,
      { action, reason },
      command,
      actor,
      context,
      async (client, operationId) => {
        const before = await lock(client, 'work_runs', runId);
        assertExpected(before, command);
        if (!['queued', 'running'].includes(String(before.state)))
          throw new NativeWorkError('run_not_active', 'Run is not active', 409);
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_runs SET state='cancelled',safe_error=$2,finished_at=clock_timestamp(),source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [runId, { reason: reason ?? 'Cancelled by operator' }],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'run',
          runId,
          'cancelled',
          number(before.version),
          number(row.version),
          number(row.source_version),
          { reason: reason ?? null },
        );
        return { run: row };
      },
    );
  }

  async retryRun(
    runId: string,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    reason?: string,
  ): Promise<Record<string, unknown>> {
    await this.authentication.authorize(actor, 'work.manage', undefined, context);
    return this.execute(
      'work.run.action.v1',
      'run',
      runId,
      { action: 'retry', reason },
      command,
      actor,
      context,
      async (client, operationId) => {
        const before = await lock(client, 'work_runs', runId);
        assertExpected(before, command);
        if (!['failed', 'cancelled'].includes(String(before.state)))
          throw new NativeWorkError(
            'run_retry_invalid',
            'Only failed or cancelled runs can be retried',
            409,
          );
        const updated = await client.query<ResourceRow>(
          `UPDATE core.work_runs SET state='queued',result=NULL,safe_error=NULL,started_at=NULL,finished_at=NULL,source_version=source_version+1 WHERE id=$1 RETURNING *`,
          [runId],
        );
        const row = updated.rows[0]!;
        await this.record(
          client,
          operationId,
          'run',
          runId,
          'retried',
          number(before.version),
          number(row.version),
          number(row.source_version),
          {},
        );
        return { run: row };
      },
    );
  }

  private async assign(
    client: PoolClient,
    taskId: string,
    projectId: string,
    profileId: string,
    actor: AuthenticatedPrincipal,
    assignmentKind: 'assignee' | 'reviewer' = 'assignee',
  ) {
    const member = await client.query(
      `SELECT 1 FROM core.work_project_profiles WHERE project_id=$1 AND profile_id=$2`,
      [projectId, profileId],
    );
    if (!member.rowCount) throw invalid('assignee_not_project_member');
    await client.query(
      `INSERT INTO core.work_task_assignments(task_id,profile_id,assignment_kind,assigned_by_kind,assigned_by_id) VALUES($1,$2,$3,$4,$5)`,
      [taskId, profileId, assignmentKind, actor.kind, actor.id],
    );
  }

  private async execute(
    commandType: string,
    targetKind: string,
    targetId: string,
    payload: unknown,
    command: WorkCommand,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    work: (client: PoolClient, operationId: string) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    validateCommand(command);
    const digest = createHash('sha256').update(stable(payload)).digest();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<OperationRow>(
        `SELECT command_type,payload_digest,status,result FROM core.operations WHERE actor_kind=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [actor.kind, actor.id, command.idempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.command_type !== commandType || !row.payload_digest.equals(digest))
          throw new NativeWorkError(
            'idempotency_conflict',
            'Idempotency key was used for a different command',
            409,
          );
        if (row.status !== 'succeeded' || !row.result)
          throw new NativeWorkError('operation_in_progress', 'Operation is not complete', 409);
        await client.query('COMMIT');
        return { ...row.result, replayed: true };
      }
      const operationId = id('opc');
      await client.query(
        `INSERT INTO core.operations(id,command_id,command_type,actor_kind,actor_id,target_kind,target_id,expected_resource_version,idempotency_key,payload_digest,payload,status,started_at,attempt_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',clock_timestamp(),1)`,
        [
          operationId,
          command.commandId,
          commandType,
          actor.kind,
          actor.id,
          targetKind,
          targetId,
          command.expectedVersion ?? null,
          command.idempotencyKey,
          digest,
          payload,
        ],
      );
      const result = await work(client, operationId);
      const stored = { ...result, operationId, replayed: false };
      await client.query(
        `UPDATE core.operations SET status='succeeded',result=$2,finished_at=clock_timestamp() WHERE id=$1`,
        [operationId, stored],
      );
      await this.event(
        client,
        operationId,
        commandType.replace(/\.v1$/, '.succeeded.v1'),
        targetKind,
        targetId,
        context,
        stored,
      );
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private async record(
    client: PoolClient,
    operationId: string,
    resourceKind: string,
    resourceId: string,
    action: string,
    beforeVersion: number | null,
    afterVersion: number,
    sourceVersion: number,
    evidence: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO core.work_evidence(id,operation_id,resource_kind,resource_id,action,before_version,after_version,source_version,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id('evd'),
        operationId,
        resourceKind,
        resourceId,
        action,
        beforeVersion,
        afterVersion,
        sourceVersion,
        evidence,
      ],
    );
  }
  private async event(
    client: PoolClient,
    operationId: string,
    eventType: string,
    kind: string,
    resourceId: string,
    context: RequestContext,
    payload: Record<string, unknown>,
  ) {
    const correlationId =
      context.correlationId && /^cor_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.correlationId)
        ? context.correlationId
        : id('cor');
    await client.query(
      `INSERT INTO core.events(id,event_type,aggregate_kind,aggregate_id,operation_id,correlation_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
      [id('evt'), eventType, kind, resourceId, operationId, correlationId, payload],
    );
  }
  private async notify(
    client: PoolClient,
    actor: AuthenticatedPrincipal,
    operationId: string,
    category: string,
    title: string,
    body: string,
    resourceId: string,
  ) {
    await client.query(
      `INSERT INTO core.notifications(id,recipient_kind,recipient_id,category,severity,title,body,operation_id,deduplication_key,metadata) VALUES($1,$2,$3,$4,'info',$5,$6,$7,$8,$9) ON CONFLICT(recipient_kind,recipient_id,deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        id('ntf'),
        actor.kind,
        actor.id,
        category,
        title,
        body,
        operationId,
        `${operationId}:${category}`,
        { resourceId },
      ],
    );
  }
}

async function lock(
  client: PoolClient,
  table: 'work_projects' | 'work_boards' | 'work_tasks' | 'work_schedules' | 'work_runs',
  resourceId: string,
): Promise<ResourceRow> {
  const result = await client.query<ResourceRow>(
    `SELECT * FROM core.${table} WHERE id=$1 FOR UPDATE`,
    [resourceId],
  );
  if (!result.rows[0]) throw missing(`${table.replace('work_', '').replace(/s$/, '')}_not_found`);
  return result.rows[0];
}
function assertExpected(row: ResourceRow, command: WorkCommand) {
  if (command.expectedVersion === undefined) throw invalid('expected_version_required');
  if (number(row.version) !== command.expectedVersion)
    throw new NativeWorkError('version_conflict', 'Resource version conflict', 409);
  if (command.expectedSourceVersion === undefined)
    throw invalid('expected_source_version_required');
  if (number(row.source_version) !== command.expectedSourceVersion)
    throw new NativeWorkError('source_version_mismatch', 'Source version conflict', 409);
}
function projectTransition(state: string, action: string): string {
  const transitions: Record<string, Record<string, string>> = {
    saved: { start: 'active', archive: 'archived' },
    scheduled: { start: 'active', archive: 'archived' },
    active: { pause: 'paused', finish: 'finished', archive: 'archived' },
    paused: { resume: 'active', archive: 'archived' },
    finished: { reflect: 'reflected', archive: 'archived' },
    reflected: { archive: 'archived' },
    archived: { restore: 'saved' },
  };
  const next = transitions[state]?.[action];
  if (!next)
    throw new NativeWorkError(
      'project_transition_invalid',
      `Cannot ${action} project in ${state}`,
      409,
    );
  return next;
}
function taskTransition(state: string, action: string): string {
  if (action === 'move') return state;
  const transitions: Record<string, Record<string, string>> = {
    open: { start: 'running', block: 'blocked', complete: 'completed', archive: 'archived' },
    running: { block: 'blocked', complete: 'completed', archive: 'archived' },
    blocked: { unblock: 'open', archive: 'archived' },
    completed: { archive: 'archived' },
    archived: {},
  };
  const next = transitions[state]?.[action];
  if (!next)
    throw new NativeWorkError('task_transition_invalid', `Cannot ${action} task in ${state}`, 409);
  return next;
}
function nextScheduled(
  kind: ScheduleInput['kind'],
  expression: string,
  after: Date,
  timezone: string,
): Date | null {
  if (kind === 'at') {
    const at = new Date(expression);
    return at > after ? at : null;
  }
  if (kind === 'every') {
    const match = /^(\d+)([smhd])$/.exec(expression)!;
    const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!]!;
    return new Date(after.getTime() + Number(match[1]) * unit);
  }
  const fields = expression.trim().split(/\s+/);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (
    let attempt = 0;
    attempt < 527_040;
    attempt += 1, candidate = new Date(candidate.getTime() + 60_000)
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    const values = [
      Number(parts.minute),
      Number(parts.hour),
      Number(parts.day),
      Number(parts.month),
      weekdays[parts.weekday!]!,
    ];
    const limits: readonly [number, number][] = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];
    const coreMatches = [0, 1, 3].every((index) =>
      cronFieldMatches(fields[index]!, values[index]!, limits[index]!),
    );
    const dayOfMonthMatches = cronFieldMatches(fields[2]!, values[2]!, limits[2]!);
    const dayOfWeekMatches = cronFieldMatches(fields[4]!, values[4]!, limits[4]!);
    const dayMatches =
      fields[2] === '*'
        ? dayOfWeekMatches
        : fields[4] === '*'
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;
    if (coreMatches && dayMatches) return candidate;
  }
  throw invalid('schedule_no_future_occurrence');
}

function cronFieldMatches(
  field: string,
  value: number,
  [minimum, maximum]: readonly [number, number],
): boolean {
  return field.split(',').some((part) => {
    const [rangeText, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let start = minimum;
    let end = maximum;
    if (rangeText !== '*') {
      const bounds = rangeText!.split('-').map(Number);
      start = bounds[0]!;
      end = bounds.length === 2 ? bounds[1]! : start;
    }
    return (
      start >= minimum &&
      end <= maximum &&
      start <= end &&
      value >= start &&
      value <= end &&
      (value - start) % step === 0
    );
  });
}

function validateSchedule(input: ScheduleInput): void {
  if (!input.expression.trim() || !input.timezone.trim() || input.timezone.length > 100)
    throw invalid('schedule_input_invalid');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(new Date());
  } catch {
    throw invalid('schedule_timezone_invalid');
  }
  if (input.kind === 'at' && Number.isNaN(Date.parse(input.expression)))
    throw invalid('schedule_expression_invalid');
  if (
    input.kind === 'every' &&
    (!/^\d+[smhd]$/.test(input.expression) || Number.parseInt(input.expression, 10) < 1)
  )
    throw invalid('schedule_expression_invalid');
  if (input.kind === 'cron') {
    const fields = input.expression.trim().split(/\s+/);
    const limits: readonly [number, number][] = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];
    if (
      fields.length !== 5 ||
      !fields.every((field, index) => {
        const [minimum, maximum] = limits[index]!;
        return Array.from({ length: maximum - minimum + 1 }, (_, offset) => minimum + offset).some(
          (value) => cronFieldMatches(field!, value, limits[index]!),
        );
      })
    )
      throw invalid('schedule_expression_invalid');
  }
}

function validateCommand(command: WorkCommand) {
  if (!/^cmd_[0-9A-HJKMNP-TV-Z]{26}$/.test(command.commandId)) throw invalid('command_id_invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(command.idempotencyKey))
    throw invalid('idempotency_key_invalid');
}
function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function id(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
function number(value: string | number): number {
  return Number(value);
}
function invalid(code: string): NativeWorkError {
  return new NativeWorkError(code, code.replaceAll('_', ' '), 422);
}
function missing(code: string): NativeWorkError {
  return new NativeWorkError(code, code.replaceAll('_', ' '), 404);
}
function translate(error: unknown): unknown {
  if (error instanceof NativeWorkError) return error;
  const candidate = error as { code?: string; constraint?: string };
  if (candidate.code === '23505')
    return new NativeWorkError('work_conflict', 'Work resource conflicts with existing state', 409);
  if (candidate.code === '23503')
    return new NativeWorkError(
      'work_reference_invalid',
      'Referenced work resource does not exist',
      422,
    );
  if (candidate.code === '23514')
    return new NativeWorkError(
      'work_constraint_invalid',
      'Work resource violates a domain constraint',
      422,
    );
  if (candidate.code === '40001')
    return new NativeWorkError('version_conflict', 'Resource version conflict', 409);
  return error;
}
