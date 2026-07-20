import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { canonicalHash } from '../governance/canonical.js';

async function secret(name: string): Promise<string> {
  const file = process.env[`${name}_FILE`];
  const value = file ? await readFile(file, 'utf8') : process.env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value.trim();
}

const pool = new pg.Pool({ connectionString: await secret('DATABASE_URL'), max: 1 });
try {
  const result = await pool.query(
    `SELECT id,event_type,actor_id,outcome,request_id,correlation_id,resource,safe_metadata,
            previous_event_hash,event_hash
     FROM audit_events ORDER BY occurred_at,id`,
  );
  let previousHash: string | null = null;
  for (const row of result.rows) {
    if (row.previous_event_hash !== previousHash)
      throw new Error(`Audit chain link mismatch at event ${String(row.id)}`);
    const expected = canonicalHash({
      eventType: String(row.event_type),
      actorId: row.actor_id === null ? null : String(row.actor_id),
      outcome: String(row.outcome),
      requestId: String(row.request_id),
      correlationId: String(row.correlation_id),
      resource: row.resource ?? null,
      safeMetadata: row.safe_metadata ?? {},
      previousHash,
    });
    if (row.event_hash !== expected)
      throw new Error(`Audit event hash mismatch at event ${String(row.id)}`);
    previousHash = String(row.event_hash);
  }
  process.stdout.write(`Audit chain verified: ${result.rowCount ?? result.rows.length} events\n`);
} finally {
  await pool.end();
}
