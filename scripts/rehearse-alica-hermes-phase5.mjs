#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const phase5 = join(root, 'deploy/five-service/hermes-phase5');
const migrationDirectory = join(root, 'apps/core/migrations');
const migration12 = readFileSync(
  join(migrationDirectory, '012_alica_hermes_projection.sql'),
  'utf8',
);
const down = readFileSync(join(phase5, '012_alica_hermes_projection.down.sql'), 'utf8');
const repair = readFileSync(join(phase5, '012_alica_hermes_projection.forward-repair.sql'), 'utf8');
const fixture = readFileSync(join(phase5, 'predecessor-fixture.sql'), 'utf8');
const assertions = readFileSync(join(phase5, 'rehearsal-assertions.sql'), 'utf8');
const container = `alica-hermes-phase5-${randomBytes(5).toString('hex')}`;
const seededDb = 'alica_hermes_phase5_seeded';
const emptyDb = 'alica_hermes_phase5_empty';
const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function assertUuid7Base32(canonicalId, prefix) {
  assert.match(canonicalId, new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
  let value = 0n;
  for (const character of canonicalId.slice(prefix.length + 1)) {
    const digit = crockford.indexOf(character);
    assert.notEqual(digit, -1);
    value = value * 32n + BigInt(digit);
  }
  assert.ok(value < 1n << 128n, 'canonical identifier exceeds 128 bits');
  const bytes = value.toString(16).padStart(32, '0');
  assert.equal(bytes[12], '7', 'canonical identifier is not UUIDv7');
  assert.match(bytes[16], /^[89ab]$/, 'canonical identifier has an invalid UUID variant');
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function docker(args, options = {}) {
  return command('docker', args, options);
}

function psql(database, sql, options = {}) {
  return docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database,
      '-At',
    ],
    { input: sql, allowFailure: options.allowFailure },
  );
}

function query(database, sql) {
  return psql(database, `${sql.trim()}\n`).stdout.trim();
}

