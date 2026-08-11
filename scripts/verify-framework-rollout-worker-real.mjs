#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'unify-rollout-real-'));
const root = join(fixture, 'installation');
const current = join(root, 'current');
const composeDir = join(current, 'deploy/five-service');
mkdirSync(composeDir, { recursive: true });
const suffix = `${process.pid}-${Date.now()}`;
const project = `unify-rollout-real-${suffix}`;
const postgres = `${project}-postgres`;
const imageContainer = `${project}-image`;
const registryContainer = `${project}-registry`;
let ownsRegistry = false;
const registry = process.env.FRAMEWORK_ROLLOUT_TEST_REGISTRY ?? 'localhost:5000/unify/rollout-real';
const oldTag = `${registry}:old-${suffix}`;
const goodTag = `${registry}:good-${suffix}`;
const promotedTag = `${registry}:promoted-${suffix}`;
const badTag = `${registry}:bad-${suffix}`;
const oldCommit = '1111111111111111111111111111111111111111';
const goodCommit = '2222222222222222222222222222222222222222';
const promotedCommit = '4444444444444444444444444444444444444444';
const badCommit = '3333333333333333333333333333333333333333';
const planGood = '11111111-1111-4111-8111-111111111111';
const planPromotion = '33333333-3333-4333-8333-333333333333';
const planRollback = '44444444-4444-4444-8444-444444444444';
const planBad = '22222222-2222-4222-8222-222222222222';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repo,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 300_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}${result.stderr}`,
    );
  return result.stdout.trim();
}
const docker = (args, options) => run('docker', args, options);
const sql = (text) =>
  docker(
    [
      'exec',
      '-i',
      postgres,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'unify',
      '-d',
      'unify',
    ],
    {
      input: text,
    },
  );

function commitImage(tag, release, commit, healthy) {
  spawnSync('docker', ['rm', '-f', imageContainer], { encoding: 'utf8' });
  docker(['create', '--name', imageContainer, 'alpine:3.21', 'sleep', 'infinity']);
  docker([
    'commit',
    '--change',
    `LABEL com.aquiero.hermes.release=${release}`,
    '--change',
    `LABEL com.aquiero.hermes.commit=${commit}`,
    '--change',
    `HEALTHCHECK --interval=1s --timeout=1s --retries=2 CMD /bin/${healthy ? 'true' : 'false'}`,
    imageContainer,
    tag,
  ]);
  docker(['rm', '-f', imageContainer]);
  docker(['push', tag], { timeout: 300_000 });
  const references = JSON.parse(
    docker(['image', 'inspect', tag, '--format', '{{json .RepoDigests}}']),
  );
  const reference = references.find((item) => item.startsWith(`${registry}@`));
  assert.ok(reference, `No immutable registry reference found for ${tag}`);
  return { reference, digest: reference.slice(reference.indexOf('@') + 1) };
}

function seedPlan({ planId, candidateChar, assessmentChar, target, previous, commit }) {
  const candidateId = `fuc_${candidateChar.repeat(64)}`;
  const assessmentId = `fca_${assessmentChar.repeat(64)}`;
  sql(`
