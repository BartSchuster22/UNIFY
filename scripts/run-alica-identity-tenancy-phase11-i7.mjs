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
const backup = join(artifactDir, 'phase11-i7-recovery.tar.enc');
const isolated = `unify_p11_i7_${process.pid}`;
const temp = mkdtempSync(join(tmpdir(), 'unify-p11-i7-'));
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
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
function decisions(output) {
  return output.split('\n').filter((line) => ['AUTHORIZED', 'AUTHORIZATION_DENIED'].includes(line));
}
const cleanup = () => {
  try {
    run('docker', ['exec', container, 'dropdb', '-U', 'unify', '--if-exists', isolated]);
  } catch (error) {
    process.stderr.write(`Phase 11 I7 cleanup warning: ${String(error)}\n`);
  }
  rmSync(temp, { recursive: true, force: true });
};
process.on('exit', cleanup);
assert.equal(run('git', ['status', '--porcelain']), '', 'UNIFY checkout must be clean');
const implementationRevision = run('git', ['rev-parse', 'HEAD']);
assert.equal(
  psql('SELECT count(*),min(version),max(version) FROM core.schema_migrations;', 'unify'),
  '23|1|23',
);
assert.equal(psql('SELECT count(*) FROM core.alica_identity_phase_evidence;', 'unify'), '5');
assert.equal(
  psql('SELECT count(*) FROM core.alica_identity_canary_policies WHERE enabled;', 'unify'),
  '0',
);
run(
  'bash',
  ['-lc', 'BACKUP_FILE="$BACKUP" UNIFY_GIT_COMMIT="$REVISION" scripts/backup-gateway.sh'],
  { env: { ...process.env, BACKUP: backup, REVISION: implementationRevision } },
);
run('scripts/rehearse-restore.sh', [backup]);
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
const ids = psql(`SELECT t.tenant_id,p.principal_id,m.membership_id,c.client_id,i.instance_id
FROM core.alica_installation_identity x
JOIN core.alica_tenants t ON t.tenant_id=x.home_tenant_id
JOIN core.alica_tenant_memberships m ON m.tenant_id=t.tenant_id
JOIN core.alica_principals p ON p.principal_id=m.principal_id
JOIN core.alica_registered_clients c ON c.client_key='uniui-dsh'
JOIN core.alica_cell_instances i ON i.tenant_id=t.tenant_id;`).split('|');
assert.equal(ids.length, 5);
const [tenantId, principalId, membershipId, clientId, instanceId] = ids;
const digestSql = `SELECT encode(digest(string_agg(k||'|'||v,E'\\n' ORDER BY k,v),'sha256'),'hex') FROM (
 SELECT 't' k,tenant_id||'|'||status v FROM core.alica_tenants UNION ALL
 SELECT 'p',principal_id||'|'||status FROM core.alica_principals UNION ALL
 SELECT 'm',membership_id||'|'||status FROM core.alica_tenant_memberships UNION ALL
 SELECT 'c',client_id||'|'||status FROM core.alica_registered_clients UNION ALL
 SELECT 'i',instance_id||'|'||status FROM core.alica_cell_instances UNION ALL
 SELECT 'g',grant_id||'|'||status FROM core.alica_principal_instance_grants
) q;`;
const beforeDigest = psql(digestSql);
const moved = decisions(
  psql(`BEGIN;
WITH ni AS (
 INSERT INTO core.alica_cell_instances(instance_id,tenant_id,identity_profile,native_namespace,native_value,status,authority,replacement_for_instance_id)
 SELECT core.generate_alica_id('ins'),tenant_id,identity_profile,native_namespace,native_value||'-moved','active','cell',instance_id
 FROM core.alica_cell_instances WHERE instance_id='${instanceId}' RETURNING instance_id
), ng AS (
 INSERT INTO core.alica_principal_instance_grants(grant_id,membership_id,client_id,instance_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),g.membership_id,g.client_id,ni.instance_id,'active',g.capability_ceiling,'cell'
 FROM core.alica_principal_instance_grants g CROSS JOIN ni WHERE g.instance_id='${instanceId}' RETURNING instance_id
)
UPDATE core.alica_cell_instances SET status='retired',revision=revision+1 WHERE instance_id='${instanceId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}',instance_id,'frameworks.read',true,true) FROM ng;
ROLLBACK;`),
);
assert.deepEqual(moved, ['AUTHORIZATION_DENIED', 'AUTHORIZED']);
const replaced = decisions(
  psql(`BEGIN;
WITH nc AS (
 INSERT INTO core.alica_registered_clients(client_id,client_key,display_name,client_type,identity_profile,status)
 SELECT core.generate_alica_id('cli'),client_key||'-replacement',display_name||' replacement',client_type,identity_profile,'active'
 FROM core.alica_registered_clients WHERE client_id='${clientId}' RETURNING client_id
), tg AS (
 INSERT INTO core.alica_tenant_client_grants(grant_id,tenant_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),g.tenant_id,nc.client_id,'active',g.capability_ceiling,'cell' FROM core.alica_tenant_client_grants g CROSS JOIN nc WHERE g.client_id='${clientId}'
), pg AS (
 INSERT INTO core.alica_principal_client_grants(grant_id,membership_id,client_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),g.membership_id,nc.client_id,'active',g.capability_ceiling,'cell' FROM core.alica_principal_client_grants g CROSS JOIN nc WHERE g.client_id='${clientId}'
), ig AS (
 INSERT INTO core.alica_principal_instance_grants(grant_id,membership_id,client_id,instance_id,status,capability_ceiling,authority)
 SELECT core.generate_alica_id('grn'),g.membership_id,nc.client_id,g.instance_id,'active',g.capability_ceiling,'cell' FROM core.alica_principal_instance_grants g CROSS JOIN nc WHERE g.client_id='${clientId}' RETURNING client_id
)
UPDATE core.alica_registered_clients SET status='disabled',revision=revision+1 WHERE client_id='${clientId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
SELECT core.evaluate_alica_instance_authorization('${principalId}',client_id,'${tenantId}','${instanceId}','frameworks.read',true,true) FROM ig;
ROLLBACK;`),
);
assert.deepEqual(replaced, ['AUTHORIZATION_DENIED', 'AUTHORIZED']);
const closed = decisions(
  psql(`BEGIN;
UPDATE core.alica_tenants SET status='suspended',revision=revision+1 WHERE tenant_id='${tenantId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
ROLLBACK;
BEGIN;
UPDATE core.alica_tenant_memberships SET status='suspended',revision=revision+1 WHERE membership_id='${membershipId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
ROLLBACK;
BEGIN;
UPDATE core.alica_principals SET status='retired',revision=revision+1 WHERE principal_id='${principalId}';
SELECT core.evaluate_alica_instance_authorization('${principalId}','${clientId}','${tenantId}','${instanceId}','frameworks.read',true,true);
ROLLBACK;`),
);
assert.deepEqual(closed, ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED']);
const trust = psql(`BEGIN;
INSERT INTO core.alica_managed_trust_anchors(authority,issuer_normalized,audience_cell,signer_fingerprint,status,valid_from,valid_until)
VALUES('psi','https://psi.aquiero.com','${instanceId}',decode(repeat('b',64),'hex'),'active',clock_timestamp(),clock_timestamp()+interval '1 hour');
INSERT INTO core.alica_managed_projection_state(authority,projection_kind,tenant_id,source_version,message_id,issuer_normalized,audience_cell,payload_digest,signer_fingerprint,accepted_at,fresh_until,status)
VALUES('psi','instance','${tenantId}',1,'phase11-i7-message','https://psi.aquiero.com','${instanceId}',decode(repeat('a',64),'hex'),decode(repeat('b',64),'hex'),clock_timestamp(),clock_timestamp()+interval '5 minutes','accepted');
UPDATE core.alica_managed_projection_state SET status='revoked',revision=revision+1 WHERE authority='psi';
UPDATE core.alica_managed_trust_anchors SET status='revoked',revoked_at=clock_timestamp(),revision=revision+1 WHERE authority='psi';
SELECT count(*),min(a.status),min(p.status) FROM core.alica_managed_trust_anchors a JOIN core.alica_managed_projection_state p USING(authority,issuer_normalized,audience_cell,signer_fingerprint);
ROLLBACK;`)
  .split('\n')
  .find((line) => /^1\|/u.test(line));
assert.equal(trust, '1|revoked|revoked');
assert.equal(
  psql(
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='core' AND table_name LIKE 'alica_%' AND column_name ~ '(private|secret|password|token|credential)';",
  ),
  '0',
);
assert.equal(psql(digestSql), beforeDigest);
assert.equal(psql('SELECT count(*) FROM core.alica_managed_trust_anchors;'), '0');
assert.equal(psql('SELECT count(*) FROM core.alica_managed_projection_state;'), '0');
const resultDigest = sha(JSON.stringify({ beforeDigest, moved, replaced, closed, trust }));
psql(
  `INSERT INTO core.alica_identity_phase_evidence
(evidence_id,policy_id,phase,evidence_kind,result,execution_scope,source_digest,result_digest,mutation_count,owner_state_preserved,secret_material_persisted,safe_result_code,evidence_reference)
SELECT core.generate_alica_id('evd'),policy_id,'I7','recovery-retirement','passed','isolated-credential',decode('${sha(readFileSync(backup))}','hex'),decode('${resultDigest}','hex'),1,true,false,'PASS','revision:${implementationRevision}'
FROM core.alica_identity_canary_policies;`,
  'unify',
);
assert.equal(psql('SELECT count(*) FROM core.alica_identity_phase_evidence;', 'unify'), '6');
assert.equal(
  psql('SELECT count(*) FROM core.alica_identity_canary_policies WHERE enabled;', 'unify'),
  '0',
);
const result = {
  ok: true,
  contractVersion: 'alica-identity-tenancy-execution/v0.1',
  implementationRevision,
  restorePassed: true,
  move: { oldDenied: true, replacementAllowed: true },
  replace: { oldDenied: true, replacementAllowed: true },
  closure: { tenantDenied: true, membershipDenied: true, principalDenied: true },
  trustRetirement: { projectionRevoked: true, signerRevoked: true, secretMaterialPersisted: false },
  deterministicRebuild: { identityDigestPreserved: true, digest: beforeDigest },
  liveCanaryResidue: 0,
  livePolicyEnabled: false,
  ownerStatePreserved: true,
  artifactDir,
};
writeFileSync(join(artifactDir, 'phase11-i7-result.json'), `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
writeFileSync(
  join(artifactDir, 'SHA256SUMS'),
  `${sha(readFileSync(join(artifactDir, 'phase11-i7-result.json')))}  phase11-i7-result.json\n${sha(readFileSync(backup))}  phase11-i7-recovery.tar.enc\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
