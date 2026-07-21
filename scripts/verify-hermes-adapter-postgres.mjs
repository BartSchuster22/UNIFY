import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PostgresAdapterEventStore } from '../apps/hermes-control-adapter/dist/event-store.js';

const require = createRequire(
  new URL('../apps/hermes-control-adapter/package.json', import.meta.url),
);
const pg = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const store = new PostgresAdapterEventStore(pool);
const frameworkId = `hermes-pg-verify-${randomUUID()}`;
const command = {
  mode: 'execute',
  idempotencyKey: 'pg-idempotency-key',
  requestId: 'pg-request',
  correlationId: 'pg-correlation',
  actor: { type: 'service', id: 'pg-verifier' },
  payload: { families: ['profiles', 'work'] },
};

try {
  if (!(await store.ready())) throw new Error('PostgreSQL adapter tables are unavailable');
  const commit = await store.commit({
    frameworkId,
    capability: 'control.reconcile',
    idempotencyKey: command.idempotencyKey,
    requestHash: `sha256:${'a'.repeat(64)}`,
    command,
    response: { data: { emittedEvents: 0 } },
    events: [
      {
        family: 'profiles',
        type: 'profiles.snapshot.observed',
        sourceVersion: `sha256:${'1'.repeat(64)}`,
        correlationId: command.correlationId,
        operationId: 'pg-operation',
        payload: { itemCount: 2 },
      },
      {
        family: 'work',
        type: 'work.snapshot.observed',
        sourceVersion: `sha256:${'2'.repeat(64)}`,
        correlationId: command.correlationId,
        operationId: 'pg-operation',
        payload: { itemCount: 3 },
      },
    ],
  });
  if (commit.replayed || commit.emittedEvents !== 2) throw new Error('Initial commit failed');
  const replay = await store.commit({
    frameworkId,
    capability: 'control.reconcile',
    idempotencyKey: command.idempotencyKey,
    requestHash: `sha256:${'a'.repeat(64)}`,
    command,
    response: { data: { emittedEvents: 0 } },
    events: [],
  });
  if (!replay.replayed) throw new Error('Idempotent replay failed');
  const events = await store.list(frameworkId, 0, 10);
  if (events.length !== 2 || events[0]?.sequence >= events[1]?.sequence)
    throw new Error('Event replay ordering failed');

  for (const [index, outcome] of ['success', 'denied'].entries())
    await store.audit({
      frameworkId,
      eventType: 'hermes.adapter.command.reconcile',
      outcome,
      requestId: `pg-audit-${index}`,
      correlationId: command.correlationId,
      actorType: 'service',
      actorId: 'pg-verifier',
      operationId: 'pg-operation',
      safeMetadata: { mode: 'execute', status: outcome },
    });
  const audit = await pool.query(
    `SELECT sequence, previous_event_hash, event_hash
       FROM hermes_adapter_audit WHERE framework_id = $1 ORDER BY sequence`,
    [frameworkId],
  );
  if (audit.rows.length !== 2) throw new Error('Audit persistence failed');
  if (audit.rows[0].previous_event_hash !== null) throw new Error('Audit chain genesis is invalid');
  if (audit.rows[1].previous_event_hash !== audit.rows[0].event_hash)
    throw new Error('Audit hash chain is invalid');

  console.log(
    JSON.stringify({
      verified: true,
      migration: '003_hermes_adapter_foundations',
      durableEvents: events.length,
      idempotentReplay: true,
      auditEvents: audit.rows.length,
      auditHashChain: true,
    }),
  );
} finally {
  await pool.query('DELETE FROM hermes_adapter_audit WHERE framework_id = $1', [frameworkId]);
  await pool.query('DELETE FROM hermes_adapter_idempotency WHERE framework_id = $1', [frameworkId]);
  await pool.query('DELETE FROM hermes_adapter_events WHERE framework_id = $1', [frameworkId]);
  await pool.end();
}