INSERT INTO framework_update_candidates(candidate_id,source_id,tag_name,release_name,commit_sha,release_url,release_notes,published_at,prerelease,draft)
VALUES('${candidateId}','fixture-source','v-${candidateChar}','fixture-${candidateChar}','${commit}','https://github.com/NousResearch/hermes-agent/releases/tag/v-${candidateChar}','',now(),false,false);
INSERT INTO framework_candidate_assessments(assessment_id,candidate_id,state,source_commit,source_archive_digest,image_reference,image_digest,adapter_release,contract_version,contract_passed,acceptance_passed,evidence,evidence_digest,assessed_at)
VALUES('${assessmentId}','${candidateId}','ready','${commit}','sha256:${candidateChar.repeat(64)}','${target.reference}','${target.digest}','fixture','hermes-control/v1',true,true,'{"release":"0.20.0"}','sha256:${assessmentChar.repeat(64)}',now());
INSERT INTO framework_rollout_plans(plan_id,candidate_id,assessment_id,state,created_by,approved_by,dry_run_at,approved_at,execution_requested_at)
VALUES('${planId}','${candidateId}','${assessmentId}','queued','${actor}','${actor}',now(),now(),now());
INSERT INTO framework_rollout_targets(plan_id,framework_id,ordinal,state,previous_release_id,previous_image_reference,previous_image_digest,previous_framework_version,previous_framework_commit,target_release_id,target_image_reference,target_image_digest,target_framework_version,target_framework_commit,progress,dry_run_checks)
VALUES('${planId}','hermes-alica',1,'pending','previous','${previous.reference}','${previous.digest}','0.20.0','${previous.commit}','candidate','${target.reference}','${target.digest}','0.20.0','${commit}',35,'{"candidateReady":true,"deploymentUnchanged":true}');
INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message) VALUES('${planId}','queued',35,'Fixture queued');
`);
}

function seedPromotionPlan({ target, alicaPrevious, hermanPrevious }) {
  const candidateId = `fuc_${'8'.repeat(64)}`;
  const assessmentId = `fca_${'9'.repeat(64)}`;
  sql(`
INSERT INTO framework_update_candidates(candidate_id,source_id,tag_name,release_name,commit_sha,release_url,release_notes,published_at,prerelease,draft)
VALUES('${candidateId}','fixture-source','v-promoted','fixture-promoted','${promotedCommit}','https://github.com/NousResearch/hermes-agent/releases/tag/v-promoted','',now(),false,false);
INSERT INTO framework_candidate_assessments(assessment_id,candidate_id,state,source_commit,source_archive_digest,image_reference,image_digest,adapter_release,contract_version,contract_passed,acceptance_passed,evidence,evidence_digest,assessed_at)
VALUES('${assessmentId}','${candidateId}','ready','${promotedCommit}','sha256:${'8'.repeat(64)}','${target.reference}','${target.digest}','fixture','hermes-control/v1',true,true,'{"release":"0.21.0"}','sha256:${'9'.repeat(64)}',now());
INSERT INTO framework_rollout_plans(plan_id,candidate_id,assessment_id,state,created_by,approved_by,dry_run_at,approved_at,execution_requested_at,operation_kind,policy_snapshot)
VALUES('${planPromotion}','${candidateId}','${assessmentId}','queued','${actor}','${actor}',now(),now(),now(),'release','{"canaryFrameworkId":"hermes-alica","observationWindowSeconds":1,"requiredHealthySamples":2,"manualPromotionRequired":true}');
INSERT INTO framework_rollout_targets(plan_id,framework_id,ordinal,state,previous_release_id,previous_image_reference,previous_image_digest,previous_framework_version,previous_framework_commit,target_release_id,target_image_reference,target_image_digest,target_framework_version,target_framework_commit,progress,dry_run_checks)
VALUES
('${planPromotion}','hermes-alica',1,'pending','good','${alicaPrevious.reference}','${alicaPrevious.digest}','0.20.0','${alicaPrevious.commit}','promoted','${target.reference}','${target.digest}','0.21.0','${promotedCommit}',35,'{"candidateReady":true,"deploymentUnchanged":true}'),
('${planPromotion}','hermes-herman',2,'awaiting_promotion','old','${hermanPrevious.reference}','${hermanPrevious.digest}','0.20.0','${hermanPrevious.commit}','promoted','${target.reference}','${target.digest}','0.21.0','${promotedCommit}',30,'{"candidateReady":true,"deploymentUnchanged":true}');
INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message) VALUES('${planPromotion}','queued',35,'Promotion fixture queued');
`);
}

function seedRollbackPlan({ target, alicaPrevious, hermanPrevious }) {
  sql(`
