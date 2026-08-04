import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ulid } from 'ulid';
import type { HermesProfile, HermesProfileCommand } from '@aquiero/contracts';
import type { AuthenticatedPrincipal, RequestContext } from '../auth/types.js';
import type { AuthenticationService } from '../auth/service.js';
import type { FrameworkGatewayService } from '../frameworks/service.js';

export type ProfileDesiredState = 'active' | 'inactive' | 'deleted';
export type ProfileObservedState = 'unknown' | 'active' | 'inactive' | 'missing' | 'unavailable';

export interface NativeProfileRecord {
  readonly id: string;
  readonly frameworkId: string;
  readonly nativeReference: string;
  readonly name: string;
  readonly description: string | null;
  readonly protected: boolean;
  readonly desiredState: ProfileDesiredState;
  readonly observedState: ProfileObservedState;
  readonly observedVersion: string | null;
  readonly sourceVersion: string | null;
  readonly lastObservedAt: Date | null;
  readonly version: number;
}

export interface NativeAgentRecord {
  readonly id: string;
  readonly frameworkId: string;
  readonly nativeReference: string;
  readonly name: string;
  readonly desiredState: ProfileDesiredState;
  readonly observedState: ProfileObservedState;
  readonly version: number;
}

export interface ProfileAssignmentRecord {
  readonly agentId: string;
  readonly profileId: string;
  readonly role: 'primary' | 'fallback';
  readonly desiredState: 'assigned' | 'unassigned';
  readonly observedState: 'unknown' | 'assigned' | 'unassigned' | 'conflict';
  readonly version: number;
}

export class NativeProfileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409 | 422 | 502 | 503,
  ) {
    super(message);
    this.name = 'NativeProfileError';
  }
}

export interface ProfileLifecycleInput {
  readonly frameworkId: string;
  readonly nativeReference: string;
  readonly name: string;
  readonly description?: string;
  readonly protected?: boolean;
}

export interface ProfileInventory {
  readonly frameworks: readonly {
    id: string;
    name: string;
    desiredState: string;
    observedState: string;
  }[];
  readonly agents: readonly NativeAgentRecord[];
  readonly profiles: readonly NativeProfileRecord[];
  readonly assignments: readonly ProfileAssignmentRecord[];
}

interface ProfileRow extends QueryResultRow {
  id: string;
  framework_id: string;
  native_reference: string;
  name: string;
  description: string | null;
  protected: boolean;
  desired_state: ProfileDesiredState;
  observed_state: ProfileObservedState;
  observed_version: string | null;
  source_version: string | null;
  last_observed_at: Date | null;
  version: string | number;
}

export class NativeProfileService {
  constructor(
    private readonly pool: Pool,
    private readonly authentication: AuthenticationService,
    private readonly frameworks: FrameworkGatewayService,
  ) {}

  async inventory(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    frameworkId?: string,
  ): Promise<ProfileInventory> {
    await this.authentication.authorize(actor, 'profiles.read', undefined, context);
    const params = frameworkId ? [frameworkId] : [];
    const where = frameworkId ? ' WHERE framework_id=$1' : '';
    const [frameworks, agents, profiles, assignments] = await Promise.all([
      this.frameworks.listFrameworks(actor, context),
      this.pool.query(`${agentSelect()}${where} ORDER BY name,id`, params),
      this.pool.query<ProfileRow>(`${profileSelect()}${where} ORDER BY name,id`, params),
      this.pool.query(
        `SELECT assignment.agent_id,assignment.profile_id,assignment.role,assignment.desired_state,
                assignment.observed_state,assignment.version
         FROM core.profile_assignments assignment
         JOIN core.profiles profile ON profile.id=assignment.profile_id
         ${frameworkId ? 'WHERE profile.framework_id=$1' : ''}
         ORDER BY assignment.agent_id,assignment.role`,
        params,
      ),
    ]);
    return {
      frameworks: frameworks
        .filter((item) => !frameworkId || item.id === frameworkId)
        .map((item) => ({
          id: item.id,
          name: item.name,
          desiredState: item.desiredState,
          observedState: item.observedState,
        })),
      agents: agents.rows.map(agentFromRow),
      profiles: profiles.rows.map(profileFromRow),
      assignments: assignments.rows.map(assignmentFromRow),
    };
  }

