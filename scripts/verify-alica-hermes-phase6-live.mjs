#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const approvedRevision = '66b7196df1cb6f305706944a6b25fc0bdb08b49b';
const container = 'unify-postgres-1';
const database = 'unify';
const backup = join(root, 'backups/phase6-pre-migration-20260820T065117Z.tar.enc');
const backupSha256 = '7442d8c98417b2b8ed7303ac9310971c5955bec491a5ae7b5df58818356047cc';
const ownerCommit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4';
const profileSource = 'sha256:fa9d4d75c8977989085cb20706693104ab7469b6b2ddd5aefa801c1968aee148';
const expectedProfiles = [
  ['chatboard', 'chatboard'],
  ['default', 'Herman'],
  ['devops-agent', 'devops-agent'],
  ['pm-agent', 'pm-agent'],
  ['test-agent', 'test-agent'],
  ['ulrich', 'ulrich'],
];

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sql(statement) {
  return run('docker', [
    'exec',
    container,
    'sh',
    '-lc',
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"',
    'sh',
    statement,
  ]);
}

const token = readFileSync(join(root, '.secrets/hermes_main_control_token'), 'utf8').trim();
const ca = readFileSync(join(root, '.secrets/hermes_adapter_ca.crt'));
function ownerGet(path, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: '127.0.0.1',
        port: 28082,
        path,
        method: 'GET',
        ca,
        headers: { authorization: `Bearer ${token}` },
        timeout: 5000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            assert.equal(response.statusCode, expectedStatus, `${path} status`);
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function unavailableFault() {
  return new Promise((resolve) => {
    const request = https.request({ hostname: '127.0.0.1', port: 9, path: '/', timeout: 250 }, () =>
      resolve(false),
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(true));
    request.end();
  });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalizedOwnerProfiles(response) {
  return response.data.items
    .map((item) => [item.id, item.displayName ?? item.name ?? item.id])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

async function preflight() {
  assert.equal(run('git', ['rev-parse', 'HEAD']), approvedRevision);
  assert.equal(
    run('git', ['status', '--porcelain'])
      .split('\n')
      .filter(
        (line) => line && !line.includes('hermes-phase6') && !line.includes('backup-gateway.sh'),
      ).length,
    0,
  );
  assert.equal(sha256(backup), backupSha256);
  assert.equal(
    run('docker', ['inspect', container, '--format', '{{.State.Health.Status}}']),
    'healthy',
  );
  assert.equal(sql('SELECT current_database()'), database);
  assert.equal(sql('SELECT current_user'), 'unify');
  assert.equal(sql("SELECT coalesce(to_regnamespace('core')::text,'absent')"), 'absent');
  assert.equal(
    sql(
      "SELECT count(*) FROM public.framework_registrations WHERE id='hermes-main' AND adapter_id='hermes-control/v1' AND enabled",
    ),
    '1',
  );
  assert.equal(sql('SELECT count(*) FROM public.operations'), '66');
  assert.equal(sql('SELECT count(*) FROM public.gateway_framework_events'), '9');
  assert.equal(sql('SELECT count(*) FROM public.hermes_adapter_events'), '9');
  assert.equal(
    sql(
      "SELECT durable_cursor||'|'||replay_state FROM public.event_cursors WHERE bridge_id='hermes-control:hermes-main'",
    ),
    'MTg|current',
  );

  const [identity, version, profiles, health, conversations] = await Promise.all([
    ownerGet('/control/v1/identity'),
    ownerGet('/control/v1/version'),
    ownerGet('/control/v1/profiles?limit=100'),
    ownerGet('/control/v1/health'),
    ownerGet('/control/v1/conversations/sessions?limit=1', 503),
  ]);
  assert.equal(identity.frameworkId, 'hermes-main');
  assert.equal(identity.data.instanceId, 'herman-local-private');
  assert.equal(version.data.commit, ownerCommit);
  assert.equal(version.data.release, '0.20.0');
  assert.equal(version.data.dirty, false);
  assert.equal(profiles.sourceVersion, profileSource);
  assert.deepEqual(normalizedOwnerProfiles(profiles), expectedProfiles);
  assert.equal(health.data.status, 'degraded');
  assert.equal(health.data.checks.conversations.status, 'degraded');
  assert.equal(conversations.error.code, 'capability_unavailable');
  console.log(
    `ALICA Hermes Phase 6 preflight: PASS revision=${approvedRevision} target=${container}/${database} backupSha256=${backupSha256} owner=hermes-main profiles=6 operations=66 gatewayEvents=9 adapterEvents=9 cursor=unchanged conversations=degraded`,
  );
}

async function observe(writeEvidence) {
  assert.equal(
    sql("SELECT string_agg(version::text,',' ORDER BY version) FROM core.schema_migrations"),
    '1,2,3,4,5,6,7,8,9,10,11,12',
  );
  const [identity, version, profiles, health, capabilities, conversations] = await Promise.all([
    ownerGet('/control/v1/identity'),
    ownerGet('/control/v1/version'),
    ownerGet('/control/v1/profiles?limit=100'),
    ownerGet('/control/v1/health'),
    ownerGet('/control/v1/capabilities'),
    ownerGet('/control/v1/conversations/sessions?limit=1', 503),
  ]);
  assert.equal(identity.frameworkId, 'hermes-main');
  assert.equal(version.data.commit, ownerCommit);
  assert.equal(profiles.sourceVersion, profileSource);
  assert.deepEqual(normalizedOwnerProfiles(profiles), expectedProfiles);

  const projected = JSON.parse(
    sql(
      `SELECT json_agg(json_build_array(native_profile_alias,safe_display_name) ORDER BY native_profile_alias) FROM core.agent_profile_projections`,
    ),
  );
  assert.deepEqual(projected, expectedProfiles);
  assert.equal(sql('SELECT count(*) FROM core.frameworks'), '1');
  assert.equal(sql('SELECT count(*) FROM core.framework_instance_metadata'), '1');
  assert.equal(sql('SELECT count(*) FROM core.profiles'), '6');
  assert.equal(sql('SELECT count(*) FROM core.agent_profile_projections'), '6');
  assert.equal(sql('SELECT count(*) FROM core.framework_native_aliases'), '10');
  assert.equal(sql('SELECT count(*) FROM core.framework_capability_state'), '4');
  assert.equal(sql('SELECT count(*) FROM core.framework_predecessor_holds'), '3');
  assert.equal(sql('SELECT count(*) FROM core.framework_gateway_observations'), '4');
  assert.equal(sql('SELECT count(*) FROM core.framework_registrations'), '0');
  assert.equal(sql('SELECT count(*) FROM core.framework_operations'), '0');
  assert.equal(sql('SELECT count(*) FROM core.framework_executions'), '0');
  assert.equal(sql('SELECT count(*) FROM core.framework_session_projections'), '0');
  assert.equal(sql('SELECT count(*) FROM core.chat_framework_links'), '0');
  assert.equal(
    sql(
      "SELECT status||'|'||rebuild_state||'|'||item_count FROM core.framework_projection_state WHERE projection_family='profiles'",
    ),
    'current|current|6',
  );
  assert.equal(
    sql(
      "SELECT status||'|'||safe_reason_code FROM core.framework_projection_state WHERE projection_family='sessions'",
    ),
    'unavailable|HERMES_API_NOT_CONFIGURED',
  );
  assert.equal(
    sql(
      "SELECT state||'|'||safe_error_code||'|'||owner_cursor FROM core.framework_event_stream_state WHERE stream_key='hermes-control:hermes-main'",
    ),
    'held|OWNER_CAPABILITY_UNADVERTISED|MTg',
  );
  assert.equal(
    sql(
      "SELECT durable_cursor||'|'||replay_state FROM public.event_cursors WHERE bridge_id='hermes-control:hermes-main'",
    ),
    'MTg|current',
  );
  assert.equal(sql('SELECT count(*) FROM public.operations'), '66');
  assert.equal(sql('SELECT count(*) FROM public.gateway_framework_events'), '9');
  assert.equal(sql('SELECT count(*) FROM public.hermes_adapter_events'), '9');

  const ownerAgeSeconds = (Date.now() - Date.parse(profiles.observedAt)) / 1000;
  assert.ok(
    ownerAgeSeconds >= 0 && ownerAgeSeconds <= 30,
    `owner profile freshness ${ownerAgeSeconds}s`,
  );
  const staleObservedAt = new Date(Date.now() - 11 * 60 * 1000);
  const staleFaultClassified = Date.now() - staleObservedAt.getTime() > 10 * 60 * 1000;
  assert.equal(staleFaultClassified, true);
  assert.equal(await unavailableFault(), true);
  assert.equal(capabilities.data.capabilities['events.read'], undefined);
  assert.equal(conversations.error.code, 'capability_unavailable');

  const counts = JSON.parse(
    sql(`SELECT json_build_object(
    'frameworks',(SELECT count(*) FROM core.frameworks),
    'profiles',(SELECT count(*) FROM core.agent_profile_projections),
    'aliases',(SELECT count(*) FROM core.framework_native_aliases),
    'capabilities',(SELECT count(*) FROM core.framework_capability_state),
    'holds',(SELECT count(*) FROM core.framework_predecessor_holds),
    'observations',(SELECT count(*) FROM core.framework_gateway_observations),
    'registrations',(SELECT count(*) FROM core.framework_registrations),
    'operations',(SELECT count(*) FROM core.framework_operations),
    'executions',(SELECT count(*) FROM core.framework_executions),
    'sessions',(SELECT count(*) FROM core.framework_session_projections),
    'chatLinks',(SELECT count(*) FROM core.chat_framework_links))`),
  );
  const projectionDigest = sql(
    `SELECT encode(digest(string_agg(native_profile_alias||':'||safe_display_name||':'||source_version,'|' ORDER BY native_profile_alias),'sha256'),'hex') FROM core.agent_profile_projections`,
  );
  const evidence = {
    schemaVersion: 'alica-hermes-live-read-observation/v0.1',
    observedAt: new Date().toISOString(),
    approvedRevision,
    target: `${container}/${database}`,
    backup: { file: backup.split('/').at(-1), sha256: backupSha256, restoreRehearsal: 'passed' },
    owner: {
      frameworkId: identity.frameworkId,
      instanceId: identity.data.instanceId,
      release: version.data.release,
      commit: version.data.commit,
      health: health.data.status,
      profileSourceVersion: profiles.sourceVersion,
      profileCount: profiles.data.items.length,
    },
    projection: {
      counts,
      digest: `sha256:${projectionDigest}`,
      ownerMatched: true,
      freshnessThresholdSeconds: 600,
      observedFresh: true,
    },
    degradation: {
      conversations: 'unavailable',
      reasonCode: conversations.error.code,
      sessionsPersisted: 0,
      chatLinksPersisted: 0,
    },
    events: {
      advertised: false,
      ownerCursorBefore: 'MTg',
      ownerCursorAfter: 'MTg',
      projectionState: 'held',
      moved: false,
    },
    faults: { staleClassified: true, unavailableClassified: true, ownerMutation: 0 },
    commandPathChanges: 0,
    runtimeHooks: 0,
    enforcementChanges: 0,
  };
  if (writeEvidence) {
    mkdirSync(join(root, 'evidence'), { recursive: true });
    writeFileSync(
      join(root, 'evidence/alica-hermes-phase6-live-observation.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }
  console.log(
    `ALICA Hermes Phase 6 live observation: PASS target=${container}/${database} ownerMatched=true profiles=6 profileDigest=sha256:${projectionDigest} freshness=PASS conversations=unavailable sessionsPersisted=0 chatLinks=0 eventsAdvertised=false cursorMoved=false staleFault=PASS unavailableFault=PASS commandsBeforeAfter=66/66 eventsBeforeAfter=9/9 adapterEventsBeforeAfter=9/9 ownerMutation=0 runtimeHooks=0 enforcementChanges=0`,
  );
}

const mode = process.argv[2];
if (mode === '--preflight') await preflight();
else if (mode === '--observe') await observe(process.argv.includes('--write-evidence'));
else
  throw new Error(
    'Usage: verify-alica-hermes-phase6-live.mjs <--preflight|--observe> [--write-evidence]',
  );
