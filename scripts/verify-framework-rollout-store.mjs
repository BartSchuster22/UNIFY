import assert from 'node:assert/strict';
import pg from '../apps/gateway/node_modules/pg/lib/index.js';
import { PostgresFrameworkUpdateStore } from '../apps/gateway/dist/framework-updates/postgres-store.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString });
const digest = `sha256:${'5'.repeat(64)}`;
const previousDigest = `sha256:${'1'.repeat(64)}`;
const commit = '3c27eb6234bf91b8ceee9e9071591b31e9b148cb';
const previousCommit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4';
const candidateId = `fuc_${'a'.repeat(64)}`;
const assessmentId = `fca_${'b'.repeat(64)}`;
const actorId = '11111111-1111-4111-8111-111111111111';
const imageReference = `registry.example/unify/hermes-candidate@${digest}`;

try {
  await pool.query(
    `INSERT INTO users(id,username,display_name,password_hash) VALUES($1,'rollout-admin','Rollout Admin','test')`,
    [actorId],
  );
  for (const [id, name] of [
    ['hermes-alica', 'Alica'],
    ['hermes-herman', 'Herman'],
  ]) {
    await pool.query(
      `INSERT INTO framework_registrations(
         id,display_name,adapter_id,base_url,secret_reference,scopes,contract_version,framework_version,framework_commit,status
       ) VALUES($1,$2,'hermes-control/v1','http://127.0.0.1','env:FIXTURE',ARRAY['control:read'],'hermes-control/v1','0.20.0',$3,'verified')`,
      [id, name, previousCommit],
    );
    await pool.query(
      `INSERT INTO framework_deployments(framework_id,release_id,image_reference,image_digest,framework_version,framework_commit)
       VALUES($1,'old-release',$2,$3,'0.18.0',$4)`,
      [id, `registry.example/old-${id}@${previousDigest}`, previousDigest, previousCommit],
    );
  }
  await pool.query(
    `INSERT INTO framework_update_sources(source_id,repository,trusted,last_checked_at,last_success_at)
     VALUES('hermes-upstream','NousResearch/hermes-agent',true,now(),now())`,
  );
  await pool.query(
    `INSERT INTO framework_update_candidates(candidate_id,source_id,tag_name,release_name,commit_sha,release_url,release_notes,published_at,prerelease,draft)
     VALUES($1,'hermes-upstream','v2026.8.3','v2026.8.3',$2,'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3','',now(),false,false)`,
    [candidateId, commit],
  );
  await pool.query(
    `INSERT INTO framework_candidate_assessments(
       assessment_id,candidate_id,state,source_commit,source_archive_digest,image_reference,image_digest,
       adapter_release,contract_version,contract_passed,acceptance_passed,evidence,evidence_digest,assessed_at)
     VALUES($1,$2,'ready',$3,$4,$5,$6,'phase-20.0','hermes-control/v1',true,true,$7,$8,now())`,
    [
      assessmentId,
      candidateId,
      commit,
      `sha256:${'2'.repeat(64)}`,
      imageReference,
      digest,
      { release: '0.20.0' },
      `sha256:${'3'.repeat(64)}`,
    ],
  );

  const store = new PostgresFrameworkUpdateStore(pool);
  const planned = await store.createRolloutPlan(actorId, ['hermes-alica', 'hermes-herman']);
  assert.equal(planned.state, 'planned');
  assert.deepEqual(
    planned.targets.map((target) => target.frameworkId),
    ['hermes-alica', 'hermes-herman'],
  );
  assert.ok(planned.targets.every((target) => target.targetImageDigest === digest));

  await assert.rejects(
    pool.query(
      `UPDATE framework_rollout_targets SET target_image_digest=$1 WHERE plan_id=$2 AND framework_id='hermes-alica'`,
      [`sha256:${'4'.repeat(64)}`, planned.planId],
    ),
    /identity is immutable/,
  );

  await pool.query(
    `UPDATE framework_deployments SET image_digest=$1 WHERE framework_id='hermes-alica'`,
    [`sha256:${'6'.repeat(64)}`],
  );
  await assert.rejects(store.dryRunRollout(planned.planId), /Dry-run preconditions failed/);
  await pool.query(
    `UPDATE framework_deployments SET image_digest=$1 WHERE framework_id='hermes-alica'`,
    [previousDigest],
  );

  const dryRun = await store.dryRunRollout(planned.planId);
  assert.equal(dryRun.state, 'dry_run_passed');
  assert.ok(dryRun.targets.every((target) => target.state === 'dry_run_passed'));
  const approved = await store.approveRollout(planned.planId, actorId);
  assert.equal(approved.state, 'approved');
  const queued = await store.queueRollout(planned.planId);
  assert.equal(queued.state, 'queued');
  assert.deepEqual(
    queued.targets.map((target) => [target.frameworkId, target.state]),
    [
      ['hermes-alica', 'pending'],
      ['hermes-herman', 'awaiting_promotion'],
    ],
  );
  await assert.rejects(
    store.createRolloutPlan(actorId, ['hermes-alica']),
    /active rollout plan already exists/i,
  );

  const events = await pool.query(
    `SELECT state FROM framework_rollout_events WHERE plan_id=$1 ORDER BY event_id`,
    [planned.planId],
  );
  assert.deepEqual(
    events.rows.map((row) => row.state),
    ['planned', 'dry_run_passed', 'approved', 'queued'],
  );
  process.stdout.write(
    JSON.stringify({
      ok: true,
      planId: planned.planId,
      state: queued.state,
      targets: queued.targets.length,
    }) + '\n',
  );
} finally {
  await pool.end();
}
