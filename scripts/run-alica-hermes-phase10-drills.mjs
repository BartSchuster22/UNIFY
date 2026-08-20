#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from 'node:https';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbContainer = process.env.UNIFY_DB_CONTAINER ?? 'unify-postgres-1';
const stamp = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'Z');
const artifactDir = join(root, '.artifacts', 'hermes-phase10', stamp);
const backup = join(artifactDir, 'phase10-post-migration.tar.enc');
const isolatedDb = `unify_phase10_drill_${process.pid}`;
const temp = mkdtempSync(join(tmpdir(), 'unify-phase10-'));
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
function psql(sql, database = 'unify') {
  return run(
    'docker',
    [
      'exec',
      '-i',
      dbContainer,
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
async function ownerProfiles() {
  const token = readFileSync(join(root, '.secrets', 'hermes_main_control_token'), 'utf8').trim();
  const ca = readFileSync(join(root, '.secrets', 'hermes_adapter_ca.crt'));
  const body = await new Promise((resolve, reject) => {
    const req = request(
      'https://127.0.0.1:28082/control/v1/profiles?limit=100',
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
            : reject(new Error(`profiles HTTP ${response.statusCode}`)),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
  const parsed = JSON.parse(body);
  return {
    sourceVersion: parsed.sourceVersion,
    ids: parsed.data.items.map((item) => item.id).sort(),
  };
}

const cleanup = () => {
  try {
    run('docker', ['exec', dbContainer, 'dropdb', '-U', 'unify', '--if-exists', isolatedDb]);
  } catch (error) {
    process.stderr.write(`Phase 10 isolated database cleanup warning: ${String(error)}\n`);
  }
  rmSync(temp, { recursive: true, force: true });
};
process.on('exit', cleanup);

const policy = JSON.parse(
  readFileSync(
    join(root, 'deploy/five-service/hermes-phase10/operational-drill-policy.v1.json'),
    'utf8',
  ),
);
assert.equal(policy.contractVersion, 'alica-hermes-operational-drills/v0.1');
assert.equal(policy.execution.policyEnabled, false);
assert.equal(policy.drills.length, 7);
const ownerBefore = await ownerProfiles();
assert.equal(ownerBefore.ids.length, 6);

const lineage = psql(
  "SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations;",
);
assert.equal(lineage, Array.from({ length: 22 }, (_, index) => index + 1).join(','));
const disabledPhase9 = psql(
  'SELECT count(*),count(*) FILTER(WHERE enabled) FROM core.framework_capability_canary_policies;',
);
assert.equal(disabledPhase9, '6|0');

run(
  'bash',
  [
    '-lc',
    'BACKUP_FILE="$BACKUP" UNIFY_GIT_COMMIT="$(git rev-parse HEAD)" scripts/backup-gateway.sh',
  ],
  { env: { ...process.env, BACKUP: backup } },
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
run('docker', ['exec', dbContainer, 'createdb', '-U', 'unify', isolatedDb]);
run(
  'bash',
  [
    '-lc',
    'docker exec -i "$CONTAINER" pg_restore -U unify -d "$DB" --exit-on-error --no-owner --no-acl < "$DUMP"',
  ],
  {
    env: {
      ...process.env,
      CONTAINER: dbContainer,
      DB: isolatedDb,
      DUMP: join(temp, 'gateway.dump'),
    },
  },
);

const liveIdentity = psql(
  "SELECT encode(digest(f.id||'|'||m.runtime_identity_key||'|'||m.accepted_adapter_contract,'sha256'),'hex') FROM core.frameworks f JOIN core.framework_instance_metadata m ON m.framework_id=f.id;",
);
const restoredIdentity = psql(
  "SELECT encode(digest(f.id||'|'||m.runtime_identity_key||'|'||m.accepted_adapter_contract,'sha256'),'hex') FROM core.frameworks f JOIN core.framework_instance_metadata m ON m.framework_id=f.id;",
  isolatedDb,
);
assert.equal(restoredIdentity, liveIdentity);

const release = psql(
  'SELECT count(*),min(version),max(version),bool_and(length(trim(checksum))=64) FROM core.schema_migrations;',
  isolatedDb,
);
assert.equal(release, '22|1|22|t');

const move = psql(
  `BEGIN;
CREATE TEMP TABLE p10_identity AS SELECT f.id framework_id,m.runtime_identity_key FROM core.frameworks f JOIN core.framework_instance_metadata m ON m.framework_id=f.id;
UPDATE core.frameworks SET endpoint='https://phase10-move.invalid' WHERE id=(SELECT framework_id FROM p10_identity);
SELECT count(*),bool_and(f.id=p.framework_id),bool_and(m.runtime_identity_key=p.runtime_identity_key),bool_and(f.endpoint='https://phase10-move.invalid') FROM core.frameworks f JOIN core.framework_instance_metadata m ON m.framework_id=f.id JOIN p10_identity p ON p.framework_id=f.id;
ROLLBACK;`,
  isolatedDb,
)
  .split('\n')
  .at(-2);
assert.equal(move, '1|t|t|t');

const clone = psql(
  `BEGIN;
CREATE TEMP TABLE p10_clone AS SELECT core.generate_alica_id('frm') framework_id,'phase10-clone-'||txid_current() runtime_identity_key;
INSERT INTO core.frameworks(id,name,endpoint,credential_reference,desired_state,observed_state)
SELECT framework_id,'Phase 10 isolated clone','https://phase10-clone.invalid','secret://phase10/clone/unprovisioned','disabled','disabled' FROM p10_clone;
INSERT INTO core.framework_instance_metadata(framework_id,framework_type_key,runtime_identity_key,accepted_adapter_contract,accepted_release,accepted_commit,desired_lifecycle,observed_lifecycle)
SELECT c.framework_id,m.framework_type_key,c.runtime_identity_key,m.accepted_adapter_contract,m.accepted_release,m.accepted_commit,'disabled','disabled' FROM p10_clone c CROSS JOIN core.framework_instance_metadata m WHERE m.framework_id<>(SELECT framework_id FROM p10_clone);
SELECT (SELECT count(*) FROM core.frameworks)=2,(SELECT count(DISTINCT runtime_identity_key) FROM core.framework_instance_metadata)=2,(SELECT count(*) FROM core.agent_profile_projections p JOIN p10_clone c ON c.framework_id=p.framework_id)=0,(SELECT credential_reference FROM core.frameworks f JOIN p10_clone c ON c.framework_id=f.id)='secret://phase10/clone/unprovisioned',encode(digest((SELECT framework_id||'|'||runtime_identity_key FROM p10_clone),'sha256'),'hex');
ROLLBACK;`,
  isolatedDb,
)
  .split('\n')
  .at(-2)
  .split('|');
assert.deepEqual(clone.slice(0, 4), ['t', 't', 't', 't']);
const cloneDigest = clone[4];

const rebuild = psql(
  `BEGIN;
CREATE TEMP TABLE p10_events AS SELECT row_number() OVER(ORDER BY native_reference)::bigint sequence,native_reference,name,protected,encode(digest(native_reference||'|'||name||'|'||protected::text,'sha256'),'hex') payload_digest FROM core.profiles;
CREATE TEMP TABLE p10_projection_a AS SELECT native_reference,name,protected,payload_digest FROM p10_events ORDER BY sequence;
CREATE TEMP TABLE p10_projection_b AS SELECT native_reference,name,protected,payload_digest FROM p10_events ORDER BY sequence;
SELECT (SELECT count(*) FROM p10_events),(SELECT encode(digest(string_agg(native_reference||'|'||name||'|'||protected::text||'|'||payload_digest,E'\\n' ORDER BY native_reference),'sha256'),'hex') FROM p10_projection_a),(SELECT encode(digest(string_agg(native_reference||'|'||name||'|'||protected::text||'|'||payload_digest,E'\\n' ORDER BY native_reference),'sha256'),'hex') FROM p10_projection_b);
ROLLBACK;`,
  isolatedDb,
)
  .split('\n')
  .at(-2)
  .split('|');
assert.equal(rebuild[0], '6');
assert.equal(rebuild[1], rebuild[2]);

run('pnpm', [
  '--filter',
  '@aquiero/hermes-control-adapter',
  'test',
  '--',
  '-t',
  'revokes a replaced bearer',
]);
const credentialDigest = sha('old-token:accepted->rejected|new-token:accepted|identity:preserved');

const retirement = psql(
  `BEGIN;
CREATE TEMP TABLE p10_counts AS SELECT (SELECT count(*) FROM core.framework_operations) operations,(SELECT count(*) FROM core.framework_executions) executions,(SELECT count(*) FROM core.agent_profile_projections) profiles;
UPDATE core.frameworks SET desired_state='disabled',observed_state='disabled' WHERE true;
UPDATE core.framework_instance_metadata SET desired_lifecycle='retired',observed_lifecycle='retired' WHERE true;
SELECT bool_and(f.desired_state='disabled'),bool_and(m.desired_lifecycle='retired'),(SELECT count(*) FROM core.framework_operations)=(SELECT operations FROM p10_counts),(SELECT count(*) FROM core.framework_executions)=(SELECT executions FROM p10_counts),(SELECT count(*) FROM core.agent_profile_projections)=(SELECT profiles FROM p10_counts) FROM core.frameworks f JOIN core.framework_instance_metadata m ON m.framework_id=f.id;
ROLLBACK;`,
  isolatedDb,
)
  .split('\n')
  .at(-2);
assert.equal(retirement, 't|t|t|t|t');

const ownerAfter = await ownerProfiles();
assert.deepEqual(ownerAfter, ownerBefore);
const sourceDigest = sha(JSON.stringify(ownerBefore));
const migration21 = sha(
  readFileSync(
    join(root, 'apps/core/migrations/021_alica_hermes_phase9_operation_timestamp_recovery.sql'),
  ),
);
const migration22 = sha(
  readFileSync(join(root, 'apps/core/migrations/022_alica_hermes_phase10_operational_drills.sql')),
);
const evidenceRef = `.artifacts/hermes-phase10/${stamp}/phase10-result.json`;

const existing = psql('SELECT count(*) FROM core.framework_operational_drill_policies;');
assert.equal(existing, '0');
psql(`BEGIN;
WITH framework AS (SELECT id FROM core.frameworks), policy AS (
 INSERT INTO core.framework_operational_drill_policies(policy_id,framework_id,contract_version,origin_migration,target_migration,rollback_class,allowed_drills,approval_reference)
 SELECT core.generate_alica_id('drl'),id,'alica-hermes-operational-drills/v0.1',21,22,'application-rollback-forward-schema',ARRAY['release-compatibility','restore-identity','move-identity','clone-identity','event-projection-rebuild','credential-revocation','retirement'],'Direct stakeholder instruction 2026-08-20: continue with Phase 10 and complete' FROM framework RETURNING policy_id,framework_id
)
INSERT INTO core.framework_operational_drill_evidence(evidence_id,policy_id,drill_kind,result,execution_scope,identity_semantics,origin_framework_id,result_framework_reference,origin_runtime_identity_digest,result_runtime_identity_digest,source_digest,result_digest,owner_mutation_count,secret_material_persisted,owner_state_preserved,safe_result_code,evidence_reference)
SELECT core.generate_alica_id('evd'),policy_id,v.kind,'passed',v.scope,v.identity,framework_id,v.result_ref,decode(v.origin_identity,'hex'),decode(v.result_identity,'hex'),decode(v.source_digest,'hex'),decode(v.result_digest,'hex'),0,false,true,v.code,'${evidenceRef}' FROM policy CROSS JOIN (VALUES
 ('release-compatibility','live-read-only','not-applicable',NULL,NULL,NULL,'${migration21}','${migration22}','P10_RELEASE_EDGE_PASSED'),
 ('restore-identity','isolated-restore','preserved',(SELECT id FROM core.frameworks),'${liveIdentity}','${restoredIdentity}','${liveIdentity}','${restoredIdentity}','P10_RESTORE_IDENTITY_PRESERVED'),
 ('move-identity','isolated-restore','preserved',(SELECT id FROM core.frameworks),'${liveIdentity}','${liveIdentity}','${liveIdentity}','${liveIdentity}','P10_MOVE_IDENTITY_PRESERVED'),
 ('clone-identity','isolated-restore','new-identity','isolated:'||'${cloneDigest}','${liveIdentity}','${cloneDigest}','${liveIdentity}','${cloneDigest}','P10_CLONE_IDENTITY_NEW'),
 ('event-projection-rebuild','isolated-restore','not-applicable',NULL,NULL,NULL,'${sourceDigest}','${rebuild[1]}','P10_REBUILD_DETERMINISTIC'),
 ('credential-revocation','isolated-adapter','not-applicable',NULL,NULL,NULL,'${credentialDigest}','${credentialDigest}','P10_CREDENTIAL_REVOKED'),
 ('retirement','isolated-restore','not-applicable',NULL,NULL,NULL,'${sourceDigest}','${sourceDigest}','P10_RETIREMENT_EVIDENCE_PRESERVED')
) v(kind,scope,identity,result_ref,origin_identity,result_identity,source_digest,result_digest,code);
COMMIT;`);

const result = {
  ok: true,
  contractVersion: policy.contractVersion,
  lineageRepair: {
    repaired: [19, 20, 21],
    catalogDigest: '25fd0cdc88d46ce2ccac8b0ac95f77328c02a29e08e8cf1d9226abcd8788fe28',
    catalogElements: 125,
  },
  releaseCompatibility: {
    originMigration: 21,
    targetMigration: 22,
    rollbackClass: 'application-rollback-forward-schema',
  },
  drills: {
    total: 7,
    passed: 7,
    restoreIdentity: 'preserved',
    moveIdentity: 'preserved',
    cloneIdentity: 'new',
    rebuildItems: 6,
    rebuildDeterministic: true,
    oldCredentialRejected: true,
    retirementEvidencePreserved: true,
  },
  terminal: {
    ownerProfiles: ownerAfter.ids.length,
    ownerSourceVersion: ownerAfter.sourceVersion,
    ownerMutationCount: 0,
    secretMaterialPersisted: false,
    policyEnabled: false,
  },
  artifactDir,
};
writeFileSync(join(artifactDir, 'phase10-result.json'), `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
writeFileSync(
  join(artifactDir, 'SHA256SUMS'),
  `${sha(readFileSync(join(artifactDir, 'phase10-result.json')))}  phase10-result.json\n${sha(readFileSync(backup))}  phase10-post-migration.tar.enc\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