function applyBase(database) {
  const files = readdirSync(migrationDirectory)
    .filter((name) => /^0(?:0[1-9]|1[01])_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert.equal(files.length, 11);
  for (const file of files) psql(database, readFileSync(join(migrationDirectory, file), 'utf8'));
}

const predecessorDigestSql = `
SELECT encode(digest(concat_ws('|',
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.frameworks row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY framework_id), '') FROM core.framework_gateway_policies row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.profiles row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.operations row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.events row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY consumer_key), '') FROM core.event_consumers row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY source_framework_id, source_event_id), '') FROM core.inbound_receipts row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.conversations row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.conversation_dispatches row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM core.work_runs row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY id), '') FROM public.framework_registrations row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY bridge_id), '') FROM public.event_cursors row_value)
), 'sha256'), 'hex');`;

const targetDigestSql = `
SELECT encode(digest(concat_ws('|',
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY framework_id), '') FROM core.framework_instance_metadata row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY alias_namespace, alias_value), '') FROM core.framework_native_aliases row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY agent_profile_id), '') FROM core.agent_profile_projections row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY operation_id), '') FROM core.framework_operations row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY framework_id, stream_key, owner_event_id), '') FROM core.framework_event_receipts row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY framework_id, stream_key), '') FROM core.framework_event_stream_state row_value),
  (SELECT coalesce(string_agg(to_jsonb(row_value)::text, '|' ORDER BY predecessor_schema, predecessor_table, predecessor_key), '') FROM core.framework_predecessor_holds row_value)
), 'sha256'), 'hex');`;

let restoreIdentity;
try {
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=phase5-isolated-only',
    'postgres:16-alpine',
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = docker(['exec', container, 'pg_isready', '-U', 'postgres'], {
      allowFailure: true,
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    command('sleep', ['0.25']);
  }
  assert.ok(ready, 'isolated PostgreSQL did not become ready');

  docker(['exec', container, 'createdb', '-U', 'postgres', seededDb]);
  applyBase(seededDb);
  psql(seededDb, fixture);
  const predecessorBefore = query(seededDb, predecessorDigestSql);
  psql(seededDb, migration12);
  const assertionOutput = psql(seededDb, assertions).stdout;
  assert.match(assertionOutput, /phase5_assertions=PASS/);
  const predecessorAfter = query(seededDb, predecessorDigestSql);
  assert.equal(predecessorAfter, predecessorBefore, 'migration changed predecessor rows');

  const originalProfileId = query(
    seededDb,
    "SELECT agent_profile_id FROM core.agent_profile_projections WHERE predecessor_profile_id='prf_01ARZ3NDEKTSV4RRFFQ69G5FA3';",
  );
  const originalOperationId = query(
    seededDb,
    "SELECT operation_id FROM core.framework_operations WHERE predecessor_operation_id='opc_01ARZ3NDEKTSV4RRFFQ69G5FA4';",
  );
  assertUuid7Base32(originalProfileId, 'agp');
  assertUuid7Base32(originalOperationId, 'op');

  const blockedDown = psql(seededDb, down, { allowFailure: true });
  assert.notEqual(blockedDown.status, 0, 'populated structural down unexpectedly succeeded');
  assert.match(blockedDown.stderr, /ALICA_HERMES_FORWARD_REPAIR_REQUIRED/);
  assert.equal(query(seededDb, targetDigestSql).length, 64);

  psql(
    seededDb,
    `INSERT INTO core.profiles
      (id, framework_id, native_reference, name, protected, desired_state, observed_state, source_version, last_observed_at)
     VALUES ('prf_01ARZ3NDEKTSV4RRFFQ69G5FAE', 'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2',
       'native-profile-forward-repair', 'Forward Repair Fixture', false, 'active', 'active',
       'profiles-v8', '2026-08-20T00:02:00Z');`,
  );
  psql(seededDb, repair);
  const repairedProfileId = query(
    seededDb,
    "SELECT agent_profile_id FROM core.agent_profile_projections WHERE predecessor_profile_id='prf_01ARZ3NDEKTSV4RRFFQ69G5FAE';",
  );
  assertUuid7Base32(repairedProfileId, 'agp');
  psql(seededDb, repair);
  assert.equal(
    query(
      seededDb,
      "SELECT agent_profile_id FROM core.agent_profile_projections WHERE predecessor_profile_id='prf_01ARZ3NDEKTSV4RRFFQ69G5FAE';",
    ),
    repairedProfileId,
  );
  assert.equal(query(seededDb, 'SELECT count(*) FROM core.agent_profile_projections;'), '2');
  assert.equal(
    query(
      seededDb,
      "SELECT agent_profile_id FROM core.agent_profile_projections WHERE predecessor_profile_id='prf_01ARZ3NDEKTSV4RRFFQ69G5FA3';",
    ),
    originalProfileId,
  );
  assert.equal(
    query(
      seededDb,
      "SELECT operation_id FROM core.framework_operations WHERE predecessor_operation_id='opc_01ARZ3NDEKTSV4RRFFQ69G5FA4';",
    ),
    originalOperationId,
  );

  const predecessorBeforeRestore = query(seededDb, predecessorDigestSql);
  const targetBeforeRestore = query(seededDb, targetDigestSql);
  docker([
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '-Fc',
    '-d',
    seededDb,
    '-f',
    '/tmp/phase5.dump',
  ]);
  docker(['exec', container, 'dropdb', '-U', 'postgres', seededDb]);
  docker(['exec', container, 'createdb', '-U', 'postgres', seededDb]);
  docker(['exec', container, 'pg_restore', '-U', 'postgres', '-d', seededDb, '/tmp/phase5.dump']);
  assert.equal(query(seededDb, predecessorDigestSql), predecessorBeforeRestore);
  assert.equal(query(seededDb, targetDigestSql), targetBeforeRestore);
  assert.equal(
    query(
      seededDb,
      "SELECT agent_profile_id FROM core.agent_profile_projections WHERE predecessor_profile_id='prf_01ARZ3NDEKTSV4RRFFQ69G5FA3';",
    ),
    originalProfileId,
  );
  assert.equal(
    query(
      seededDb,
      "SELECT operation_id FROM core.framework_operations WHERE predecessor_operation_id='opc_01ARZ3NDEKTSV4RRFFQ69G5FA4';",
    ),
    originalOperationId,
  );
  restoreIdentity = 'preserved';

  docker(['exec', container, 'createdb', '-U', 'postgres', emptyDb]);
  applyBase(emptyDb);
  psql(emptyDb, migration12);
  psql(emptyDb, down);
  assert.equal(query(emptyDb, "SELECT to_regclass('core.framework_native_aliases') IS NULL;"), 't');
  psql(emptyDb, migration12);
  assert.equal(
    query(emptyDb, "SELECT to_regclass('core.framework_native_aliases') IS NOT NULL;"),
    't',
  );

  const runnerDb = 'unify_core_test_phase5';
  docker(['exec', container, 'createdb', '-U', 'postgres', runnerDb]);
  const containerAddress = docker([
    'inspect',
    '-f',
    '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    container,
  ]).stdout.trim();
  assert.match(containerAddress, /^\d+\.\d+\.\d+\.\d+$/);
  const runner = command('pnpm', ['--filter', '@unify/core', 'db:test'], {
    env: {
      ...process.env,
      CORE_TEST_DATABASE_URL: `postgres://postgres:phase5-isolated-only@${containerAddress}:5432/${runnerDb}`,
      CORE_DATABASE_SSL: 'disable',
    },
  });
  assert.match(runner.stdout, /fail 0/);

  console.log(
    `ALICA Hermes Phase 5 isolated rehearsal: PASS target=ephemeral-docker-postgres:16 apply=PASS migrationRunner=PASS checksumVerify=PASS predecessorPreserved=true aliasesImmutable=true blockedPopulatedDown=true forwardRepair=PASS restoreIdentity=${restoreIdentity} emptyDown=PASS reapply=PASS ownerMutation=0 liveTargets=0 runtimeHooks=0`,
  );
} finally {
  docker(['rm', '-f', container], { allowFailure: true });
}
