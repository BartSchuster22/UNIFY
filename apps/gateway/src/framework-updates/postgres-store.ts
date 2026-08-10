import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  CandidateAssessment,
  DeploymentMetadata,
  DeploymentMetadataInput,
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
         ON CONFLICT(framework_id) DO UPDATE SET
           release_id=excluded.release_id,
           image_reference=excluded.image_reference,
           image_digest=excluded.image_digest,
           framework_version=excluded.framework_version,
           framework_commit=excluded.framework_commit,
           metadata_source='deployment-environment',
           recorded_at=now()`,
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
