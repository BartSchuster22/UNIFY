import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalHash } from './canonical.js';
import type {
  AuditInput,
  ClaimResult,
  EvidenceInput,
  GovernanceStore,
  NewOperation,
  OperationRecord,
  OperationState,
} from './types.js';

const OPERATION_SELECT = `
  SELECT o.*,
    ARRAY(SELECT e.id::text FROM evidence_references e WHERE e.operation_id=o.id ORDER BY e.created_at) evidence_ids
  FROM operations o`;
function map(row: Record<string, unknown>): OperationRecord {
  const target = row.target as Record<string, unknown>;
  return {
    id: String(row.id),
    actorUserId: String(row.actor_id),
    action: String(row.operation_type),
    targetFramework: String(target.frameworkId ?? target.owner),
    targetKind: String(target.kind),
    targetId: String(target.resourceId),
    state: row.state as OperationState,
    mode: row.mode as OperationRecord['mode'],
    policyDecision: row.policy_decision as OperationRecord['policyDecision'],
    sourceVersion: row.source_version as string | null,
    requestHash: String(row.payload_hash),
    idempotencyKey: String(row.idempotency_key),
    result: row.result,
    error: row.error,
    evidenceIds: (row.evidence_ids as string[] | undefined) ?? [],
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
export class PostgresGovernanceStore implements GovernanceStore {
  constructor(private readonly pool: Pool) {}
  async ready() {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  async claimOperation(
    _scope: string,
    key: string,
    operation: NewOperation,
    expiresAt: Date,
  ): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${operation.actorUserId}:${operation.action}:${key}`,
      ]);
      const existing = await client.query(
        `SELECT i.request_hash idempotency_request_hash,i.operation_id,o.*,
           ARRAY(SELECT e.id::text FROM evidence_references e WHERE e.operation_id=o.id ORDER BY e.created_at) evidence_ids
         FROM idempotency_records i JOIN operations o ON o.id=i.operation_id
         WHERE i.actor_id=$1 AND i.operation_class=$2 AND i.idempotency_key=$3 AND i.expires_at>now()`,
        [operation.actorUserId, operation.action, key],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return existing.rows[0].idempotency_request_hash === operation.requestHash
          ? { kind: 'replayed', operation: map(existing.rows[0]) }
          : { kind: 'conflict', operationId: existing.rows[0].operation_id };
      }
      const target = {
        owner: operation.targetFramework,
        frameworkId: operation.targetFramework,
        kind: operation.targetKind,
        resourceId: operation.targetId,
      };
      const created = await client.query(
        `INSERT INTO operations(
           operation_type,actor_id,target,payload_hash,mode,idempotency_key,
           source_version,policy_decision,correlation_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          operation.action,
          operation.actorUserId,
          JSON.stringify(target),
          operation.requestHash,
          operation.mode ?? 'execute',
          operation.idempotencyKey,
          operation.sourceVersion ?? null,
          operation.policyDecision ?? 'allowed',
          randomUUID(),
        ],
      );
      await client.query(
        `INSERT INTO operation_transitions(operation_id,to_state,actor_id,reason)
         VALUES($1,'pending',$2,'created')`,
        [created.rows[0].id, operation.actorUserId],
      );
      await client.query(
        `INSERT INTO idempotency_records(
           actor_id,operation_class,idempotency_key,request_hash,state,operation_id,response_status,expires_at
         ) VALUES($1,$2,$3,$4,'in_progress',$5,202,$6)`,
        [
          operation.actorUserId,
          operation.action,
          key,
          operation.requestHash,
          created.rows[0].id,
          expiresAt,
        ],
      );
      await client.query('COMMIT');
      return { kind: 'created', operation: map({ ...created.rows[0], evidence_ids: [] }) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async getOperation(id: string) {
    const result = await this.pool.query(`${OPERATION_SELECT} WHERE o.id=$1`, [id]);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async transition(
    id: string,
    from: OperationState,
    to: OperationState,
    result?: unknown,
    error?: unknown,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE operations SET state=$3,
           result=COALESCE($4::jsonb,result),error=COALESCE($5::jsonb,error),updated_at=now()
         WHERE id=$1 AND state=$2 RETURNING *`,
        [
          id,
          from,
          to,
          result === undefined ? null : JSON.stringify(result),
          error === undefined ? null : JSON.stringify(error),
        ],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO operation_transitions(operation_id,from_state,to_state,actor_id)
         VALUES($1,$2,$3,$4)`,
        [id, from, to, updated.rows[0].actor_id],
      );
      if (['verified', 'denied', 'failed', 'rolled_back', 'rollback_failed'].includes(to)) {
        await client.query(
          `UPDATE idempotency_records SET state=$2,response_status=$3
           WHERE operation_id=$1`,
          [id, to === 'verified' || to === 'rolled_back' ? 'completed' : 'failed', 200],
        );
      }
      await client.query('COMMIT');
      return map({ ...updated.rows[0], evidence_ids: [] });
    } catch (error_) {
      await client.query('ROLLBACK');
      throw error_;
    } finally {
      client.release();
    }
  }
  async addEvidence(input: EvidenceInput) {
    if (!input.operationId) throw new Error('Operation evidence requires operationId');
    const result = await this.pool.query(
      `INSERT INTO evidence_references(
         operation_id,evidence_type,storage_uri,content_hash,redaction_version,safe_summary,redacted_payload
       ) VALUES($1,$2,$3,$4,'1',$5,$6) RETURNING id`,
      [
        input.operationId,
        input.kind,
        input.storageUri,
        input.sha256,
        JSON.stringify(input.metadata),
        JSON.stringify(input.redactedPayload),
      ],
    );
    return result.rows[0].id;
  }
  async appendAudit(input: AuditInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('audit-chain',0))");
      const previous = await client.query(
        'SELECT event_hash FROM audit_events ORDER BY occurred_at DESC,id DESC LIMIT 1',
      );
      const previousHash = (previous.rows[0]?.event_hash as string | undefined) ?? null;
      const requestId = input.requestId ?? randomUUID();
      const correlationId = requestId;
      const event = {
        eventType: input.action,
        actorId: input.actorUserId ?? null,
        outcome: input.outcome,
        requestId,
        correlationId,
        resource: input.target ?? null,
        safeMetadata: input.details ?? {},
        previousHash,
      };
      const eventHash = canonicalHash(event);
      const result = await client.query(
        `INSERT INTO audit_events(
           event_type,actor_id,outcome,request_id,correlation_id,resource,safe_metadata,
           previous_event_hash,event_hash
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          input.action,
          input.actorUserId ?? null,
          input.outcome,
          requestId,
          correlationId,
          input.target ? JSON.stringify(input.target) : null,
          JSON.stringify(input.details ?? {}),
          previousHash,
          eventHash,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
