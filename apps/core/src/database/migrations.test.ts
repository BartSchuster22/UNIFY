import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import {
  loadMigrations,
  migrateDatabase,
  poolConfigFromEnvironment,
  verifyDatabase,
} from './migrations.js';

const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const id = (prefix: string) => `${prefix}_${ulid}`;

async function withTempDirectory(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'unify-core-migrations-'));
  try {
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('discovers contiguous migrations and stable checksums', async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(new Set(migrations.map((migration) => migration.checksum)).size, migrations.length);
  for (const migration of migrations) assert.match(migration.checksum, /^[a-f0-9]{64}$/);
});

test('rejects malformed and non-contiguous migration files', async () => {
  await withTempDirectory(async (directory) => {
    await writeFile(join(directory, '001_valid.sql'), 'SELECT 1;\n');
    await writeFile(join(directory, '003_gap.sql'), 'SELECT 3;\n');
    await assert.rejects(loadMigrations(directory), /contiguous/);
  });
  await withTempDirectory(async (directory) => {
    await writeFile(join(directory, '1_invalid.sql'), 'SELECT 1;\n');
    await assert.rejects(loadMigrations(directory), /Invalid migration filename/);
  });
});

test('requires an explicit safe database configuration', () => {
  assert.throws(() => poolConfigFromEnvironment({}), /CORE_DATABASE_URL/);
  assert.throws(
    () =>
      poolConfigFromEnvironment({
        CORE_DATABASE_URL: 'postgres://localhost/test',
        CORE_DATABASE_SSL: 'prefer',
      }),
    /disable or require/,
  );
  assert.throws(
    () =>
      poolConfigFromEnvironment({
        CORE_DATABASE_URL: 'postgres://localhost/test',
        CORE_DATABASE_POOL_SIZE: '0',
      }),
    /integer from 1 to 50/,
  );
  const secure = poolConfigFromEnvironment({ CORE_DATABASE_URL: 'postgres://localhost/test' });
  assert.deepEqual(secure.ssl, { rejectUnauthorized: true });
  const config = poolConfigFromEnvironment({
    CORE_DATABASE_URL: 'postgres://localhost/test',
    CORE_DATABASE_SSL: 'disable',
    CORE_DATABASE_POOL_SIZE: '4',
  });
  assert.equal(config.max, 4);
  assert.equal(config.ssl, false);
});

