#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { Agent } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
}
function psql(sql) {
  return run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'unify',
      '-d',
      'unify',
      '-v',
      'ON_ERROR_STOP=1',
      '-X',
      '-At',
      '-F',
      '|',
    ],
    { input: sql },
  );
}
function shaFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
async function ownerGet(path) {
  const token = readFileSync(join(root, '.secrets', 'hermes_main_control_token'), 'utf8').trim();
  const ca = readFileSync(join(root, '.secrets', 'hermes_adapter_ca.crt'));
  const body = await new Promise((resolve, reject) => {
    const req = request(
      `https://127.0.0.1:28082${path}`,
      {
        agent: new Agent({ ca, rejectUnauthorized: true }),
        headers: { authorization: `Bearer ${token}` },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () =>
          response.statusCode === 200
            ? resolve(data)
            : reject(new Error(`${path} HTTP ${response.statusCode}`)),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
  return JSON.parse(body);
}

assert.equal(
  psql("SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations;"),
  Array.from({ length: 22 }, (_, index) => index + 1).join(','),
);
for (const [version, name] of [
  [19, 'alica_hermes_phase9_capability_families'],
  [20, 'alica_hermes_phase9_immutable_journal_recovery'],
  [21, 'alica_hermes_phase9_operation_timestamp_recovery'],
  [22, 'alica_hermes_phase10_operational_drills'],
]) {
  const file = join(
    root,
    'apps/core/migrations',
    `${String(version).padStart(3, '0')}_${name}.sql`,
  );
  assert.equal(
    psql(`SELECT trim(checksum) FROM core.schema_migrations WHERE version=${version};`),
    shaFile(file),
  );
}
assert.equal(
  psql(
    "SELECT count(*),count(*) FILTER(WHERE enabled),count(*) FILTER(WHERE terminal_state='disabled') FROM core.framework_operational_drill_policies;",
  ),
  '1|0|1',
);
assert.equal(
  psql(
    "SELECT count(*),count(*) FILTER(WHERE result='passed'),count(DISTINCT drill_kind),sum(owner_mutation_count),count(*) FILTER(WHERE secret_material_persisted),count(*) FILTER(WHERE owner_state_preserved) FROM core.framework_operational_drill_evidence;",
  ),
  '7|7|7|0|0|7',
);
assert.equal(
  psql(
    "SELECT count(*) FILTER(WHERE identity_semantics='preserved' AND drill_kind IN ('restore-identity','move-identity')),count(*) FILTER(WHERE identity_semantics='new-identity' AND drill_kind='clone-identity'),count(*) FILTER(WHERE execution_scope='isolated-restore'),count(*) FILTER(WHERE execution_scope='isolated-adapter') FROM core.framework_operational_drill_evidence;",
  ),
  '2|1|5|1',
);
assert.equal(
  psql(
    'SELECT count(*),count(*) FILTER(WHERE enabled) FROM core.framework_capability_canary_policies;',
  ),
  '6|0',
);
assert.equal(psql('SELECT count(*) FROM core.frameworks;'), '1');
assert.equal(psql('SELECT count(*) FROM core.agent_profile_projections;'), '6');
assert.equal(psql('SELECT count(*) FROM core.verify_audit_chain();'), '0');
assert.equal(
  psql("SELECT count(*) FROM pg_database WHERE datname LIKE 'unify_phase10_drill_%';"),
  '0',
);

const mutationGuard = psql(`BEGIN;
DO $$ BEGIN
  BEGIN
    UPDATE core.framework_operational_drill_evidence SET result='held';
    RAISE EXCEPTION 'expected immutable rejection';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM core.framework_operational_drill_policies;
    RAISE EXCEPTION 'expected immutable rejection';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END $$;
ROLLBACK;
SELECT 'PASS';`)
  .split('\n')
  .at(-1);
assert.equal(mutationGuard, 'PASS');

const profiles = await ownerGet('/control/v1/profiles?limit=100');
assert.equal(profiles.data.items.length, 6);
assert.equal(
  profiles.sourceVersion,
  'sha256:2a1eca4c8831411f2111d99c8920e6dcc25b348086a667ad6b1ec49da24b1813',
);
assert.deepEqual(profiles.data.items.map((item) => item.id).sort(), [
  'chatboard',
  'default',
  'devops-agent',
  'pm-agent',
  'test-agent',
  'ulrich',
]);
const identity = await ownerGet('/control/v1/identity');
assert.equal(identity.frameworkId, 'hermes-main');

const evidenceRef = psql(
  'SELECT min(evidence_reference) FROM core.framework_operational_drill_evidence;',
);
assert.ok(evidenceRef.startsWith('.artifacts/hermes-phase10/'));
const artifactDir = dirname(join(root, evidenceRef));
run('sha256sum', ['-c', 'SHA256SUMS'], { cwd: artifactDir });
run('sha256sum', ['-c', 'phase10-post-migration.tar.enc.sha256'], { cwd: artifactDir });
const result = JSON.parse(readFileSync(join(artifactDir, 'phase10-result.json'), 'utf8'));
assert.equal(result.ok, true);
assert.equal(result.drills.passed, 7);
assert.equal(result.terminal.ownerMutationCount, 0);
assert.equal(result.terminal.secretMaterialPersisted, false);

for (const service of [
  'postgres',
  'gateway',
  'uniui',
  'alerts-pwa',
  'chat-pwa',
  'hermes-main-adapter',
]) {
  const id = run('docker', ['compose', 'ps', '-q', service]);
  assert.ok(id);
  assert.equal(
    run('docker', [
      'inspect',
      '-f',
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
      id,
    ]),
    'running|healthy',
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contractVersion: 'alica-hermes-operational-drills/v0.1',
      migrations: 22,
      policies: 1,
      enabledPolicies: 0,
      evidence: 7,
      passed: 7,
      ownerProfiles: 6,
      ownerSourceVersion: profiles.sourceVersion,
      ownerMutations: 0,
      secretMaterialPersisted: false,
      auditFailures: 0,
      servicesHealthy: 6,
      artifactDir,
    },
    null,
    2,
  ),
);
