import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  FederationClaimResult,
  FederationLeaseInput,
  FederationLeaseRecord,
  FederationLeaseStage,
  FederationLeaseStatus,
  FederationLeaseStore,
} from './types.js';

const SELECT = `
  SELECT id,source_framework_id,source_board_id,source_task_id,worker_framework_id,
         worker_board_id,worker_profile_id,worker_task_id,status,stage,attempt,
         lease_expires_at,heartbeat_at,request_hash,result,error,created_by,created_at,updated_at
  FROM federation_worker_leases`;

function map(row: Record<string, unknown>): FederationLeaseRecord {
  return {
    id: String(row.id),
    sourceFrameworkId: String(row.source_framework_id),
    sourceBoardId: String(row.source_board_id),
    sourceTaskId: String(row.source_task_id),
    workerFrameworkId: String(row.worker_framework_id),
    workerBoardId: String(row.worker_board_id),
    workerProfileId: String(row.worker_profile_id),
    workerTaskId: row.worker_task_id === null ? null : String(row.worker_task_id),
    status: row.status as FederationLeaseStatus,
    stage: row.stage as FederationLeaseStage,
    attempt: Number(row.attempt),
    leaseExpiresAt: row.lease_expires_at as Date,
    heartbeatAt: row.heartbeat_at as Date,
    requestHash: String(row.request_hash),
    result: row.result,
    error: row.error,
    createdBy: String(row.created_by),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class PostgresFederationLeaseStore implements FederationLeaseStore {
  constructor(private readonly pool: Pool) {}

  async ready() {
    try {
      await this.pool.query('SELECT 1 FROM federation_worker_leases LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  async claim(
    input: FederationLeaseInput & { requestHash: string },
  ): Promise<FederationClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${input.sourceFrameworkId}:${input.sourceBoardId}:${input.sourceTaskId}`,
      ]);
      const existing = await client.query(
        `${SELECT} WHERE source_framework_id=$1 AND source_board_id=$2 AND source_task_id=$3`,
        [input.sourceFrameworkId, input.sourceBoardId, input.sourceTaskId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        const lease = map(existing.rows[0]);
        return lease.requestHash === input.requestHash
          ? { kind: 'replayed', lease }
          : { kind: 'conflict', lease };
      }
      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO federation_worker_leases(
           id,source_framework_id,source_board_id,source_task_id,worker_framework_id,
           worker_board_id,worker_profile_id,status,stage,attempt,lease_expires_at,
           heartbeat_at,request_hash,created_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,'pending','pending',1,now()+($8::int * interval '1 second'),now(),$9,$10)
         RETURNING *`,
        [
          id,
          input.sourceFrameworkId,
          input.sourceBoardId,
          input.sourceTaskId,
          input.workerFrameworkId,
          input.workerBoardId,
          input.workerProfileId,
          input.leaseTtlSeconds,
          input.requestHash,
          input.actorUserId,
        ],
      );
      await client.query(
        `INSERT INTO federation_worker_lease_events(lease_id,event_type,safe_metadata)
         VALUES($1,'lease.created',$2)`,
        [
          id,
          JSON.stringify({
            sourceFrameworkId: input.sourceFrameworkId,
            sourceBoardId: input.sourceBoardId,
            sourceTaskId: input.sourceTaskId,
            workerFrameworkId: input.workerFrameworkId,
            workerBoardId: input.workerBoardId,
            workerProfileId: input.workerProfileId,
          }),
        ],
      );
      await client.query('COMMIT');
      return { kind: 'created', lease: map(created.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string) {
    const result = await this.pool.query(`${SELECT} WHERE id=$1`, [id]);
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async list(limit: number) {
    const result = await this.pool.query(`${SELECT} ORDER BY created_at DESC,id DESC LIMIT $1`, [
      limit,
    ]);
    return result.rows.map(map);
  }

  async advance(
    id: string,
    stage: FederationLeaseStage,
    status: FederationLeaseStatus,
    patch: { workerTaskId?: string; result?: unknown; error?: unknown } = {},
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE federation_worker_leases
         SET stage=$2,status=$3,heartbeat_at=now(),updated_at=now(),
             worker_task_id=COALESCE($4,worker_task_id),
             result=COALESCE($5::jsonb,result),
             error=COALESCE($6::jsonb,error)
         WHERE id=$1 RETURNING *`,
        [
          id,
          stage,
          status,
          patch.workerTaskId ?? null,
          patch.result === undefined ? null : JSON.stringify(patch.result),
          patch.error === undefined ? null : JSON.stringify(patch.error),
        ],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO federation_worker_lease_events(lease_id,event_type,safe_metadata)
         VALUES($1,$2,$3)`,
        [
          id,
          `lease.${stage}`,
          JSON.stringify({ status, workerTaskId: patch.workerTaskId ?? null }),
        ],
      );
      await client.query('COMMIT');
      return map(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
