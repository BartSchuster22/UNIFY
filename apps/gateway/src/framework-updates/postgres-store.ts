import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  CandidateAssessment,
  DeploymentMetadata,
  DeploymentMetadataInput,
  FrameworkReleasePolicy,
  FrameworkRolloutPlan,
  FrameworkUpdateStore,
  StoredComparison,
  StoredUpdateCandidate,
  TrustedRelease,
  UpdateSourceState,
} from './types.js';

export class PostgresFrameworkUpdateStore implements FrameworkUpdateStore {
  constructor(private readonly pool: Pool) {}

  async ready(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1 FROM framework_update_sources LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  async reconcileDeployments(items: readonly DeploymentMetadataInput[]): Promise<void> {
    for (const item of items) {
      await this.pool.query(
        `INSERT INTO framework_deployments(
           framework_id,release_id,image_reference,image_digest,framework_version,framework_commit
         )
         SELECT $1,$2,$3,$4,$5,$6
         WHERE EXISTS (SELECT 1 FROM framework_registrations WHERE id=$1)
         ON CONFLICT(framework_id) DO NOTHING`,
        [
          item.frameworkId,
          item.releaseId,
          item.imageReference,
          item.imageDigest,
          item.frameworkVersion,
          item.frameworkCommit,
        ],
      );
    }
  }

  async recordDiscoverySuccess(
    sourceId: string,
    repository: string,
    release: TrustedRelease,
    comparisons: readonly Omit<StoredComparison, 'candidateId' | 'checkedAt'>[],
  ): Promise<StoredUpdateCandidate> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO framework_update_sources(
           source_id,repository,trusted,last_checked_at,last_success_at,safe_error,updated_at
         ) VALUES($1,$2,true,now(),now(),NULL,now())
         ON CONFLICT(source_id) DO UPDATE SET
           repository=excluded.repository,trusted=true,last_checked_at=now(),last_success_at=now(),
           safe_error=NULL,updated_at=now()`,
        [sourceId, repository],
      );
      const candidateId = candidateIdentifier(repository, release.tagName);
      const result = await client.query(
        `INSERT INTO framework_update_candidates(
           candidate_id,source_id,tag_name,release_name,commit_sha,release_url,release_notes,
           published_at,prerelease,draft
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(source_id,tag_name) DO UPDATE SET
           release_name=excluded.release_name,commit_sha=excluded.commit_sha,
           release_url=excluded.release_url,release_notes=excluded.release_notes,
           published_at=excluded.published_at,prerelease=excluded.prerelease,draft=excluded.draft,
           discovered_at=now()
         RETURNING *`,
        [
          candidateId,
          sourceId,
          release.tagName,
          release.releaseName,
          release.commitSha,
          release.releaseUrl,
          release.releaseNotes,
          release.publishedAt,
          release.prerelease,
          release.draft,
        ],
      );
      for (const comparison of comparisons) {
        await client.query(
          `INSERT INTO framework_update_comparisons(
             framework_id,candidate_id,relation,github_status,ahead_by,behind_by,checked_at
           ) VALUES($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT(framework_id,candidate_id) DO UPDATE SET
             relation=excluded.relation,github_status=excluded.github_status,
             ahead_by=excluded.ahead_by,behind_by=excluded.behind_by,checked_at=now()`,
          [
            comparison.frameworkId,
            candidateId,
            comparison.relation,
            comparison.githubStatus,
            comparison.aheadBy,
            comparison.behindBy,
          ],
        );
      }
      await client.query('COMMIT');
      return mapCandidate(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDiscoveryFailure(
    sourceId: string,
    repository: string,
    safeError: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO framework_update_sources(
         source_id,repository,trusted,last_checked_at,safe_error,updated_at
       ) VALUES($1,$2,true,now(),$3,now())
       ON CONFLICT(source_id) DO UPDATE SET
         repository=excluded.repository,trusted=true,last_checked_at=now(),safe_error=$3,updated_at=now()`,
      [sourceId, repository, safeError.slice(0, 500)],
    );
  }

  async createRolloutPlan(
    actorUserId: string,
    frameworkIds: readonly string[],
  ): Promise<FrameworkRolloutPlan> {
    const ids = [...new Set(frameworkIds)];
    if (
      ids.length === 0 ||
      ids.length > 2 ||
      ids.some((id) => id !== 'hermes-alica' && id !== 'hermes-herman')
    )
      throw rolloutError('Select Alica, Herman, or both exactly once', 422);
    const client = await this.pool.connect();
    const planId = randomUUID();
    try {
      await client.query('BEGIN');
      const candidate = await client.query(
        `SELECT c.*,a.*
         FROM (
           SELECT * FROM framework_update_candidates
           WHERE draft=false AND prerelease=false
           ORDER BY published_at DESC LIMIT 1
         ) c
         JOIN LATERAL (
           SELECT * FROM framework_candidate_assessments
           WHERE candidate_id=c.candidate_id ORDER BY assessed_at DESC LIMIT 1
         ) a ON true
         WHERE a.state='ready' AND a.contract_passed AND a.acceptance_passed
           AND a.source_commit=c.commit_sha`,
      );
      const row = candidate.rows[0] as Record<string, unknown> | undefined;
      if (!row?.image_reference || !row.image_digest)
        throw rolloutError('No rollout-ready assessed candidate is available', 409);
      const release = String((row.evidence as Record<string, unknown>)?.release ?? '');
      if (!/^[0-9A-Za-z._-]+$/u.test(release))
        throw rolloutError('Candidate evidence does not contain a valid framework release', 409);
      const policyResult = await client.query(
        "SELECT * FROM framework_release_policies WHERE policy_id='default' FOR SHARE",
      );
      const policy = mapPolicy(policyResult.rows[0]);
      if (ids.length === 2)
        ids.sort((left, right) =>
          left === policy.canaryFrameworkId ? -1 : right === policy.canaryFrameworkId ? 1 : 0,
        );
      const deployments = await client.query(
        `SELECT r.id,d.* FROM framework_registrations r
         JOIN framework_deployments d ON d.framework_id=r.id
         WHERE r.id=ANY($1::text[]) AND r.adapter_id='hermes-control/v1'
         ORDER BY array_position($1::text[],r.id)`,
        [ids],
      );
      if (deployments.rows.length !== ids.length)
        throw rolloutError('Every rollout target must have deployment metadata', 409);
      await client.query(
        `INSERT INTO framework_rollout_plans(
           plan_id,candidate_id,assessment_id,state,created_by,operation_kind,policy_snapshot
         ) VALUES($1,$2,$3,'planned',$4,'release',$5)`,
        [planId, row.candidate_id, row.assessment_id, actorUserId, policy],
      );
      for (const [index, deployment] of deployments.rows.entries()) {
        const imageReference = String(row.image_reference);
        const imageDigest = String(row.image_digest);
        await client.query(
          `INSERT INTO framework_rollout_targets(
             plan_id,framework_id,ordinal,state,
             previous_release_id,previous_image_reference,previous_image_digest,
             previous_framework_version,previous_framework_commit,
             target_release_id,target_image_reference,target_image_digest,
             target_framework_version,target_framework_commit
           ) VALUES($1,$2,$3,'planned',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            planId,
            deployment.id,
            index + 1,
            deployment.release_id,
            deployment.image_reference,
            deployment.image_digest,
            deployment.framework_version,
            deployment.framework_commit,
            `hermes-${String(row.tag_name)}`,
            imageReference.includes('@sha256:')
              ? imageReference
              : `${imageReference}@${imageDigest}`,
            imageDigest,
            release,
            row.source_commit,
          ],
        );
      }
      await client.query(
        `INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message)
         VALUES($1,'planned',0,'Rollout plan created')`,
        [planId],
      );
      await client.query('COMMIT');
      return (await this.rollout(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw rolloutError('An active rollout plan already exists for this candidate', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async dryRunRollout(planId: string): Promise<FrameworkRolloutPlan> {
    const result = await this.pool.query(
      `WITH valid AS (
         SELECT p.plan_id
         FROM framework_rollout_plans p
         JOIN framework_candidate_assessments a ON a.assessment_id=p.assessment_id
         JOIN framework_update_candidates c ON c.candidate_id=p.candidate_id
         WHERE p.plan_id=$1 AND p.state='planned' AND a.state='ready'
           AND a.contract_passed AND a.acceptance_passed AND a.source_commit=c.commit_sha
           AND NOT EXISTS (
             SELECT 1 FROM framework_rollout_targets t
             LEFT JOIN framework_deployments d ON d.framework_id=t.framework_id
             WHERE t.plan_id=p.plan_id AND (
               d.framework_id IS NULL OR d.release_id<>t.previous_release_id
               OR d.image_reference<>t.previous_image_reference
               OR d.image_digest<>t.previous_image_digest
               OR d.framework_version<>t.previous_framework_version
               OR d.framework_commit<>t.previous_framework_commit
               OR t.target_image_reference<>CASE WHEN a.image_reference LIKE '%@sha256:%'
                    THEN a.image_reference ELSE a.image_reference||'@'||a.image_digest END
               OR t.target_image_digest<>a.image_digest
               OR t.target_framework_version<>coalesce(a.evidence->>'release','')
               OR t.target_framework_commit<>a.source_commit
             )
           )
       ), updated_targets AS (
         UPDATE framework_rollout_targets t SET
           state='dry_run_passed',progress=20,
           dry_run_checks=jsonb_build_object(
             'candidateReady',true,'assessmentImmutable',true,'deploymentUnchanged',true,
             'targetDigestPinned',true,'independentTarget',true,'checkedAt',now()
           )
         FROM valid v WHERE t.plan_id=v.plan_id RETURNING t.plan_id
       ), updated_plan AS (
         UPDATE framework_rollout_plans p SET state='dry_run_passed',dry_run_at=now()
         FROM valid v WHERE p.plan_id=v.plan_id RETURNING p.plan_id
       )
       INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message)
       SELECT plan_id,'dry_run_passed',20,'Dry-run checks passed for every selected target'
       FROM updated_plan RETURNING plan_id`,
      [planId],
    );
    if (!result.rowCount)
      throw rolloutError('Dry-run preconditions failed or plan state changed', 409);
    return (await this.rollout(planId))!;
  }

  async approveRollout(planId: string, actorUserId: string): Promise<FrameworkRolloutPlan> {
    const result = await this.pool.query(
      `WITH updated AS (
         UPDATE framework_rollout_plans SET state='approved',approved_by=$2,approved_at=now()
         WHERE plan_id=$1 AND state='dry_run_passed' RETURNING plan_id
       )
       INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message)
       SELECT plan_id,'approved',30,'Rollout plan approved' FROM updated
       RETURNING plan_id`,
      [planId, actorUserId],
    );
    if (!result.rowCount)
      throw rolloutError('Only a successfully dry-run plan can be approved', 409);
    return (await this.rollout(planId))!;
  }

  async queueRollout(planId: string): Promise<FrameworkRolloutPlan> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE framework_rollout_plans SET state='queued',execution_requested_at=now()
         WHERE plan_id=$1 AND state='approved' RETURNING plan_id`,
        [planId],
      );
      if (!result.rowCount) throw rolloutError('Only an approved plan can be executed', 409);
      await client.query(
        `UPDATE framework_rollout_targets t SET
           state=CASE
             WHEN p.operation_kind='rollback' OR totals.target_count=1 OR t.ordinal=1 THEN 'pending'
             ELSE 'awaiting_promotion'
           END,
           progress=CASE
             WHEN p.operation_kind='rollback' OR totals.target_count=1 OR t.ordinal=1 THEN 35 ELSE 30
           END
         FROM framework_rollout_plans p,
              (SELECT count(*)::integer AS target_count FROM framework_rollout_targets WHERE plan_id=$1) totals
         WHERE t.plan_id=$1 AND p.plan_id=t.plan_id AND t.state='dry_run_passed'`,
        [planId],
      );
      await client.query(
        `INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message)
         VALUES($1,'queued',35,'Rollout queued for the governed host worker')`,
        [planId],
      );
      await client.query('COMMIT');
      return (await this.rollout(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw rolloutError('Another rollout is already queued or executing', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async promoteRollout(planId: string, actorUserId: string): Promise<FrameworkRolloutPlan> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const promoted = await client.query(
        `UPDATE framework_rollout_plans SET state='queued',promoted_by=$2,promoted_at=now()
         WHERE plan_id=$1 AND state='awaiting_promotion' RETURNING plan_id`,
        [planId, actorUserId],
      );
      if (!promoted.rowCount)
        throw rolloutError('Promotion requires a completed healthy observation window', 409);
      await client.query(
        `UPDATE framework_rollout_targets SET state='pending',progress=70
         WHERE plan_id=$1 AND state='awaiting_promotion'`,
        [planId],
      );
      await client.query(
        `INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message,details)
         VALUES($1,'queued',70,'Canary evidence approved; second instance queued for promotion',
           jsonb_build_object('promotedBy',$2::uuid))`,
        [planId, actorUserId],
      );
      await client.query('COMMIT');
      return (await this.rollout(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createRollback(
    sourcePlanId: string,
    actorUserId: string,
    reason: string,
  ): Promise<FrameworkRolloutPlan> {
    const safeReason = reason.trim();
    if (safeReason.length < 3 || safeReason.length > 500)
      throw rolloutError('Rollback reason must contain 3 to 500 characters', 422);
    const client = await this.pool.connect();
    const planId = randomUUID();
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT p.* FROM framework_rollout_plans p
         WHERE p.plan_id=$1 AND p.operation_kind='release' AND p.state IN ('succeeded','partial')
           AND EXISTS (SELECT 1 FROM framework_rollout_targets WHERE plan_id=p.plan_id AND state='converged')
         FOR UPDATE`,
        [sourcePlanId],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow)
        throw rolloutError('Only a completed release rollout can be rolled back', 409);
      const targets = await client.query(
        `SELECT t.*,d.release_id AS deployed_release_id,d.image_reference AS deployed_image_reference,
                d.image_digest AS deployed_image_digest,d.framework_version AS deployed_framework_version,
                d.framework_commit AS deployed_framework_commit
         FROM framework_rollout_targets t
         JOIN framework_deployments d ON d.framework_id=t.framework_id
         WHERE t.plan_id=$1 AND t.state='converged'
           AND d.release_id=t.target_release_id AND d.image_reference=t.target_image_reference
           AND d.image_digest=t.target_image_digest AND d.framework_version=t.target_framework_version
           AND d.framework_commit=t.target_framework_commit
         ORDER BY t.ordinal`,
        [sourcePlanId],
      );
      const convergedCount = await client.query(
        "SELECT count(*)::integer AS count FROM framework_rollout_targets WHERE plan_id=$1 AND state='converged'",
        [sourcePlanId],
      );
      if (targets.rows.length !== Number(convergedCount.rows[0]?.count ?? 0))
        throw rolloutError('Deployment changed after rollout; rollback baseline is stale', 409);
      await client.query(
        `INSERT INTO framework_rollout_plans(
           plan_id,candidate_id,assessment_id,state,created_by,approved_by,approved_at,
           execution_requested_at,operation_kind,source_plan_id,policy_snapshot,rollback_reason
         ) VALUES($1,$2,$3,'queued',$4,$4,now(),now(),'rollback',$5,$6,$7)`,
        [
          planId,
          sourceRow.candidate_id,
          sourceRow.assessment_id,
          actorUserId,
          sourcePlanId,
          sourceRow.policy_snapshot,
          safeReason,
        ],
      );
      for (const [index, target] of targets.rows.entries())
        await client.query(
          `INSERT INTO framework_rollout_targets(
             plan_id,framework_id,ordinal,state,
             previous_release_id,previous_image_reference,previous_image_digest,
             previous_framework_version,previous_framework_commit,
             target_release_id,target_image_reference,target_image_digest,
             target_framework_version,target_framework_commit,progress,dry_run_checks
           ) VALUES($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,35,
             jsonb_build_object('oneClickRollback',true,'deploymentUnchanged',true,'digestPinned',true,'checkedAt',now()))`,
          [
            planId,
            target.framework_id,
            index + 1,
            target.target_release_id,
            target.target_image_reference,
            target.target_image_digest,
            target.target_framework_version,
            target.target_framework_commit,
            target.previous_release_id,
            target.previous_image_reference,
            target.previous_image_digest,
            target.previous_framework_version,
            target.previous_framework_commit,
          ],
        );
      await client.query(
        `INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message,details)
         VALUES($1,'queued',35,'Governed one-click rollback queued',
           jsonb_build_object('sourcePlanId',$2,'reason',$3,'actorUserId',$4))`,
        [planId, sourcePlanId, safeReason, actorUserId],
      );
      await client.query('COMMIT');
      return (await this.rollout(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw rolloutError('Another rollout, promotion, or rollback is active', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async releasePolicy(): Promise<FrameworkReleasePolicy> {
    const result = await this.pool.query(
      "SELECT * FROM framework_release_policies WHERE policy_id='default'",
    );
    if (!result.rows[0]) throw rolloutError('Release policy is unavailable', 503);
    return mapPolicy(result.rows[0]);
  }

  async updateReleasePolicy(
    actorUserId: string,
    input: Pick<
      FrameworkReleasePolicy,
      'canaryFrameworkId' | 'observationWindowSeconds' | 'requiredHealthySamples'
    >,
  ): Promise<FrameworkReleasePolicy> {
    if (
      !['hermes-alica', 'hermes-herman'].includes(input.canaryFrameworkId) ||
      !Number.isInteger(input.observationWindowSeconds) ||
      input.observationWindowSeconds < 1 ||
      input.observationWindowSeconds > 86_400 ||
      !Number.isInteger(input.requiredHealthySamples) ||
      input.requiredHealthySamples < 1 ||
      input.requiredHealthySamples > 1000
    )
      throw rolloutError('Release policy values are invalid', 422);
    const result = await this.pool.query(
      `UPDATE framework_release_policies SET canary_framework_id=$1,
         observation_window_seconds=$2,required_healthy_samples=$3,updated_by=$4,updated_at=now()
       WHERE policy_id='default' RETURNING *`,
      [
        input.canaryFrameworkId,
        input.observationWindowSeconds,
        input.requiredHealthySamples,
        actorUserId,
      ],
    );
    return mapPolicy(result.rows[0]);
  }

  async rollout(planId: string): Promise<FrameworkRolloutPlan | null> {
    const plans = await this.#readRollouts('WHERE p.plan_id=$1', [planId]);
    return plans[0] ?? null;
  }

  async listRollouts(limit = 20): Promise<FrameworkRolloutPlan[]> {
    return this.#readRollouts('ORDER BY p.created_at DESC LIMIT $1', [
      Math.max(1, Math.min(limit, 100)),
    ]);
  }

  async #readRollouts(clause: string, parameters: unknown[]): Promise<FrameworkRolloutPlan[]> {
    const plans = await this.pool.query(
      `SELECT p.* FROM framework_rollout_plans p ${clause}`,
      parameters,
    );
    const output: FrameworkRolloutPlan[] = [];
    for (const row of plans.rows) {
      const targets = await this.pool.query(
        'SELECT * FROM framework_rollout_targets WHERE plan_id=$1 ORDER BY ordinal',
        [row.plan_id],
      );
      const events = await this.pool.query(
        'SELECT * FROM framework_rollout_events WHERE plan_id=$1 ORDER BY event_id DESC',
        [row.plan_id],
      );
      const observations = await this.pool.query(
        `SELECT * FROM framework_rollout_observations
         WHERE plan_id=$1 ORDER BY observation_id DESC`,
        [row.plan_id],
      );
      output.push(mapRollout(row, targets.rows, events.rows, observations.rows));
    }
    return output;
  }

  async snapshot() {
    const sourceResult = await this.pool.query(
      'SELECT * FROM framework_update_sources ORDER BY source_id LIMIT 1',
    );
    const source = sourceResult.rows[0]
      ? mapSource(sourceResult.rows[0])
      : ({ sourceId: 'hermes-agent', repository: '', trusted: true } satisfies UpdateSourceState);
    const candidateResult = await this.pool.query(
      `SELECT * FROM framework_update_candidates
       WHERE source_id=$1 AND draft=false AND prerelease=false
       ORDER BY published_at DESC LIMIT 1`,
      [source.sourceId],
    );
    const candidate = candidateResult.rows[0] ? mapCandidate(candidateResult.rows[0]) : null;
    const assessmentResult = candidate
      ? await this.pool.query(
          `SELECT * FROM framework_candidate_assessments
           WHERE candidate_id=$1
           ORDER BY assessed_at DESC, recorded_at DESC LIMIT 1`,
          [candidate.candidateId],
        )
      : { rows: [] };
    const assessment = assessmentResult.rows[0] ? mapAssessment(assessmentResult.rows[0]) : null;
    const frameworkResult = await this.pool.query(
      `SELECT r.id,r.display_name,
              d.release_id,d.image_reference,d.image_digest,d.framework_version AS deployed_version,
              d.framework_commit AS deployed_commit,d.metadata_source,d.recorded_at,
              c.relation,c.github_status,c.ahead_by,c.behind_by,c.checked_at
       FROM framework_registrations r
       LEFT JOIN framework_deployments d ON d.framework_id=r.id
       LEFT JOIN framework_update_comparisons c
         ON c.framework_id=r.id AND c.candidate_id=$1
       WHERE r.adapter_id='hermes-control/v1'
       ORDER BY r.id`,
      [candidate?.candidateId ?? null],
    );
    return {
      source,
      candidate,
      assessment,
      frameworks: frameworkResult.rows.map((row) => ({
        frameworkId: String(row.id),
        displayName: String(row.display_name),
        deployment: row.release_id ? mapDeployment(row) : null,
        comparison: row.relation && candidate ? mapComparison(row, candidate.candidateId) : null,
      })),
    };
  }
}

function mapRollout(
  row: Record<string, unknown>,
  targets: Record<string, unknown>[],
  events: Record<string, unknown>[],
  observations: Record<string, unknown>[],
): FrameworkRolloutPlan {
  const plan: FrameworkRolloutPlan = {
    planId: String(row.plan_id),
    candidateId: String(row.candidate_id),
    assessmentId: String(row.assessment_id),
    state: row.state as FrameworkRolloutPlan['state'],
    operationKind: row.operation_kind as 'release' | 'rollback',
    policySnapshot: (row.policy_snapshot ?? {}) as Record<string, unknown>,
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    targets: targets.map((target) => {
      const mapped: FrameworkRolloutPlan['targets'][number] = {
        frameworkId: target.framework_id as 'hermes-alica' | 'hermes-herman',
        ordinal: Number(target.ordinal),
        state: target.state as FrameworkRolloutPlan['targets'][number]['state'],
        previousReleaseId: String(target.previous_release_id),
        previousImageReference: String(target.previous_image_reference),
        previousImageDigest: String(target.previous_image_digest),
        previousFrameworkVersion: String(target.previous_framework_version),
        previousFrameworkCommit: String(target.previous_framework_commit),
        targetReleaseId: String(target.target_release_id),
        targetImageReference: String(target.target_image_reference),
        targetImageDigest: String(target.target_image_digest),
        targetFrameworkVersion: String(target.target_framework_version),
        targetFrameworkCommit: String(target.target_framework_commit),
        progress: Number(target.progress),
        dryRunChecks: target.dry_run_checks as Record<string, unknown>,
        convergenceChecks: target.convergence_checks as Record<string, unknown>,
        observationChecks: (target.observation_checks ?? {}) as Record<string, unknown>,
      };
      if (target.safe_error_code) mapped.safeErrorCode = String(target.safe_error_code);
      if (target.safe_error_reason) mapped.safeErrorReason = String(target.safe_error_reason);
      if (target.started_at) mapped.startedAt = iso(target.started_at);
      if (target.finished_at) mapped.finishedAt = iso(target.finished_at);
      return mapped;
    }),
    events: events.map((event) => ({
      eventId: String(event.event_id),
      ...(event.framework_id ? { frameworkId: String(event.framework_id) } : {}),
      state: String(event.state),
      progress: Number(event.progress),
      safeMessage: String(event.safe_message),
      details: (event.details ?? {}) as Record<string, unknown>,
      occurredAt: iso(event.occurred_at),
    })),
    observations: observations.map((observation) => ({
      observationId: String(observation.observation_id),
      frameworkId: String(observation.framework_id),
      healthy: Boolean(observation.healthy),
      imageIdentity: Boolean(observation.image_identity),
      releaseIdentity: Boolean(observation.release_identity),
      commitIdentity: Boolean(observation.commit_identity),
      details: (observation.details ?? {}) as Record<string, unknown>,
      observedAt: iso(observation.observed_at),
    })),
  };
  if (row.approved_by) plan.approvedBy = String(row.approved_by);
  if (row.source_plan_id) plan.sourcePlanId = String(row.source_plan_id);
  if (row.rollback_reason) plan.rollbackReason = String(row.rollback_reason);
  if (row.dry_run_at) plan.dryRunAt = iso(row.dry_run_at);
  if (row.approved_at) plan.approvedAt = iso(row.approved_at);
  if (row.execution_requested_at) plan.executionRequestedAt = iso(row.execution_requested_at);
  if (row.started_at) plan.startedAt = iso(row.started_at);
  if (row.finished_at) plan.finishedAt = iso(row.finished_at);
  if (row.observation_started_at) plan.observationStartedAt = iso(row.observation_started_at);
  if (row.observation_deadline_at) plan.observationDeadlineAt = iso(row.observation_deadline_at);
  if (row.observation_completed_at) plan.observationCompletedAt = iso(row.observation_completed_at);
  if (row.promoted_by) plan.promotedBy = String(row.promoted_by);
  if (row.promoted_at) plan.promotedAt = iso(row.promoted_at);
  if (row.failure_code) plan.failureCode = String(row.failure_code);
  if (row.failure_reason) plan.failureReason = String(row.failure_reason);
  return plan;
}

function mapPolicy(row: Record<string, unknown>): FrameworkReleasePolicy {
  const policy: FrameworkReleasePolicy = {
    canaryFrameworkId: row.canary_framework_id as 'hermes-alica' | 'hermes-herman',
    observationWindowSeconds: Number(row.observation_window_seconds),
    requiredHealthySamples: Number(row.required_healthy_samples),
    manualPromotionRequired: true,
    updatedAt: iso(row.updated_at),
  };
  if (row.updated_by) policy.updatedBy = String(row.updated_by);
  return policy;
}

function rolloutError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function candidateIdentifier(repository: string, tagName: string): string {
  return `fuc_${createHash('sha256').update(`${repository}\n${tagName}`).digest('hex')}`;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapSource(row: Record<string, unknown>): UpdateSourceState {
  const source: UpdateSourceState = {
    sourceId: String(row.source_id),
    repository: String(row.repository),
    trusted: true,
  };
  if (row.last_checked_at) source.lastCheckedAt = iso(row.last_checked_at);
  if (row.last_success_at) source.lastSuccessAt = iso(row.last_success_at);
  if (row.safe_error) source.safeError = String(row.safe_error);
  return source;
}

function mapCandidate(row: Record<string, unknown>): StoredUpdateCandidate {
  return {
    candidateId: String(row.candidate_id),
    sourceId: String(row.source_id),
    tagName: String(row.tag_name),
    releaseName: String(row.release_name),
    commitSha: String(row.commit_sha),
    releaseUrl: String(row.release_url),
    releaseNotes: String(row.release_notes),
    publishedAt: iso(row.published_at),
    prerelease: Boolean(row.prerelease),
    draft: Boolean(row.draft),
    discoveredAt: iso(row.discovered_at),
  };
}

function mapAssessment(row: Record<string, unknown>): CandidateAssessment {
  const assessment: CandidateAssessment = {
    assessmentId: String(row.assessment_id),
    candidateId: String(row.candidate_id),
    state: row.state as CandidateAssessment['state'],
    sourceCommit: String(row.source_commit),
    sourceArchiveDigest: String(row.source_archive_digest),
    adapterRelease: String(row.adapter_release),
    contractVersion: String(row.contract_version),
    contractPassed: Boolean(row.contract_passed),
    acceptancePassed: Boolean(row.acceptance_passed),
    evidence: row.evidence as Record<string, unknown>,
    evidenceDigest: String(row.evidence_digest),
    assessedAt: iso(row.assessed_at),
    recordedAt: iso(row.recorded_at),
  };
  if (row.image_reference) assessment.imageReference = String(row.image_reference);
  if (row.image_digest) assessment.imageDigest = String(row.image_digest);
  if (row.safe_failure_code) assessment.safeFailureCode = String(row.safe_failure_code);
  if (row.safe_failure_reason) assessment.safeFailureReason = String(row.safe_failure_reason);
  return assessment;
}

function mapDeployment(row: Record<string, unknown>): DeploymentMetadata {
  return {
    frameworkId: String(row.id),
    releaseId: String(row.release_id),
    imageReference: String(row.image_reference),
    imageDigest: String(row.image_digest),
    frameworkVersion: String(row.deployed_version),
    frameworkCommit: String(row.deployed_commit),
    metadataSource: 'deployment-environment',
    recordedAt: iso(row.recorded_at),
  };
}

function mapComparison(row: Record<string, unknown>, candidateId: string): StoredComparison {
  return {
    frameworkId: String(row.id),
    candidateId,
    relation: row.relation as StoredComparison['relation'],
    githubStatus: row.github_status as StoredComparison['githubStatus'],
    aheadBy: Number(row.ahead_by),
    behindBy: Number(row.behind_by),
    checkedAt: iso(row.checked_at),
  };
}