const integrationUrl = process.env.CORE_TEST_DATABASE_URL;
test(
  'applies the fresh schema and enforces database invariants',
  { skip: !integrationUrl },
  async () => {
    const parsed = new URL(integrationUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_test(?:_|$)/,
      'integration database name must start with unify_core_test',
    );
    const pool = new Pool({ connectionString: integrationUrl, max: 4 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      const first = await migrateDatabase(pool);
      assert.deepEqual(first.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const second = await migrateDatabase(pool);
      assert.deepEqual(second.applied, []);
      assert.equal(second.previouslyApplied, 12);
      await verifyDatabase(pool);
      const storedMigration = await pool.query<{ checksum: string }>(
        'SELECT checksum FROM core.schema_migrations WHERE version = 1',
      );
      await pool.query(
        "UPDATE core.schema_migrations SET checksum = repeat('0', 64) WHERE version = 1",
      );
      await assert.rejects(migrateDatabase(pool), /checksum mismatch/);
      await pool.query('UPDATE core.schema_migrations SET checksum = $1 WHERE version = 1', [
        storedMigration.rows[0]!.checksum.trim(),
      ]);
      await verifyDatabase(pool);

      await pool.query(
        "INSERT INTO core.identities (id, username, display_name, password_hash) VALUES ($1, 'admin', 'Admin', '$argon2id$v=19$m=65536,t=3,p=1$hash')",
        [id('usr')],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO core.identities (id, username, display_name, password_hash) VALUES ('bad', 'bad', 'Bad', '$argon2id$bad')",
        ),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      await pool.query(
        "UPDATE core.identities SET display_name = 'Administrator' WHERE id = $1 AND version = 1",
        [id('usr')],
      );
      const identity = await pool.query<{ version: string }>(
        'SELECT version::text FROM core.identities WHERE id = $1',
        [id('usr')],
      );
      assert.equal(identity.rows[0]?.version, '2');
      await assert.rejects(
        pool.query('UPDATE core.identities SET version = 99 WHERE id = $1', [id('usr')]),
        (error: unknown) => (error as { code?: string }).code === '40001',
      );

      await pool.query("INSERT INTO core.service_principals (id, name) VALUES ($1, 'core-test')", [
        id('svc'),
      ]);
      await pool.query(
        "INSERT INTO core.authorization_bindings (principal_kind, principal_id, role_key, scope_kind, scope_id, granted_by_kind, granted_by_id) VALUES ('service', $1, 'core.admin', 'global', 'global', 'user', $2)",
        [id('svc'), id('usr')],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO core.authorization_bindings (principal_kind, principal_id, role_key, scope_kind, scope_id, granted_by_kind, granted_by_id) VALUES ('user', 'usr_01ARZ3NDEKTSV4RRFFQ69G5FB0', 'core.viewer', 'global', 'global', 'user', $1)",
          [id('usr')],
        ),
        (error: unknown) => (error as { code?: string }).code === '23503',
      );
      await pool.query(
        "INSERT INTO core.frameworks (id, name, endpoint, credential_reference) VALUES ($1, 'Alica', 'https://framework.test', 'secret://frameworks/alica')",
        [id('frm')],
      );

      const operationSql = `INSERT INTO core.operations
      (id, command_id, command_type, actor_kind, actor_id, target_kind, target_id, idempotency_key, payload_digest, payload)
      VALUES ($1, $2, 'framework.create.v1', 'service', $3, 'framework', $4, $5, digest('payload', 'sha256'), '{}'::jsonb)`;
      await pool.query(operationSql, [
        id('opc'),
        id('cmd'),
        id('svc'),
        id('frm'),
        'operation-key:0001',
      ]);
      await assert.rejects(
        pool.query(operationSql, [
          `opc_01ARZ3NDEKTSV4RRFFQ69G5FB0`,
          `cmd_01ARZ3NDEKTSV4RRFFQ69G5FB0`,
          id('svc'),
          id('frm'),
          'operation-key:0001',
        ]),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );

      const eventSql = `INSERT INTO core.events
      (id, event_type, aggregate_kind, aggregate_id, operation_id, correlation_id, payload, occurred_at)
      VALUES ($1, 'framework.changed.v1', 'framework', $2, $3, $4, '{}'::jsonb, clock_timestamp())`;
      await pool.query(eventSql, [id('evt'), id('frm'), id('opc'), id('cor')]);
      await pool.query(eventSql, [
        'evt_01ARZ3NDEKTSV4RRFFQ69G5FB0',
        id('frm'),
        id('opc'),
        'cor_01ARZ3NDEKTSV4RRFFQ69G5FB0',
      ]);
      const sequence = await pool.query<{ aggregate_sequence: string }>(
        'SELECT aggregate_sequence::text FROM core.events ORDER BY global_position',
      );
      assert.deepEqual(
        sequence.rows.map((row) => row.aggregate_sequence),
        ['1', '2'],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO core.events (id, event_type, aggregate_kind, aggregate_id, aggregate_sequence, correlation_id, payload, occurred_at) VALUES ('evt_01ARZ3NDEKTSV4RRFFQ69G5FB1', 'framework.changed.v1', 'framework', $1, 99, $2, '{}'::jsonb, clock_timestamp())",
          [id('frm'), id('cor')],
        ),
        (error: unknown) => (error as { code?: string }).code === '55000',
      );

      await pool.query(
        "INSERT INTO core.event_consumers (consumer_key) VALUES ('notifications.primary')",
      );
      await pool.query(
        "UPDATE core.event_consumers SET cursor_position = 2 WHERE consumer_key = 'notifications.primary'",
      );
      await assert.rejects(
        pool.query(
          "UPDATE core.event_consumers SET cursor_position = 1 WHERE consumer_key = 'notifications.primary'",
        ),
        (error: unknown) => (error as { code?: string }).code === '40001',
      );
      await assert.rejects(
        pool.query(
          "UPDATE core.event_consumers SET cursor_position = 3 WHERE consumer_key = 'notifications.primary'",
        ),
        (error: unknown) => (error as { code?: string }).code === '22023',
      );

      const auditSql = `INSERT INTO core.audit_records
      (id, actor_kind, actor_id, action, resource_kind, resource_id, operation_id, request_id, correlation_id, outcome, details)
      VALUES ($1, 'service', $2, $3, 'framework', $4, $5, $6, $7, 'succeeded', $8::jsonb)`;
      await pool.query(auditSql, [
        id('aud'),
        id('svc'),
        'framework.created',
        id('frm'),
        id('opc'),
        id('req'),
        id('cor'),
        '{"safe":true}',
      ]);
      await pool.query(auditSql, [
        'aud_01ARZ3NDEKTSV4RRFFQ69G5FB0',
        id('svc'),
        'framework.updated',
        id('frm'),
        id('opc'),
        'req_01ARZ3NDEKTSV4RRFFQ69G5FB0',
        id('cor'),
        '{"safe":true}',
      ]);
      const audit = await pool.query<{ violations: string; linked: boolean }>(
        `SELECT
        (SELECT count(*)::text FROM core.verify_audit_chain()) AS violations,
        (SELECT second.previous_hash = first.record_hash FROM core.audit_records first CROSS JOIN core.audit_records second WHERE first.global_position = 1 AND second.global_position = 2) AS linked`,
      );
      assert.deepEqual(audit.rows[0], { violations: '0', linked: true });
      await assert.rejects(
        pool.query("UPDATE core.audit_records SET action = 'tampered' WHERE global_position = 1"),
        (error: unknown) => (error as { code?: string }).code === '55000',
      );
      await verifyDatabase(pool);
    } finally {
      await pool.end();
    }
  },
);
