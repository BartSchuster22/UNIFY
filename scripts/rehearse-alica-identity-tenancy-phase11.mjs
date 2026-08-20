#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
const stamp = new Date().toISOString().replaceAll(/[-:.]/g, '');
const artifactDir = join(root, '.artifacts', 'identity-tenancy-phase11', stamp);
const backup = join(artifactDir, 'phase11-pre-migration.tar.enc');
const isolated = `unify_p11_rehearsal_${process.pid}`;
const restored = `unify_p11_restore_${process.pid}`;
const temp = mkdtempSync(join(tmpdir(), 'unify-p11-'));
const migrationPath = join(root, 'apps/core/migrations/023_alica_identity_tenancy_phase11.sql');
const downPath = join(
  root,
  'deploy/five-service/identity-tenancy-phase11/023_alica_identity_tenancy_phase11.down.sql',
);
const repairPath = join(
  root,
  'deploy/five-service/identity-tenancy-phase11/023_alica_identity_tenancy_phase11.forward-repair.sql',
);
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
function psql(sql, database = isolated) {
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
function applyFile(path, database = isolated) {
  return psql(readFileSync(path, 'utf8'), database);
}
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
const cleanup = () => {
  for (const database of [isolated, restored]) {
    try {
      run('docker', ['exec', container, 'dropdb', '-U', 'unify', '--if-exists', database]);
    } catch (error) {
      process.stderr.write(`Phase 11 cleanup warning for ${database}: ${String(error)}\n`);
    }
  }
  rmSync(temp, { recursive: true, force: true });
};
process.on('exit', cleanup);

run(
  'bash',
  [
    '-lc',
    'BACKUP_FILE="$BACKUP" UNIFY_GIT_COMMIT="$(git rev-parse HEAD)" scripts/backup-gateway.sh',
  ],
  { env: { ...process.env, BACKUP: backup } },
);
run('scripts/rehearse-restore.sh', [backup], {
  env: {
    ...process.env,
    EXPECTED_CORE_MIGRATIONS: Array.from({ length: 22 }, (_, index) => index + 1).join(','),
  },
});
run(
  'bash',
  [
    '-lc',
    'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$BACKUP" | tar -C "$TMP" -xf -',
  ],
  {
    env: {
      ...process.env,
      KEY: join(root, '.secrets', 'backup_encryption_key'),
      BACKUP: backup,
      TMP: temp,
    },
  },
);
run('docker', ['exec', container, 'createdb', '-U', 'unify', isolated]);
run(
  'bash',
  [
    '-lc',
    'docker exec -i "$CONTAINER" pg_restore -U unify -d "$DB" --exit-on-error --no-owner --no-acl < "$DUMP"',
  ],
  { env: { ...process.env, CONTAINER: container, DB: isolated, DUMP: join(temp, 'gateway.dump') } },
);
const predecessorBefore = psql(`SELECT
 (SELECT count(*) FROM public.users),
 (SELECT count(*) FROM public.sessions),
 (SELECT count(*) FROM public.user_roles),
 encode(digest((SELECT string_agg(id::text||'|'||status,';' ORDER BY id) FROM public.users)||'|'||(SELECT count(*) FROM public.sessions)::text,'sha256'),'hex');`);
assert.match(predecessorBefore, /^1\|1264\|1\|[a-f0-9]{64}$/u);
const migrationChecksum = sha(readFileSync(migrationPath));
applyFile(migrationPath);
psql(
  `INSERT INTO core.schema_migrations(version,name,checksum) VALUES(23,'alica_identity_tenancy_phase11','${migrationChecksum}');`,
);
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;'),
  '23|1|23',
);
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='core' AND table_name LIKE 'alica_%';",
  ),
  '16',
);
applyFile(downPath);
psql('DELETE FROM core.schema_migrations WHERE version=23;');
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='core' AND table_name LIKE 'alica_%';",
  ),
  '0',
);
applyFile(migrationPath);
psql(
  `INSERT INTO core.schema_migrations(version,name,checksum) VALUES(23,'alica_identity_tenancy_phase11','${migrationChecksum}');`,
);
applyFile(repairPath);
applyFile(repairPath);

