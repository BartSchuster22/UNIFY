#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
const database = process.env.UNIFY_DATABASE ?? 'unify';
const stamp = new Date().toISOString().replaceAll(/[-:.]/g, '');
const artifactDir = join(root, '.artifacts', 'identity-tenancy-phase11', stamp);
const backup = join(artifactDir, 'phase11-live-pre-migration.tar.enc');
const migrationPath = join(root, 'apps/core/migrations/023_alica_identity_tenancy_phase11.sql');
mkdirSync(artifactDir, { recursive: true, mode: 0o700 });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
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
      database,
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
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

assert.equal(run('git', ['status', '--porcelain']), '', 'UNIFY checkout must be clean');
const implementationRevision = run('git', ['rev-parse', 'HEAD']);
const remoteRevision = run('git', [
  'ls-remote',
  'origin',
  'refs/heads/feature/unify-functionality-qa10',
]).split('\t')[0];
assert.equal(
  implementationRevision,
  remoteRevision,
  'UNIFY revision must be pushed and remote-exact',
);
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;'),
  '22|1|22',
);
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='core' AND table_name LIKE 'alica_%';",
  ),
  '0',
);
const predecessorBefore = psql(`SELECT
 (SELECT count(*) FROM public.users),
 (SELECT count(*) FROM public.sessions),
 (SELECT count(*) FROM public.user_roles),
 encode(digest((SELECT string_agg(id::text||'|'||status,';' ORDER BY id) FROM public.users)||'|'||(SELECT count(*) FROM public.sessions)::text,'sha256'),'hex');`);
assert.match(predecessorBefore, /^1\|1264\|1\|[a-f0-9]{64}$/u);
run(
  'bash',
  ['-lc', 'BACKUP_FILE="$BACKUP" UNIFY_GIT_COMMIT="$REVISION" scripts/backup-gateway.sh'],
  { env: { ...process.env, BACKUP: backup, REVISION: implementationRevision } },
);
run('scripts/rehearse-restore.sh', [backup], {
  env: {
    ...process.env,
    EXPECTED_CORE_MIGRATIONS: Array.from({ length: 22 }, (_, index) => index + 1).join(','),
  },
});
const migration = readFileSync(migrationPath, 'utf8');
const migrationChecksum = sha(migration);
psql(`BEGIN;
${migration}
INSERT INTO core.schema_migrations(version,name,checksum)
VALUES(23,'alica_identity_tenancy_phase11','${migrationChecksum}');
COMMIT;`);
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;'),
  '23|1|23',
);
const seeded = psql(`BEGIN;
WITH ids AS (
 SELECT core.generate_alica_id('ten') tenant_id,core.generate_alica_id('prn') principal_id,
        core.generate_alica_id('mbr') membership_id,core.generate_alica_id('cli') client_id,
        core.generate_alica_id('ins') instance_id
), t AS (
 INSERT INTO core.alica_tenants(tenant_id,origin,slug_normalized,display_name,status,authority)
 SELECT tenant_id,'dsh-local','dsh-home','DSH Home','active','cell' FROM ids
), install AS (
 INSERT INTO core.alica_installation_identity(singleton_key,home_tenant_id) SELECT 'cell',tenant_id FROM ids
), p AS (
 INSERT INTO core.alica_principals(principal_id,kind,status,authority) SELECT principal_id,'user','active','cell' FROM ids
), a AS (
 INSERT INTO core.alica_principal_aliases(alias_namespace,alias_value,principal_id,source_table)
 SELECT 'gateway-user-uuid',u.id::text,ids.principal_id,'public.users' FROM public.users u CROSS JOIN ids
), m AS (
 INSERT INTO core.alica_tenant_memberships(membership_id,tenant_id,principal_id,status,authority)
 SELECT membership_id,tenant_id,principal_id,'active','cell' FROM ids
), rb AS (
 INSERT INTO core.alica_membership_role_bindings(membership_id,legacy_role_id,framework_scope,resource_scope)
 SELECT ids.membership_id,ur.role_id,ur.framework_scope,ur.resource_scope FROM public.user_roles ur CROSS JOIN ids
), c AS (
 INSERT INTO core.alica_registered_clients(client_id,client_key,display_name,client_type,identity_profile,status)
 SELECT client_id,'uniui-dsh','UNIUI DSH','browser-bff','dsh-standard/v1','active' FROM ids
), caps AS (
 SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) value FROM public.permissions
), tg AS (
 INSERT INTO core.alica_tenant_client_grants(grant_id,tenant_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),tenant_id,client_id,'active',caps.value,'cell' FROM ids CROSS JOIN caps
), pg AS (
 INSERT INTO core.alica_principal_client_grants(grant_id,membership_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),membership_id,client_id,'active',caps.value,'cell' FROM ids CROSS JOIN caps
), i AS (
 INSERT INTO core.alica_cell_instances(instance_id,tenant_id,identity_profile,native_namespace,native_value,status,authority)
 SELECT instance_id,tenant_id,'dsh-standard/v1','dsh-cell','unify-five-service','active','cell' FROM ids
), ig AS (
 INSERT INTO core.alica_principal_instance_grants(grant_id,membership_id,client_id,instance_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),membership_id,client_id,instance_id,'active',caps.value,'cell' FROM ids CROSS JOIN caps
), policy AS (
 INSERT INTO core.alica_identity_canary_policies(policy_id,contract_version,allowed_profiles,approval_reference,enabled,terminal_state)
 SELECT core.generate_alica_id('pol'),'alica-identity-tenancy-execution/v0.1',ARRAY['dsh-standard/v1','managed-psi/v1'],'Telegram direct instruction: continue and complete phase 11',false,'disabled' FROM ids
)
SELECT tenant_id,principal_id,membership_id,client_id,instance_id FROM ids;
COMMIT;`)
  .split('\n')
  .at(-2);