INSERT INTO framework_rollout_plans(plan_id,candidate_id,assessment_id,state,created_by,approved_by,approved_at,execution_requested_at,operation_kind,source_plan_id,policy_snapshot,rollback_reason)
SELECT '${planRollback}',candidate_id,assessment_id,'queued','${actor}','${actor}',now(),now(),'rollback',plan_id,policy_snapshot,'Real verifier one-click rollback'
FROM framework_rollout_plans WHERE plan_id='${planPromotion}';
INSERT INTO framework_rollout_targets(plan_id,framework_id,ordinal,state,previous_release_id,previous_image_reference,previous_image_digest,previous_framework_version,previous_framework_commit,target_release_id,target_image_reference,target_image_digest,target_framework_version,target_framework_commit,progress,dry_run_checks)
VALUES
('${planRollback}','hermes-alica',1,'pending','promoted','${target.reference}','${target.digest}','0.21.0','${promotedCommit}','good','${alicaPrevious.reference}','${alicaPrevious.digest}','0.20.0','${alicaPrevious.commit}',35,'{"oneClickRollback":true,"deploymentUnchanged":true}'),
('${planRollback}','hermes-herman',2,'pending','promoted','${target.reference}','${target.digest}','0.21.0','${promotedCommit}','old','${hermanPrevious.reference}','${hermanPrevious.digest}','0.20.0','${hermanPrevious.commit}',35,'{"oneClickRollback":true,"deploymentUnchanged":true}');
INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message,details)
VALUES('${planRollback}','queued',35,'Governed one-click rollback queued','{"reason":"Real verifier one-click rollback"}');
`);
}

function worker() {
  run('bash', ['scripts/framework-rollout-worker.sh', '--once'], {
    cwd: repo,
    env: {
      UNIFY_INSTALLATION_ROOT: root,
      UNIFY_COMPOSE_PROJECT: project,
      UNIFY_POSTGRES_CONTAINER: postgres,
      UNIFY_ROLLOUT_LOCK: join(fixture, 'worker.lock'),
      UNIFY_ROLLOUT_CONVERGENCE_ATTEMPTS: '15',
      UNIFY_ROLLOUT_CONVERGENCE_INTERVAL_SECONDS: '1',
    },
    timeout: 120_000,
  });
}

try {
  if (
    !process.env.FRAMEWORK_ROLLOUT_TEST_REGISTRY &&
    spawnSync('curl', ['-fsS', 'http://localhost:5000/v2/']).status !== 0
  ) {
    docker(['run', '-d', '--name', registryContainer, '-p', '127.0.0.1:5000:5000', 'registry:2']);
    ownsRegistry = true;
  }
  docker(['pull', 'alpine:3.21']);
  const old = { ...commitImage(oldTag, '0.20.0', oldCommit, true), commit: oldCommit };
  const good = { ...commitImage(goodTag, '0.20.0', goodCommit, true), commit: goodCommit };
  const promoted = {
    ...commitImage(promotedTag, '0.21.0', promotedCommit, true),
    commit: promotedCommit,
  };
  const bad = { ...commitImage(badTag, '0.20.0', badCommit, false), commit: badCommit };

  writeFileSync(
    join(current, 'compose.env'),
    `ALICA_HERMES_RUNTIME_IMAGE=${old.reference}\nHERMAN_HERMES_RUNTIME_IMAGE=${old.reference}\n`,
    { mode: 0o640 },
  );
  writeFileSync(
    join(composeDir, 'compose.yaml'),
    `services:\n  alica:\n    image: \${ALICA_HERMES_RUNTIME_IMAGE}\n    command: ["sleep", "infinity"]\n  herman:\n    image: \${HERMAN_HERMES_RUNTIME_IMAGE}\n    command: ["sleep", "infinity"]\n`,
  );
  docker([
    'run',
    '-d',
    '--name',
    postgres,
    '-e',
    'POSTGRES_PASSWORD=test',
    '-e',
    'POSTGRES_USER=unify',
    '-e',
    'POSTGRES_DB=unify',
    '-p',
    '127.0.0.1::5432',
    'postgres:16.6-alpine',
  ]);
  for (let index = 0; index < 30; index += 1) {
    if (
      spawnSync('docker', ['exec', postgres, 'pg_isready', '-U', 'unify', '-d', 'unify']).status ===
      0
    )
      break;
    run('sleep', ['1']);
  }
  const port = docker([
    'inspect',
    postgres,
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
  ]);
  run('sleep', ['2']);
  run(process.execPath, ['apps/gateway/scripts/migrate.mjs', 'up'], {
    env: { DATABASE_URL: `postgres://unify:test@127.0.0.1:${port}/unify` },
  });
  sql(`
INSERT INTO users(id,username,display_name,password_hash) VALUES('${actor}','fixture-admin','Fixture Admin','test');
INSERT INTO framework_registrations(id,display_name,adapter_id,base_url,secret_reference,scopes,contract_version,framework_version,framework_commit,status)
VALUES('hermes-alica','Alica','hermes-control/v1','http://127.0.0.1','env:FIXTURE',ARRAY['control:read'],'hermes-control/v1','0.20.0','b8b17b8cee50b85adb7fba6ea332dc06731b86f4','verified'),
('hermes-herman','Herman','hermes-control/v1','http://127.0.0.1','env:FIXTURE',ARRAY['control:read'],'hermes-control/v1','0.20.0','b8b17b8cee50b85adb7fba6ea332dc06731b86f4','verified');
INSERT INTO framework_deployments(framework_id,release_id,image_reference,image_digest,framework_version,framework_commit)
VALUES('hermes-alica','old','${old.reference}','${old.digest}','0.20.0','${oldCommit}'),('hermes-herman','old','${old.reference}','${old.digest}','0.20.0','${oldCommit}');
INSERT INTO framework_update_sources(source_id,repository,trusted,last_checked_at,last_success_at) VALUES('fixture-source','NousResearch/hermes-agent',true,now(),now());
`);
  docker([
    'compose',
    '--project-name',
    project,
    '--env-file',
    join(current, 'compose.env'),
    '-f',
    join(composeDir, 'compose.yaml'),
    'up',
    '-d',
  ]);
  const hermanBefore = docker([
    'compose',
    '--project-name',
    project,
    '--env-file',
    join(current, 'compose.env'),
    '-f',
    join(composeDir, 'compose.yaml'),
    'ps',
    '-q',
    'herman',
  ]);
  const hermanImageBefore = docker(['inspect', hermanBefore, '--format', '{{.Image}}']);

  seedPlan({
    planId: planGood,
    candidateChar: '4',
    assessmentChar: '5',
    target: good,
    previous: old,
    commit: goodCommit,
  });
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planGood}';`),
    'succeeded',
  );
  assert.equal(
    sql(`SELECT state FROM framework_rollout_targets WHERE plan_id='${planGood}';`),
    'converged',
  );
  assert.equal(
    sql(`SELECT image_digest FROM framework_deployments WHERE framework_id='hermes-alica';`),
    good.digest,
  );
  assert.match(
    readFileSync(join(current, 'compose.env'), 'utf8'),
    new RegExp(`ALICA_HERMES_RUNTIME_IMAGE=${good.reference}`),
  );
  const hermanAfter = docker([
    'compose',
    '--project-name',
    project,
    '--env-file',
    join(current, 'compose.env'),
    '-f',
    join(composeDir, 'compose.yaml'),
    'ps',
    '-q',
    'herman',
  ]);
  assert.equal(docker(['inspect', hermanAfter, '--format', '{{.Image}}']), hermanImageBefore);

  seedPlan({
    planId: planBad,
    candidateChar: '6',
    assessmentChar: '7',
    target: bad,
    previous: good,
    commit: badCommit,
  });
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planBad}';`),
    'failed',
  );
  assert.equal(
    sql(
      `SELECT convergence_checks->>'rolledBack' FROM framework_rollout_targets WHERE plan_id='${planBad}';`,
    ),
    'true',
  );
  assert.equal(
    sql(`SELECT image_digest FROM framework_deployments WHERE framework_id='hermes-alica';`),
    good.digest,
  );
  assert.match(
    readFileSync(join(current, 'compose.env'), 'utf8'),
    new RegExp(`ALICA_HERMES_RUNTIME_IMAGE=${good.reference}`),
  );
  seedPromotionPlan({ target: promoted, alicaPrevious: good, hermanPrevious: old });
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planPromotion}';`),
    'observing',
  );
  assert.equal(
    sql(
      `SELECT state FROM framework_rollout_targets WHERE plan_id='${planPromotion}' AND framework_id='hermes-herman';`,
    ),
    'awaiting_promotion',
  );
  assert.equal(
    sql(`SELECT image_digest FROM framework_deployments WHERE framework_id='hermes-herman';`),
    old.digest,
  );
  worker();
  run('sleep', ['2']);
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planPromotion}';`),
    'awaiting_promotion',
  );
  assert.equal(
    sql(`SELECT count(*) FROM framework_rollout_observations WHERE plan_id='${planPromotion}';`),
    '2',
  );
  sql(`
UPDATE framework_rollout_plans SET state='queued',promoted_by='${actor}',promoted_at=now()
WHERE plan_id='${planPromotion}' AND state='awaiting_promotion';
UPDATE framework_rollout_targets SET state='pending',progress=70
WHERE plan_id='${planPromotion}' AND state='awaiting_promotion';
INSERT INTO framework_rollout_events(plan_id,state,progress,safe_message,details)
VALUES('${planPromotion}','queued',70,'Canary evidence approved; second instance queued for promotion','{"promotedBy":"${actor}"}');
`);
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planPromotion}';`),
    'succeeded',
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM framework_deployments WHERE image_digest='${promoted.digest}' AND framework_id IN ('hermes-alica','hermes-herman');`,
    ),
    '2',
  );

  seedRollbackPlan({ target: promoted, alicaPrevious: good, hermanPrevious: old });
  worker();
  worker();
  assert.equal(
    sql(`SELECT state FROM framework_rollout_plans WHERE plan_id='${planRollback}';`),
    'succeeded',
  );
  assert.equal(
    sql(`SELECT image_digest FROM framework_deployments WHERE framework_id='hermes-alica';`),
    good.digest,
  );
  assert.equal(
    sql(`SELECT image_digest FROM framework_deployments WHERE framework_id='hermes-herman';`),
    old.digest,
  );
  assert.equal(
    sql(
      `SELECT operation_kind||':'||rollback_reason FROM framework_rollout_plans WHERE plan_id='${planRollback}';`,
    ),
    'rollback:Real verifier one-click rollback',
  );
  process.stdout.write(
    JSON.stringify({
      ok: true,
      independentTarget: true,
      converged: true,
      rollbackVerified: true,
      observationWindowVerified: true,
      manualPromotionVerified: true,
      oneClickGovernedRollbackVerified: true,
      completeEvidencePersisted: true,
    }) + '\n',
  );
} finally {
  spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--env-file',
      join(current, 'compose.env'),
      '-f',
      join(composeDir, 'compose.yaml'),
      'down',
      '--remove-orphans',
    ],
    { encoding: 'utf8' },
  );
  spawnSync('docker', ['rm', '-f', postgres, imageContainer], { encoding: 'utf8' });
  if (ownsRegistry) spawnSync('docker', ['rm', '-f', registryContainer], { encoding: 'utf8' });
  for (const tag of [oldTag, goodTag, promotedTag, badTag])
    spawnSync('docker', ['image', 'rm', '-f', tag], { encoding: 'utf8' });
  rmSync(fixture, { recursive: true, force: true });
}