const seeded = psql(`BEGIN;
WITH ids AS (
 SELECT core.generate_alica_id('ten') tenant_id,core.generate_alica_id('prn') principal_id,
        core.generate_alica_id('mbr') membership_id,core.generate_alica_id('cli') client_id,
        core.generate_alica_id('ins') instance_id
), t AS (
 INSERT INTO core.alica_tenants(tenant_id,origin,slug_normalized,display_name,status,authority)
 SELECT tenant_id,'dsh-local','dsh-home','DSH Home','active','cell' FROM ids RETURNING tenant_id
), install AS (
 INSERT INTO core.alica_installation_identity(singleton_key,home_tenant_id) SELECT 'cell',tenant_id FROM ids
), p AS (
 INSERT INTO core.alica_principals(principal_id,kind,status,authority) SELECT principal_id,'user','active','cell' FROM ids RETURNING principal_id
), a AS (
 INSERT INTO core.alica_principal_aliases(alias_namespace,alias_value,principal_id,source_table)
 SELECT 'gateway-user-uuid',u.id::text,ids.principal_id,'public.users' FROM public.users u CROSS JOIN ids
), m AS (
 INSERT INTO core.alica_tenant_memberships(membership_id,tenant_id,principal_id,status,authority)
 SELECT membership_id,tenant_id,principal_id,'active','cell' FROM ids RETURNING membership_id
), rb AS (
 INSERT INTO core.alica_membership_role_bindings(membership_id,legacy_role_id,framework_scope,resource_scope)
 SELECT ids.membership_id,ur.role_id,ur.framework_scope,ur.resource_scope FROM public.user_roles ur CROSS JOIN ids
), c AS (
 INSERT INTO core.alica_registered_clients(client_id,client_key,display_name,client_type,identity_profile,status)
 SELECT client_id,'uniui-dsh','UNIUI DSH','browser-bff','dsh-standard/v1','active' FROM ids RETURNING client_id
), tg AS (
 INSERT INTO core.alica_tenant_client_grants(grant_id,tenant_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),tenant_id,client_id,'active','["frameworks.read","profiles.read"]','cell' FROM ids
), pg AS (
 INSERT INTO core.alica_principal_client_grants(grant_id,membership_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),membership_id,client_id,'active','["frameworks.read","profiles.read"]','cell' FROM ids
), i AS (
 INSERT INTO core.alica_cell_instances(instance_id,tenant_id,identity_profile,native_namespace,native_value,status,authority)
 SELECT instance_id,tenant_id,'dsh-standard/v1','dsh-cell','unify-five-service','active','cell' FROM ids RETURNING instance_id
), ig AS (
 INSERT INTO core.alica_principal_instance_grants(grant_id,membership_id,client_id,instance_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),membership_id,client_id,instance_id,'active','["frameworks.read","profiles.read"]','cell' FROM ids
)
SELECT tenant_id,principal_id,membership_id,client_id,instance_id FROM ids;
COMMIT;`)
  .split('\n')
  .at(-2);
const [tenantId, principalId, membershipId, clientId, instanceId] = seeded.split('|');
assert.match(tenantId, /^ten_/u);
assert.match(principalId, /^prn_/u);
assert.match(membershipId, /^mbr_/u);
assert.match(clientId, /^cli_/u);
assert.match(instanceId, /^ins_/u);
assert.equal(
  psql(
    `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);`,
  ),
  'AUTHORIZED',
);
for (const sql of [
  `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','ten_01M0FC3KKXD92Z74HGF1A87ZYR','${instanceId}','frameworks.read',true,true);`,
  `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','ins_01M0FC3KKXD92Z74HGF1A87ZYR','frameworks.read',true,true);`,
  `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','settings.manage',true,true);`,
])
  assert.equal(psql(sql), 'AUTHORIZATION_DENIED');
assert.equal(
  psql(
    `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',false,true);`,
  ),
  'TECHNICAL_PERMISSION_REQUIRED',
);
assert.equal(
  psql(
    `SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,false);`,
  ),
  'ENTITLEMENT_DENIED',
);
const canary = psql(`BEGIN;
UPDATE core.alica_principal_instance_grants SET status='revoked',revision=revision+1 WHERE instance_id='${instanceId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
ROLLBACK;`)
  .split('\n')
  .at(-2);
