import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type HermesEventEnvelope,
} from '@aquiero/contracts';
import type {
  AdapterAuditInput,
  AdapterEventStore,
  DerivedEventInput,
  IdempotentCommitInput,
  IdempotentCommitResult,
} from './types.js';

export class IdempotencyConflictError extends Error {}
export class IdempotencyBusyError extends Error {}

export class PostgresAdapterEventStore implements AdapterEventStore {
  constructor(private readonly pool: Pool) {}

  async ready() {
    try {
      const result = await this.pool.query<{ ready: boolean }>(
        `SELECT to_regclass('hermes_adapter_events') IS NOT NULL
             AND to_regclass('hermes_adapter_idempotency') IS NOT NULL
             AND to_regclass('hermes_adapter_audit') IS NOT NULL AS ready`,
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }

  async commit(input: IdempotentCommitInput): Promise<IdempotentCommitResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.frameworkId}:${input.capability}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<{
        request_hash: string;
        response_body: Record<string, unknown> | null;
      }>(
        `SELECT request_hash, response_body
           FROM hermes_adapter_idempotency
          WHERE framework_id = $1 AND capability = $2 AND idempotency_key = $3`,
        [input.frameworkId, input.capability, input.idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.request_hash !== input.requestHash)
          throw new IdempotencyConflictError('Idempotency key was used with another request');
        if (!prior.response_body)
          throw new IdempotencyBusyError('Idempotent operation is in progress');
        await client.query('COMMIT');
        return { response: prior.response_body, replayed: true, emittedEvents: 0 };
      }

      await client.query(
        `INSERT INTO hermes_adapter_idempotency
          (framework_id, capability, idempotency_key, request_hash, command_body, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '24 hours')`,
        [
          input.frameworkId,
          input.capability,
          input.idempotencyKey,
          input.requestHash,
          input.command,
        ],
      );

      let emittedEvents = 0;
      for (const event of input.events)
        emittedEvents += await appendIfChanged(client, input.frameworkId, event);
      const response = structuredClone(input.response);
      const data = response.data;
      if (data && typeof data === 'object' && !Array.isArray(data))
        (data as Record<string, unknown>).emittedEvents = emittedEvents;
      await client.query(
        `UPDATE hermes_adapter_idempotency
            SET response_body = $4, completed_at = now()
          WHERE framework_id = $1 AND capability = $2 AND idempotency_key = $3`,
        [input.frameworkId, input.capability, input.idempotencyKey, response],
      );
      await client.query('COMMIT');
      return { response, replayed: false, emittedEvents };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(frameworkId: string, afterSequence: number, limit: number) {
    const result = await this.pool.query<EventRow>(
      `SELECT sequence, event_id, source_version, event_type, occurred_at,
              correlation_id, operation_id, payload
         FROM hermes_adapter_events
        WHERE framework_id = $1 AND sequence > $2
        ORDER BY sequence ASC
        LIMIT $3`,
      [frameworkId, afterSequence, limit],
    );
    return result.rows.map((row) => mapEvent(frameworkId, row));
  }

  async audit(input: AdapterAuditInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `audit:${input.frameworkId}`,
      ]);
      const previous = await client.query<{ event_hash: string }>(
        `SELECT event_hash FROM hermes_adapter_audit
          WHERE framework_id = $1 ORDER BY sequence DESC LIMIT 1`,
        [input.frameworkId],
      );
      const previousHash = previous.rows[0]?.event_hash ?? null;
      const occurredAt = new Date().toISOString();
      const eventHash = auditHash(input, previousHash, occurredAt);
      await client.query(
        `INSERT INTO hermes_adapter_audit
          (framework_id, event_type, outcome, request_id, correlation_id,
           actor_type, actor_id, operation_id, safe_metadata,
           previous_event_hash, event_hash, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.frameworkId,
          input.eventType,
          input.outcome,
          input.requestId,
          input.correlationId,
          input.actorType ?? null,
          input.actorId ?? null,
          input.operationId ?? null,
          input.safeMetadata,
          previousHash,
          eventHash,
          occurredAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function appendIfChanged(client: PoolClient, frameworkId: string, event: DerivedEventInput) {
  const inserted = await client.query(
    `INSERT INTO hermes_adapter_events
      (framework_id, event_id, family, event_type, source_version,
       correlation_id, operation_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (framework_id, family, source_version) DO NOTHING
     RETURNING sequence`,
    [
      frameworkId,
      randomUUID(),
      event.family,
      event.type,
      event.sourceVersion,
      event.correlationId,
      event.operationId,
      event.payload,
    ],
  );
  return inserted.rowCount ?? 0;
}

interface EventRow {
  sequence: string | number;
  event_id: string;
  source_version: string;
  event_type: string;
  occurred_at: Date | string;
  correlation_id: string | null;
  operation_id: string | null;
  payload: Record<string, unknown>;
}

function mapEvent(frameworkId: string, row: EventRow): HermesEventEnvelope {
  const event: HermesEventEnvelope = {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId,
    frameworkVersion: PINNED_HERMES_RELEASE,
    frameworkCommit: PINNED_HERMES_COMMIT,
    eventId: row.event_id,
    sequence: Number(row.sequence),
    sourceVersion: row.source_version,
    type: row.event_type,
    classification: 'durable',
    occurredAt: new Date(row.occurred_at).toISOString(),
    payload: row.payload,
  };
  if (row.correlation_id) event.correlationId = row.correlation_id;
  if (row.operation_id) event.operationId = row.operation_id;
  return event;
}

export class MemoryAdapterEventStore implements AdapterEventStore {
  private readonly idempotency = new Map<
    string,
    { hash: string; response: Record<string, unknown> }
  >();
  private readonly events: HermesEventEnvelope[] = [];
  readonly audits: AdapterAuditInput[] = [];

  async ready() {
    return true;
  }

  async commit(input: IdempotentCommitInput): Promise<IdempotentCommitResult> {
    const key = `${input.frameworkId}:${input.capability}:${input.idempotencyKey}`;
    const prior = this.idempotency.get(key);
    if (prior) {
      if (prior.hash !== input.requestHash)
        throw new IdempotencyConflictError('Idempotency key was used with another request');
      return { response: structuredClone(prior.response), replayed: true, emittedEvents: 0 };
    }
    let emittedEvents = 0;
    for (const inputEvent of input.events) {
      if (
        this.events.some(
          (event) =>
            event.frameworkId === input.frameworkId &&
            event.type === inputEvent.type &&
            event.sourceVersion === inputEvent.sourceVersion,
        )
      )
        continue;
      this.events.push({
        contractVersion: HERMES_CONTROL_VERSION,
        frameworkId: input.frameworkId,
        frameworkVersion: PINNED_HERMES_RELEASE,
        frameworkCommit: PINNED_HERMES_COMMIT,
        eventId: randomUUID(),
        sequence: this.events.length + 1,
        sourceVersion: inputEvent.sourceVersion,
        type: inputEvent.type,
        classification: 'durable',
        occurredAt: new Date().toISOString(),
        correlationId: inputEvent.correlationId,
        operationId: inputEvent.operationId,
        payload: inputEvent.payload,
      });
      emittedEvents += 1;
    }
    const response = structuredClone(input.response);
    const data = response.data;
    if (data && typeof data === 'object' && !Array.isArray(data))
      (data as Record<string, unknown>).emittedEvents = emittedEvents;
    this.idempotency.set(key, { hash: input.requestHash, response });
    return { response, replayed: false, emittedEvents };
  }

  async list(frameworkId: string, afterSequence: number, limit: number) {
    return this.events
      .filter((event) => event.frameworkId === frameworkId && event.sequence > afterSequence)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async audit(input: AdapterAuditInput) {
    this.audits.push(structuredClone(input));
  }
}

function auditHash(input: AdapterAuditInput, previousHash: string | null, occurredAt: string) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        previousHash,
        input.frameworkId,
        input.eventType,
        input.outcome,
        input.requestId,
        input.correlationId,
        input.actorType ?? null,
        input.actorId ?? null,
        input.operationId ?? null,
        input.safeMetadata,
        occurredAt,
      ]),
    )
    .digest('hex');
}
