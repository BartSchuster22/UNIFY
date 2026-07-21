import type { Pool, PoolClient } from 'pg';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type HermesEventEnvelope,
} from '@aquiero/contracts';

export interface FrameworkEventCursor {
  sourceCursor?: string;
  lastSequence: number;
  state: 'idle' | 'replaying' | 'current' | 'gap' | 'unavailable';
}

export interface FrameworkEventJournal {
  ready(): Promise<boolean>;
  cursor(frameworkId: string): Promise<FrameworkEventCursor>;
  ingest(
    frameworkId: string,
    events: HermesEventEnvelope[],
    sourceCursor: string | undefined,
    state?: FrameworkEventCursor['state'],
  ): Promise<number>;
  list(frameworkId: string, afterSequence: number, limit: number): Promise<HermesEventEnvelope[]>;
  markUnavailable(frameworkId: string): Promise<void>;
}

export class PostgresFrameworkEventJournal implements FrameworkEventJournal {
  constructor(private readonly pool: Pool) {}

  async ready() {
    try {
      const result = await this.pool.query<{ ready: boolean }>(
        `SELECT to_regclass('gateway_framework_events') IS NOT NULL
             AND to_regclass('event_cursors') IS NOT NULL AS ready`,
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }

  async cursor(frameworkId: string): Promise<FrameworkEventCursor> {
    const result = await this.pool.query<{
      durable_cursor: string | null;
      replay_state: FrameworkEventCursor['state'];
    }>(
      `SELECT durable_cursor, replay_state
         FROM event_cursors WHERE bridge_id=$1`,
      [bridgeId(frameworkId)],
    );
    const row = result.rows[0];
    if (!row) return { lastSequence: 0, state: 'idle' };
    return {
      ...(row.durable_cursor ? { sourceCursor: row.durable_cursor } : {}),
      lastSequence: sourceSequence(row.durable_cursor),
      state: row.replay_state,
    };
  }

  async ingest(
    frameworkId: string,
    events: HermesEventEnvelope[],
    sourceCursor: string | undefined,
    state: FrameworkEventCursor['state'] = 'current',
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const event of events) inserted += await insertEvent(client, frameworkId, event);
      const last = events.at(-1)?.sequence ?? sourceSequence(sourceCursor);
      const durableCursor = sourceCursor ?? (last > 0 ? adapterCursor(last) : null);
      await client.query(
        `INSERT INTO event_cursors(
           bridge_id,durable_cursor,last_event_at,last_received_at,replay_state,updated_at
         ) VALUES($1,$2,$3,now(),$4,now())
         ON CONFLICT(bridge_id) DO UPDATE SET
           durable_cursor=COALESCE(excluded.durable_cursor,event_cursors.durable_cursor),
           last_event_at=COALESCE(excluded.last_event_at,event_cursors.last_event_at),
           last_received_at=now(),replay_state=excluded.replay_state,updated_at=now()`,
        [bridgeId(frameworkId), durableCursor, events.at(-1)?.occurredAt ?? null, state],
      );
      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(frameworkId: string, afterSequence: number, limit: number) {
    const result = await this.pool.query<EventRow>(
      `SELECT source_sequence,event_id,event_type,source_version,classification,
              correlation_id,operation_id,payload,occurred_at
         FROM gateway_framework_events
        WHERE framework_id=$1 AND source_sequence>$2
        ORDER BY source_sequence ASC LIMIT $3`,
      [frameworkId, afterSequence, limit],
    );
    return result.rows.map((row) => mapEvent(frameworkId, row));
  }

  async markUnavailable(frameworkId: string) {
    await this.pool.query(
      `INSERT INTO event_cursors(bridge_id,replay_state,last_received_at,updated_at)
       VALUES($1,'unavailable',now(),now())
       ON CONFLICT(bridge_id) DO UPDATE SET
         replay_state='unavailable',last_received_at=now(),updated_at=now()`,
      [bridgeId(frameworkId)],
    );
  }
}

async function insertEvent(client: PoolClient, frameworkId: string, event: HermesEventEnvelope) {
  if (event.frameworkId !== frameworkId)
    throw new Error('Framework event provenance does not match the registered framework');
  const result = await client.query(
    `INSERT INTO gateway_framework_events(
       framework_id,source_sequence,event_id,event_type,source_version,classification,
       correlation_id,operation_id,payload,occurred_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT DO NOTHING RETURNING source_sequence`,
    [
      frameworkId,
      event.sequence,
      event.eventId,
      event.type,
      event.sourceVersion,
      event.classification,
      event.correlationId ?? null,
      event.operationId ?? null,
      event.payload,
      event.occurredAt,
    ],
  );
  return result.rowCount ?? 0;
}

interface EventRow {
  source_sequence: string | number;
  event_id: string;
  event_type: string;
  source_version: string;
  classification: 'durable' | 'ephemeral';
  correlation_id: string | null;
  operation_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
}

function mapEvent(frameworkId: string, row: EventRow): HermesEventEnvelope {
  return {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId,
    frameworkVersion: PINNED_HERMES_RELEASE,
    frameworkCommit: PINNED_HERMES_COMMIT,
    eventId: row.event_id,
    sequence: Number(row.source_sequence),
    sourceVersion: row.source_version,
    type: row.event_type,
    classification: row.classification,
    occurredAt: new Date(row.occurred_at).toISOString(),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.operation_id ? { operationId: row.operation_id } : {}),
    payload: row.payload,
  };
}

function bridgeId(frameworkId: string) {
  return `hermes-control:${frameworkId}`;
}

function adapterCursor(sequence: number) {
  return Buffer.from(String(sequence), 'utf8').toString('base64url');
}

export function gatewayEventCursor(sequence: number) {
  return Buffer.from(`g1:${sequence}`, 'utf8').toString('base64url');
}

export function parseGatewayEventCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  try {
    const value = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^g1:\d+$/.test(value)) throw new Error('invalid');
    const sequence = Number(value.slice(3));
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('invalid');
    return sequence;
  } catch {
    throw new Error('Gateway event cursor is invalid');
  }
}

function sourceSequence(cursor: string | null | undefined) {
  if (!cursor) return 0;
  const sequence = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}