  async create(
    input: ProfileLifecycleInput,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<NativeProfileRecord> {
    await this.authentication.authorize(
      actor,
      'profiles.manage',
      { kind: 'framework', id: input.frameworkId },
      context,
    );
    validateNativeReference(input.nativeReference);
    if (!input.name.trim() || input.name.length > 200)
      throw new NativeProfileError('profile_name_invalid', 'Profile name is invalid', 422);
    const id = canonicalId('prf');
    try {
      await this.pool.query(
        `INSERT INTO core.profiles
           (id,framework_id,native_reference,name,description,protected,desired_state)
         VALUES ($1,$2,$3,$4,$5,$6,'active')`,
        [
          id,
          input.frameworkId,
          input.nativeReference,
          input.name.trim(),
          input.description?.trim() || null,
          input.protected ?? false,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new NativeProfileError('profile_conflict', 'Profile already exists', 409);
      throw error;
    }
    const before = await this.frameworks.listNativeProfiles(input.frameworkId, actor, context);
    await this.execute(
      input.frameworkId,
      {
        operation: 'profile.create',
        targetId: input.nativeReference,
        payload: { ...(input.description ? { description: input.description } : {}) },
        expectedSourceVersion: before.sourceVersion,
      },
      actor,
      context,
      'create',
      id,
    );
    await this.reconcile(input.frameworkId, actor, context);
    return this.get(id, actor, context);
  }

  async update(
    profileId: string,
    input: { description?: string | null; desiredState?: 'active' | 'inactive' },
    expectedVersion: number,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<NativeProfileRecord> {
    const current = await this.get(profileId, actor, context);
    await this.authentication.authorize(
      actor,
      'profiles.manage',
      { kind: 'profile', id: profileId },
      context,
    );
    const result = await this.pool.query(
      `UPDATE core.profiles SET
         description=CASE WHEN $3 THEN $4 ELSE description END,
         desired_state=coalesce($5,desired_state)
       WHERE id=$1 AND version=$2 AND desired_state <> 'deleted'`,
      [
        profileId,
        expectedVersion,
        Object.hasOwn(input, 'description'),
        input.description?.trim() || null,
        input.desiredState ?? null,
      ],
    );
    if (result.rowCount !== 1) throw versionConflict();
    const before = await this.frameworks.listNativeProfiles(current.frameworkId, actor, context);
    await this.execute(
      current.frameworkId,
      {
        operation: 'profile.update',
        targetId: current.nativeReference,
        payload: Object.hasOwn(input, 'description')
          ? { description: input.description ?? '' }
          : {},
        expectedSourceVersion: before.sourceVersion,
      },
      actor,
      context,
      'update',
      profileId,
      expectedVersion,
    );
    await this.reconcile(current.frameworkId, actor, context);
    return this.get(profileId, actor, context);
  }

  async delete(
    profileId: string,
    expectedVersion: number,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<NativeProfileRecord> {
    const current = await this.get(profileId, actor, context);
    await this.authentication.authorize(
      actor,
      'profiles.manage',
      { kind: 'profile', id: profileId },
      context,
    );
    if (current.protected)
      throw new NativeProfileError(
        'profile_protected',
        'Protected profiles cannot be deleted',
        403,
      );
    const changed = await this.pool.query(
      `UPDATE core.profiles SET desired_state='deleted'
       WHERE id=$1 AND version=$2 AND desired_state <> 'deleted'`,
      [profileId, expectedVersion],
    );
    if (changed.rowCount !== 1) throw versionConflict();
    const before = await this.frameworks.listNativeProfiles(current.frameworkId, actor, context);
    await this.execute(
      current.frameworkId,
      {
        operation: 'profile.delete',
        targetId: current.nativeReference,
        payload: {},
        expectedSourceVersion: before.sourceVersion,
      },
      actor,
      context,
      'delete',
      profileId,
      expectedVersion,
    );
    await this.reconcile(current.frameworkId, actor, context);
    return this.get(profileId, actor, context);
  }

  async assign(
    agentId: string,
    profileId: string,
    role: 'primary' | 'fallback',
    expectedAgentVersion: number,
    expectedProfileVersion: number,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<ProfileAssignmentRecord> {
    await this.authentication.authorize(
      actor,
      'profiles.manage',
      { kind: 'profile', id: profileId },
      context,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        agent_version: number;
        profile_version: number;
        framework_id: string;
      }>(
        `SELECT agent.version AS agent_version,profile.version AS profile_version,profile.framework_id
         FROM core.agents agent CROSS JOIN core.profiles profile
         WHERE agent.id=$1 AND profile.id=$2 AND agent.framework_id=profile.framework_id
         FOR UPDATE OF agent,profile`,
        [agentId, profileId],
      );
      const row = locked.rows[0];
      if (!row)
        throw new NativeProfileError(
          'assignment_target_not_found',
          'Agent or profile was not found',
          404,
        );
      if (
        Number(row.agent_version) !== expectedAgentVersion ||
        Number(row.profile_version) !== expectedProfileVersion
      )
        throw versionConflict();
      await client.query(
        `INSERT INTO core.profile_assignments
           (agent_id,profile_id,role,desired_state,observed_state)
         VALUES ($1,$2,$3,'assigned','assigned')
         ON CONFLICT (agent_id,profile_id) DO UPDATE
         SET role=excluded.role,desired_state='assigned',observed_state='assigned'`,
        [agentId, profileId, role],
      );
      await evidence(
        client,
        actor,
        context,
        row.framework_id,
        profileId,
        'assign',
        expectedProfileVersion,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const row = await this.pool.query(
      `SELECT agent_id,profile_id,role,desired_state,observed_state,version
       FROM core.profile_assignments WHERE agent_id=$1 AND profile_id=$2`,
      [agentId, profileId],
    );
    return assignmentFromRow(row.rows[0]);
  }

  async get(
    profileId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<NativeProfileRecord> {
    await this.authentication.authorize(
      actor,
      'profiles.read',
      { kind: 'profile', id: profileId },
      context,
    );
    const result = await this.pool.query<ProfileRow>(`${profileSelect()} WHERE id=$1`, [profileId]);
    if (!result.rows[0])
      throw new NativeProfileError('profile_not_found', 'Profile was not found', 404);
    return profileFromRow(result.rows[0]);
  }

  async reconcile(
    frameworkId: string,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    expectedSourceVersion?: string,
  ): Promise<{
    id: string;
    status: 'converged' | 'drifted';
    sourceVersion: string;
    changes: readonly unknown[];
  }> {
    await this.authentication.authorize(
      actor,
      'frameworks.manage',
      { kind: 'framework', id: frameworkId },
      context,
    );
    const snapshot = await this.frameworks.listNativeProfiles(frameworkId, actor, context);
    if (expectedSourceVersion && snapshot.sourceVersion !== expectedSourceVersion)
      throw new NativeProfileError(
        'profile_source_version_conflict',
        'Hermes profile inventory changed before reconciliation',
        409,
      );
    const client = await this.pool.connect();
    const reconciliationId = canonicalId('rec');
    const changes: unknown[] = [];
    try {
      await client.query('BEGIN');
      const previous = await client.query<ProfileRow>(
        `${profileSelect()} WHERE framework_id=$1 FOR UPDATE`,
        [frameworkId],
      );
      const byNative = new Map(previous.rows.map((row) => [row.native_reference, row]));
      const observed = new Set(snapshot.data.items.map((item) => item.id));
      for (const item of snapshot.data.items) {
        const existing = byNative.get(item.id);
        const observedState: ProfileObservedState = item.active ? 'active' : 'inactive';
        const profileId = existing?.id ?? canonicalId('prf');
        await client.query(
          `INSERT INTO core.profiles
             (id,framework_id,native_reference,name,desired_state,observed_state,observed_version,
              source_version,last_observed_at)
           VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8)
           ON CONFLICT (framework_id,native_reference) DO UPDATE SET
             name=excluded.name,observed_state=excluded.observed_state,
             observed_version=excluded.observed_version,source_version=excluded.source_version,
             last_observed_at=excluded.last_observed_at`,
          [
            profileId,
            frameworkId,
            item.id,
            item.displayName,
            observedState,
            observedVersion(item),
            snapshot.sourceVersion,
            new Date(snapshot.observedAt),
          ],
        );
        const agentId = await upsertAgent(client, frameworkId, item, observedState);
        await client.query(
          `INSERT INTO core.profile_assignments
             (agent_id,profile_id,role,desired_state,observed_state)
           VALUES ($1,$2,'primary','assigned','assigned')
           ON CONFLICT (agent_id,profile_id) DO UPDATE SET observed_state='assigned'`,
          [agentId, profileId],
        );
        if (!existing || existing.observed_state !== observedState)
          changes.push({
            profileId,
            nativeReference: item.id,
            from: existing?.observed_state ?? 'absent',
            to: observedState,
          });
      }
      for (const row of previous.rows.filter((item) => !observed.has(item.native_reference))) {
        await client.query(
          `UPDATE core.profiles SET observed_state='missing',source_version=$2,last_observed_at=$3 WHERE id=$1`,
          [row.id, snapshot.sourceVersion, new Date(snapshot.observedAt)],
        );
        await client.query(
          `UPDATE core.agents SET observed_state='missing'
           WHERE framework_id=$1 AND native_reference=$2`,
          [frameworkId, row.native_reference],
        );
        if (row.observed_state !== 'missing')
          changes.push({
            profileId: row.id,
            nativeReference: row.native_reference,
            from: row.observed_state,
            to: 'missing',
          });
      }
      await client.query(
        `INSERT INTO core.profile_inventory_observations
           (id,framework_id,source_version,observed_at,item_count,document)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          canonicalId('pob'),
          frameworkId,
          snapshot.sourceVersion,
          new Date(snapshot.observedAt),
          snapshot.data.items.length,
          JSON.stringify({ items: snapshot.data.items }),
        ],
      );
      const drift = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.profiles
         WHERE framework_id=$1 AND
           ((desired_state='deleted' AND observed_state <> 'missing') OR
            (desired_state='active' AND observed_state NOT IN ('active','inactive')) OR
            (desired_state='inactive' AND observed_state <> 'inactive'))`,
        [frameworkId],
      );
      const status = Number(drift.rows[0]?.count ?? 0) === 0 ? 'converged' : 'drifted';
      await client.query(
        `INSERT INTO core.profile_reconciliations
           (id,framework_id,actor_kind,actor_id,request_id,correlation_id,
            expected_source_version,observed_source_version,status,changes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          reconciliationId,
          frameworkId,
          actor.kind,
          actor.id,
          requestId(context),
          correlationId(context),
          expectedSourceVersion ?? null,
          snapshot.sourceVersion,
          status,
          JSON.stringify(changes),
        ],
      );
      await evidence(
        client,
        actor,
        context,
        frameworkId,
        null,
        'reconcile',
        undefined,
        snapshot.sourceVersion,
        { reconciliationId, status, changes: changes.length },
      );
      await client.query('COMMIT');
      return { id: reconciliationId, status, sourceVersion: snapshot.sourceVersion, changes };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async execute(
    frameworkId: string,
    input: Pick<
      HermesProfileCommand,
      'operation' | 'targetId' | 'payload' | 'expectedSourceVersion'
    >,
    actor: AuthenticatedPrincipal,
    context: RequestContext,
    action: 'create' | 'update' | 'delete',
    profileId: string,
    expectedVersion?: number,
  ) {
    const command: HermesProfileCommand = {
      mode: 'execute',
      idempotencyKey: `${requestId(context)}:${action}:${profileId}`,
      requestId: requestId(context),
      correlationId: correlationId(context),
      actor: { type: actor.kind, id: actor.id },
      operation: input.operation,
      targetId: input.targetId,
      payload: input.payload,
      ...(input.expectedSourceVersion
        ? { expectedSourceVersion: input.expectedSourceVersion }
        : {}),
    };
    try {
      const result = await this.frameworks.executeNativeProfile(
        frameworkId,
        command,
        actor,
        context,
      );
      await evidence(
        this.pool,
        actor,
        context,
        frameworkId,
        profileId,
        action,
        expectedVersion,
        result.sourceVersion,
        { operationId: result.data.operationId, replayed: result.data.replayed },
      );
      return result;
    } catch (error) {
      try {
        await evidence(
          this.pool,
          actor,
          context,
          frameworkId,
          profileId,
          action,
          expectedVersion,
          input.expectedSourceVersion,
          { safeErrorCode: safeFailureCode(error) },
          'failed',
        );
      } catch {
        // Preserve the authoritative gateway failure if evidence persistence is unavailable.
      }
      throw error;
    }
  }
}

async function upsertAgent(
  client: PoolClient,
  frameworkId: string,
  item: HermesProfile,
  observedState: ProfileObservedState,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM core.agents WHERE framework_id=$1 AND native_reference=$2',
    [frameworkId, item.id],
  );
  const id = existing.rows[0]?.id ?? canonicalId('agt');
  await client.query(
    `INSERT INTO core.agents
       (id,framework_id,native_reference,name,desired_state,observed_state)
     VALUES ($1,$2,$3,$4,'active',$5)
     ON CONFLICT (framework_id,native_reference) DO UPDATE
     SET name=excluded.name,observed_state=excluded.observed_state`,
    [id, frameworkId, item.id, item.displayName, observedState],
  );
  return id;
}

async function evidence(
  client: Pool | PoolClient,
  actor: AuthenticatedPrincipal,
  context: RequestContext,
  frameworkId: string,
  profileId: string | null,
  action: 'create' | 'update' | 'delete' | 'assign' | 'unassign' | 'reconcile',
  expectedVersion?: number,
  sourceVersion?: string,
  details: Record<string, unknown> = {},
  outcome: 'succeeded' | 'failed' = 'succeeded',
) {
  const current = profileId
    ? await client.query<{ version: number }>('SELECT version FROM core.profiles WHERE id=$1', [
        profileId,
      ])
    : { rows: [] };
  await client.query(
    `INSERT INTO core.profile_lifecycle_evidence
       (id,framework_id,profile_id,action,actor_kind,actor_id,request_id,correlation_id,
        expected_version,resulting_version,source_version,outcome,details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      canonicalId('pev'),
      frameworkId,
      profileId,
      action,
      actor.kind,
      actor.id,
      requestId(context),
      correlationId(context),
      expectedVersion ?? null,
      current.rows[0]?.version ?? null,
      sourceVersion ?? null,
      outcome,
      JSON.stringify(details),
    ],
  );
}

function safeFailureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (/^[A-Za-z0-9._-]{1,128}$/.test(code)) return code;
  }
  return 'profile_gateway_failure';
}

function profileSelect() {
  return `SELECT id,framework_id,native_reference,name,description,protected,desired_state,
                 observed_state,observed_version,source_version,last_observed_at,version
          FROM core.profiles`;
}

function agentSelect() {
  return `SELECT id,framework_id,native_reference,name,desired_state,observed_state,version
          FROM core.agents`;
}

function profileFromRow(row: ProfileRow): NativeProfileRecord {
  return {
    id: row.id,
    frameworkId: row.framework_id,
    nativeReference: row.native_reference,
    name: row.name,
    description: row.description,
    protected: row.protected,
    desiredState: row.desired_state,
    observedState: row.observed_state,
    observedVersion: row.observed_version,
    sourceVersion: row.source_version,
    lastObservedAt: row.last_observed_at,
    version: Number(row.version),
  };
}

function agentFromRow(row: Record<string, unknown>): NativeAgentRecord {
  return {
    id: String(row.id),
    frameworkId: String(row.framework_id),
    nativeReference: String(row.native_reference),
    name: String(row.name),
    desiredState: row.desired_state as ProfileDesiredState,
    observedState: row.observed_state as ProfileObservedState,
    version: Number(row.version),
  };
}

function assignmentFromRow(row: Record<string, unknown> | undefined): ProfileAssignmentRecord {
  if (!row) throw new NativeProfileError('assignment_not_found', 'Assignment was not found', 404);
  return {
    agentId: String(row.agent_id),
    profileId: String(row.profile_id),
    role: row.role as 'primary' | 'fallback',
    desiredState: row.desired_state as 'assigned' | 'unassigned',
    observedState: row.observed_state as ProfileAssignmentRecord['observedState'],
    version: Number(row.version),
  };
}

function observedVersion(item: HermesProfile): string {
  return [
    item.active ? 'active' : 'inactive',
    item.gatewayStatus,
    item.provider ?? '',
    item.model ?? '',
  ].join(':');
}

function validateNativeReference(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(value))
    throw new NativeProfileError(
      'profile_reference_invalid',
      'Native profile reference is invalid',
      422,
    );
}

function canonicalId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

const contextIdentities = new WeakMap<
  RequestContext,
  { requestId: string; correlationId: string }
>();

function identity(context: RequestContext) {
  const existing = contextIdentities.get(context);
  if (existing) return existing;
  const generated = {
    requestId:
      context.requestId && /^req_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.requestId)
        ? context.requestId
        : canonicalId('req'),
    correlationId:
      context.correlationId && /^cor_[0-9A-HJKMNP-TV-Z]{26}$/.test(context.correlationId)
        ? context.correlationId
        : canonicalId('cor'),
  };
  contextIdentities.set(context, generated);
  return generated;
}

function requestId(context: RequestContext): string {
  return identity(context).requestId;
}

function correlationId(context: RequestContext): string {
  return identity(context).correlationId;
}

function versionConflict() {
  return new NativeProfileError(
    'profile_version_conflict',
    'Profile or assignment changed; refresh and retry with the current version',
    409,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