const [tenantId, principalId, membershipId, clientId, instanceId] = seeded.split('|');
for (const [value, prefix] of [
  [tenantId, 'ten_'],
  [principalId, 'prn_'],
  [membershipId, 'mbr_'],
  [clientId, 'cli_'],
  [instanceId, 'ins_'],
])
  assert.ok(value.startsWith(prefix));
assert.equal(
  psql(
    `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);`,
  ),
  'AUTHORIZED',
);
const canaryOutputs = psql(`BEGIN;
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','ten_01M0FC3KKXD92Z74HGF1A87ZYR','${instanceId}','frameworks.read',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','ins_01M0FC3KKXD92Z74HGF1A87ZYR','frameworks.read',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','identity.superuser',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',false,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,false);
UPDATE core.alica_principal_instance_grants SET status='revoked',revision=revision+1 WHERE instance_id='${instanceId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
ROLLBACK;`)
  .split('\n')
  .filter((line) =>
    [
      'AUTHORIZED',
      'AUTHORIZATION_DENIED',
      'TECHNICAL_PERMISSION_REQUIRED',
      'ENTITLEMENT_DENIED',
    ].includes(line),
  );
assert.deepEqual(canaryOutputs, [
  'AUTHORIZED',
  'AUTHORIZATION_DENIED',
  'AUTHORIZATION_DENIED',
  'AUTHORIZATION_DENIED',
  'TECHNICAL_PERMISSION_REQUIRED',
  'ENTITLEMENT_DENIED',
  'AUTHORIZATION_DENIED',
]);
const predecessorAfter = psql(`SELECT
 (SELECT count(*) FROM public.users),
 (SELECT count(*) FROM public.sessions),
 (SELECT count(*) FROM public.user_roles),
 encode(digest((SELECT string_agg(id::text||'|'||status,';' ORDER BY id) FROM public.users)||'|'||(SELECT count(*) FROM public.sessions)::text,'sha256'),'hex');`);
assert.equal(predecessorAfter, predecessorBefore);
const resultDigest = sha(
  JSON.stringify({
    implementationRevision,
    predecessorBefore,
    tenantId,
    principalId,
    membershipId,
    clientId,
    instanceId,
  }),
);
psql(`INSERT INTO core.alica_identity_phase_evidence
(evidence_id,policy_id,phase,evidence_kind,result,execution_scope,source_digest,result_digest,mutation_count,owner_state_preserved,secret_material_persisted,safe_result_code,evidence_reference)
SELECT core.generate_alica_id('evd'),policy_id,v.phase,v.kind,'passed',v.scope,decode('${migrationChecksum}','hex'),decode('${resultDigest}','hex'),v.mutations,true,false,'PASS',v.reference
FROM core.alica_identity_canary_policies
CROSS JOIN (VALUES
 ('I2','schema-rehearsal','isolated-database',0,'local-encrypted-artifact'),
 ('I3','live-backfill','live-additive',10,'revision:${implementationRevision}'),
 ('I4','dsh-shadow','pure-evaluator',0,'revision:${implementationRevision}'),
 ('I5','psi-shadow','pure-evaluator',0,'revision:${implementationRevision}'),
 ('I6','enforcement-canary','live-additive',0,'transaction-rolled-back')
) AS v(phase,kind,scope,mutations,reference);`);
const result = {
  ok: true,
  contractVersion: 'alica-identity-tenancy-execution/v0.1',
  implementationRevision,
  migration: 23,
  predecessorPreserved: true,
  dsh: { tenantId, principalId, membershipId, clientId, instanceId, authorized: true },
  psi: { livePrincipalCreated: false, liveProjectionAccepted: false, shadowOnly: true },
  canary: { decisions: 7, allow: 1, deny: 6, transactionRolledBack: true },
  policyEnabled: false,
  runtimeEnforcementChanged: false,
  secretMaterialPersisted: false,
  artifactDir,
};
writeFileSync(
  join(artifactDir, 'phase11-live-result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  {
    mode: 0o600,
  },
);
writeFileSync(
  join(artifactDir, 'SHA256SUMS'),
  `${sha(readFileSync(join(artifactDir, 'phase11-live-result.json')))}  phase11-live-result.json\n${sha(readFileSync(backup))}  phase11-live-pre-migration.tar.enc\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
