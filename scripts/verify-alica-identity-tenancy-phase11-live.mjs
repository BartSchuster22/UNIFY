#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
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
const migration = readFileSync(
  join(root, 'apps/core/migrations/023_alica_identity_tenancy_phase11.sql'),
  'utf8',
);
const checksum = createHash('sha256').update(migration).digest('hex');
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;'),
  '23|1|23',
);
assert.equal(psql('SELECT checksum FROM core.schema_migrations WHERE version=23;'), checksum);
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='core' AND table_name LIKE 'alica_%';",
  ),
  '16',
);
assert.equal(
  psql(`SELECT
 (SELECT count(*) FROM core.alica_tenants),
 (SELECT count(*) FROM core.alica_installation_identity),
 (SELECT count(*) FROM core.alica_principals),
 (SELECT count(*) FROM core.alica_principal_aliases),
 (SELECT count(*) FROM core.alica_tenant_memberships),
 (SELECT count(*) FROM core.alica_membership_role_bindings),
 (SELECT count(*) FROM core.alica_registered_clients),
 (SELECT count(*) FROM core.alica_tenant_client_grants),
 (SELECT count(*) FROM core.alica_principal_client_grants),
 (SELECT count(*) FROM core.alica_cell_instances),
 (SELECT count(*) FROM core.alica_principal_instance_grants),
 (SELECT count(*) FROM core.alica_managed_trust_anchors),
 (SELECT count(*) FROM core.alica_managed_projection_state);`),
  '1|1|1|1|1|1|1|1|1|1|1|0|0',
);
assert.equal(
  psql(`SELECT count(*),count(*) FILTER (WHERE NOT enabled AND terminal_state='disabled'),string_agg(contract_version,',')
FROM core.alica_identity_canary_policies;`),
  '1|1|alica-identity-tenancy-execution/v0.1',
);
assert.equal(
  psql(`SELECT count(*),string_agg(phase,',' ORDER BY phase),count(*) FILTER (WHERE result='passed' AND owner_state_preserved AND NOT secret_material_persisted AND safe_result_code='PASS')
FROM core.alica_identity_phase_evidence;`),
  '6|I2,I3,I4,I5,I6,I7|6',
);
assert.equal(
  psql(
    `SELECT (SELECT count(*) FROM public.users),(SELECT count(*) FROM public.sessions),(SELECT count(*) FROM public.user_roles);`,
  ),
  '1|1264|1',
);
const decision =
  psql(`SELECT core.evaluate_alica_instance_authorization(p.principal_id,c.client_id,t.tenant_id,i.instance_id,'frameworks.read',true,true)
FROM core.alica_principals p
JOIN core.alica_tenant_memberships m ON m.principal_id=p.principal_id
JOIN core.alica_tenants t ON t.tenant_id=m.tenant_id
CROSS JOIN core.alica_registered_clients c
JOIN core.alica_cell_instances i ON i.tenant_id=t.tenant_id;`);
assert.equal(decision, 'AUTHORIZED');
assert.equal(
  psql(`SELECT core.evaluate_alica_instance_authorization(p.principal_id,c.client_id,t.tenant_id,'ins_01M0FC3KKXD92Z74HGF1A87ZYR','frameworks.read',true,true)
FROM core.alica_principals p CROSS JOIN core.alica_registered_clients c CROSS JOIN core.alica_tenants t;`),
  'AUTHORIZATION_DENIED',
);
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='core' AND table_name LIKE 'alica_%' AND column_name ~ '(private|secret|password|token|credential)';",
  ),
  '0',
);
console.log(
  JSON.stringify(
    {
      ok: true,
      contractVersion: 'alica-identity-tenancy-execution/v0.1',
      implementationRevision: run('git', ['rev-parse', 'HEAD']),
      migration: 23,
      canonicalTables: 16,
      phases: ['I2', 'I3', 'I4', 'I5', 'I6', 'I7'],
      dshBindings: 1,
      managedLiveBindings: 0,
      currentAuthorization: 'AUTHORIZED',
      wrongInstance: 'AUTHORIZATION_DENIED',
      policiesEnabled: 0,
      predecessorPreserved: true,
      secretMaterialPersisted: false,
    },
    null,
    2,
  ),
);
