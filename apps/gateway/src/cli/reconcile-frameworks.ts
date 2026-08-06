import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseDeclarativeFrameworkRegistrations } from '../framework-registry/declarative.js';
import { HttpFrameworkProbe } from '../framework-registry/probe.js';
import { PostgresFrameworkRegistrationStore } from '../framework-registry/postgres-store.js';
import { FrameworkRegistryService } from '../framework-registry/service.js';
import { PostgresGovernanceStore } from '../governance/postgres-store.js';

const declarationFile = process.env.FRAMEWORK_REGISTRATION_FILE ?? '/app/frameworks.json';
if (!declarationFile.startsWith('/'))
  throw new Error('FRAMEWORK_REGISTRATION_FILE must be an absolute path');
const declaration = parseDeclarativeFrameworkRegistrations(
  JSON.parse(await readFile(declarationFile, 'utf8')),
);
for (const framework of declaration.frameworks) {
  const name = /^env:([A-Z][A-Z0-9_]{2,127})$/.exec(framework.serviceAuthReference)?.[1];
  if (!name) throw new Error('Framework service authentication must use an env: reference');
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  const token = direct ?? (file ? (await readFile(file, 'utf8')).trim() : '');
  if (!token) throw new Error(`${name} or ${name}_FILE is required`);
  process.env[name] = token;
}

const databaseUrl = await requiredSecret('DATABASE_URL');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const registry = new FrameworkRegistryService(
  new PostgresFrameworkRegistrationStore(pool),
  new HttpFrameworkProbe(),
);
const governance = new PostgresGovernanceStore(pool);
const lockClient = await pool.connect();
await lockClient.query(
  "SELECT pg_advisory_lock(hashtextextended('framework-declarative-reconcile',0))",
);
const results: Array<{ frameworkId: string; changed: boolean; status: string }> = [];
try {
  for (const input of declaration.frameworks) {
    const result = await registry.reconcile(input);
    const declarationHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const priorEvidence = await pool.query(
      `SELECT 1 FROM audit_events
        WHERE event_type='framework.reconcile'
          AND resource->>'frameworkId'=$1
          AND safe_metadata->>'declarationHash'=$2
        LIMIT 1`,
      [result.registration.frameworkId, declarationHash],
    );
    if (result.changed || priorEvidence.rowCount === 0)
      await governance.appendAudit({
        action: 'framework.reconcile',
        outcome: 'success',
        target: { frameworkId: result.registration.frameworkId },
        details: {
          contractVersion: result.registration.contractVersion,
          frameworkCommit: result.registration.frameworkCommit,
          declarationHash,
          declarative: true,
        },
      });
    results.push({
      frameworkId: result.registration.frameworkId,
      changed: result.changed,
      status: result.registration.status,
    });
  }
  console.log(
    JSON.stringify({
      schemaVersion: declaration.schemaVersion,
      changed: results.filter((result) => result.changed).length,
      frameworks: results,
    }),
  );
} finally {
  await lockClient.query(
    "SELECT pg_advisory_unlock(hashtextextended('framework-declarative-reconcile',0))",
  );
  lockClient.release();
  await pool.end();
}

async function requiredSecret(name: string) {
  const direct = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  const value = direct ?? (file ? (await readFile(file, 'utf8')).trim() : '');
  if (!value) throw new Error(`${name} or ${name}_FILE is required`);
  return value;
}