assert.equal(canary, 'AUTHORIZATION_DENIED');
const aliasGuard = psql(`DO $$ BEGIN
 BEGIN
  UPDATE core.alica_principal_aliases SET principal_id=core.generate_alica_id('prn');
  RAISE EXCEPTION 'expected alias guard';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
SELECT 'PASS';`)
  .split('\n')
  .at(-1);
assert.equal(aliasGuard, 'PASS');
let populatedDownRejected = false;
try {
  applyFile(downPath);
} catch (error) {
  populatedDownRejected = String(error).includes('ALICA_IDENTITY_FORWARD_REPAIR_REQUIRED');
}
assert.equal(populatedDownRejected, true);
const predecessorAfter = psql(`SELECT
 (SELECT count(*) FROM public.users),
 (SELECT count(*) FROM public.sessions),
 (SELECT count(*) FROM public.user_roles),
 encode(digest((SELECT string_agg(id::text||'|'||status,';' ORDER BY id) FROM public.users)||'|'||(SELECT count(*) FROM public.sessions)::text,'sha256'),'hex');`);
assert.equal(predecessorAfter, predecessorBefore);
const identityDigestSql = `SELECT encode(digest(string_agg(kind||'|'||value,E'\\n' ORDER BY kind,value),'sha256'),'hex') FROM (
 SELECT 'tenant' kind,tenant_id||'|'||origin||'|'||status value FROM core.alica_tenants
 UNION ALL SELECT 'principal',principal_id||'|'||kind||'|'||status FROM core.alica_principals
 UNION ALL SELECT 'alias',alias_namespace||'|'||alias_value||'|'||principal_id FROM core.alica_principal_aliases
 UNION ALL SELECT 'membership',membership_id||'|'||tenant_id||'|'||principal_id||'|'||status FROM core.alica_tenant_memberships
 UNION ALL SELECT 'client',client_id||'|'||client_key||'|'||status FROM core.alica_registered_clients
 UNION ALL SELECT 'instance',instance_id||'|'||tenant_id||'|'||status FROM core.alica_cell_instances
) q;`;
const identityDigest = psql(identityDigestSql);
const isolatedDump = join(temp, 'identity-rehearsal.dump');
run('bash', ['-lc', 'docker exec "$CONTAINER" pg_dump -U unify -Fc "$DB" > "$DUMP"'], {
  env: { ...process.env, CONTAINER: container, DB: isolated, DUMP: isolatedDump },
});
run('docker', ['exec', container, 'createdb', '-U', 'unify', restored]);
run(
  'bash',
  [
    '-lc',
    'docker exec -i "$CONTAINER" pg_restore -U unify -d "$DB" --exit-on-error --no-owner --no-acl < "$DUMP"',
  ],
  { env: { ...process.env, CONTAINER: container, DB: restored, DUMP: isolatedDump } },
);
assert.equal(psql(identityDigestSql, restored), identityDigest);
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;', restored),
  '23|1|23',
);
const result = {
  ok: true,
  contractVersion: 'alica-identity-tenancy-execution/v0.1',
  migration: 23,
  canonicalTables: 16,
  predecessor: { users: 1, sessions: 1264, userRoles: 1, preserved: true },
  rehearsal: {
    encryptedBackup: true,
    restorePassed: true,
    emptyDownPassed: true,
    reapplyPassed: true,
    forwardRepairIdempotent: true,
    populatedDownRejected,
    aliasReassignmentRejected: true,
    secondRestoreIdentityPreserved: true,
  },
  authorization: {
    allow: true,
    wrongTenantDenied: true,
    wrongInstanceDenied: true,
    capabilityDenied: true,
    revokedDenied: true,
    entitlementCannotGrant: true,
  },
  identityDigest,
  mutation: 'isolated-only',
  liveMutation: false,
  secretMaterialPersisted: false,
  artifactDir,
};
writeFileSync(
  join(artifactDir, 'phase11-rehearsal-result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  {
    mode: 0o600,
  },
);
writeFileSync(
  join(artifactDir, 'SHA256SUMS'),
  `${sha(readFileSync(join(artifactDir, 'phase11-rehearsal-result.json')))}  phase11-rehearsal-result.json\n${sha(readFileSync(backup))}  phase11-pre-migration.tar.enc\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
