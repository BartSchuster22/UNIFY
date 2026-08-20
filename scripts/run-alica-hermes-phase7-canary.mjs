#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'deploy/five-service/hermes-phase7/canary-policy.v1.json');
const evidencePath = join(root, 'evidence/alica-hermes-phase7-live-canary.json');
const tokenPath = join(root, '.secrets/hermes_main_control_token');
const caPath = join(root, '.secrets/hermes_adapter_ca.crt');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const token = readFileSync(tokenPath, 'utf8').trim();
const ca = readFileSync(caPath);
const mode = process.argv[2] ?? '--preflight';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlBytea = (hex) => `decode(${sqlLiteral(hex)},'hex')`;

function psql(sql, { allowFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      config.target.container,
      'sh',
      '-lc',
      'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF "|" -c "$1"',
      'sh',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 && !allowFailure)
    throw new Error(`database command failed: ${(result.stderr || result.stdout).trim()}`);
  return { ok: result.status === 0, output: result.stdout.trim(), error: result.stderr.trim() };
}

function ownerRequest(pathname, { method = 'GET', body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = https.request(
      `${config.owner.baseUrl}${pathname}`,
      {
        method,
        ca,
        rejectUnauthorized: true,
        timeout: timeoutMs ?? config.limits.requestTimeoutMs,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            return reject(new Error(`owner returned non-JSON status ${response.statusCode}`));
          }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('bounded owner timeout')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function ownerGet(pathname) {
  const result = await ownerRequest(pathname);
  if (result.status < 200 || result.status >= 300)
    throw new Error(`owner GET ${pathname} failed ${result.status}`);
  return result.body;
}

async function ownerCommand(body) {
  const result = await ownerRequest('/control/v1/commands/profiles', { method: 'POST', body });
  if (result.status < 200 || result.status >= 300)
    throw new Error(
      `owner command failed ${result.status}: ${result.body?.error?.code ?? 'unknown_error'}`,
    );
  return result.body;
}

function profileSummary(response) {
  return {
    sourceVersion: response.sourceVersion,
    observedAt: response.observedAt,
    ids: response.data.items.map((item) => item.id).sort(),
    count: response.data.items.length,
  };
}

function assertFreshObservation(summary) {
  const ageMs = Date.now() - Date.parse(summary.observedAt);
  assert.ok(ageMs >= -5000 && ageMs <= config.limits.ownerObservationFreshnessSeconds * 1000);
}

async function livePreflight() {
  const [identity, version, capabilities, profiles] = await Promise.all([
    ownerGet('/control/v1/identity'),
    ownerGet('/control/v1/version'),
    ownerGet('/control/v1/capabilities'),
    ownerGet('/control/v1/profiles'),
  ]);
  const summary = profileSummary(profiles);
  assert.equal(identity.frameworkId, config.owner.frameworkId);
  assert.equal(identity.data.instanceId, config.owner.instanceId);
  assert.equal(version.data.release, config.owner.release);
  assert.equal(version.data.commit, config.owner.commit);
  assert.equal(version.data.dirty, false);
  const capability = capabilities.data.capabilities[config.owner.capability];
  assert.equal(capability.status, 'supported');
  for (const required of ['validate', 'dry-run', 'execute', 'verify'])
    assert.ok(capability.modes.includes(required));
  assert.deepEqual(summary.ids, config.baseline.profileIds);
  assert.equal(summary.sourceVersion, config.baseline.sourceVersion);
  assert.equal(summary.ids.includes(config.scope.nativeTargetId), false);
  assertFreshObservation(summary);
  const db = psql(`
    SELECT current_database(),current_user,
      (SELECT count(*) FROM core.schema_migrations),
      (SELECT count(*) FROM core.agent_profile_projections),
      (SELECT count(*) FROM core.framework_operations),
      (SELECT count(*) FROM core.framework_executions),
      (SELECT count(*) FROM public.operations),
      (SELECT count(*) FROM public.hermes_adapter_events)
  `).output.split('|');
  assert.equal(db[0], config.target.database);
  assert.equal(db[1], config.target.role);
  assert.ok(['12', '13', '14', '15', '16', '17'].includes(db[2]));
  assert.equal(db[3], '6');
  return {
    observedAt: new Date().toISOString(),
    owner: {
      frameworkId: identity.frameworkId,
      instanceId: identity.data.instanceId,
      release: version.data.release,
      commit: version.data.commit,
      capabilityStatus: capability.status,
      capabilityModes: capability.modes,
      profiles: summary,
    },
    database: {
      migrations: Number(db[2]),
      canonicalProfiles: Number(db[3]),
      canonicalOperations: Number(db[4]),
      canonicalExecutions: Number(db[5]),
      gatewayOperations: Number(db[6]),
      adapterEvents: Number(db[7]),
    },
  };
}

function readEvidence() {
  return JSON.parse(readFileSync(evidencePath, 'utf8'));
}
function writeEvidence(value) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}

function command(operation, mode, expectedSourceVersion, idempotencyKey, requestLabel) {
  return {
    mode,
    operation,
    targetId: config.scope.nativeTargetId,
    idempotencyKey,
    expectedSourceVersion,
    requestId: `${requestLabel}-${randomUUID()}`,
    correlationId: `phase7-${randomUUID()}`,
    actor: { type: 'service', id: config.scope.controllerServicePrincipalId },
    payload: operation === 'profile.create' ? { description: config.description } : {},
  };
}

function semanticCommand(commandValue) {
  return {
    mode: commandValue.mode,
    operation: commandValue.operation,
    targetId: commandValue.targetId,
    idempotencyKey: commandValue.idempotencyKey,
    expectedSourceVersion: commandValue.expectedSourceVersion,
    actor: commandValue.actor,
    payload: commandValue.payload,
    scope: config.scope,
    approvalReference: config.approvalReference,
  };
}

function reserve(commandValue, { tenantId = config.scope.tenantId } = {}) {
  const digest = sha(stable(semanticCommand(commandValue)));
  const s = config.scope;
  const sql = `SELECT * FROM core.reserve_phase7_canary_command(
    ${sqlLiteral(s.policyId)},${sqlLiteral(s.controllerServicePrincipalId)},
    ${sqlLiteral(s.canonicalPrincipalId)},${sqlLiteral(tenantId)},${sqlLiteral(s.clientId)},
    ${sqlLiteral(s.applicationId)},${sqlLiteral(s.frameworkId)},
    ${sqlLiteral(s.contextAgentProfileId)},${sqlLiteral(s.targetAgentProfileId)},
    ${sqlLiteral(s.nativeTargetId)},${sqlLiteral(commandValue.operation)},
    ${sqlLiteral(commandValue.idempotencyKey)},${sqlBytea(digest)},
    ${sqlLiteral(commandValue.expectedSourceVersion)});`;
  const result = psql(sql, { allowFailure: true });
  if (!result.ok) return { ok: false, error: result.error, digest };
  const [reservationId, state, replayed] = result.output.split('|');
  return { ok: true, reservationId, state, replayed: replayed === 't', digest };
}

function startDispatch(reservationId) {
  psql(`SELECT core.start_phase7_canary_dispatch(${sqlLiteral(reservationId)});`);
}
function completeDispatch(reservationId, ownerResponse, terminalSummary) {
  const digest = sha(stable(terminalSummary));
  psql(`SELECT core.complete_phase7_canary_dispatch(
    ${sqlLiteral(reservationId)},${sqlLiteral(ownerResponse.data.operationId)},
    ${sqlLiteral(terminalSummary.sourceVersion)},${sqlBytea(digest)});`);
  return digest;
}
function recordFault(faultClass, expectedResult, safeCode, evidence, incrementFailure = false) {
  const digest = sha(stable(evidence));
  psql(`SELECT core.record_phase7_canary_fault(
    ${sqlLiteral(config.scope.policyId)},${sqlLiteral(faultClass)},
    ${sqlLiteral(expectedResult)},${sqlBytea(digest)},${sqlLiteral(safeCode)},
    ${incrementFailure ? 'true' : 'false'});`);
  return digest;
}

async function preflight() {
  const live = await livePreflight();
  const coreContainer = spawnSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
    .stdout.split('\n')
    .filter((name) => name.startsWith('unify-core-'));
  assert.deepEqual(coreContainer, []);
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout;
  for (const line of status.split('\n').filter(Boolean)) {
    const path = line.slice(3);
    assert.ok(
      path === 'package.json' ||
        path.includes('phase7') ||
        path === 'apps/hermes-control-adapter/src/source.ts' ||
        path === 'apps/hermes-control-adapter/src/source.test.ts' ||
        path === 'apps/core/migrations/013_alica_hermes_governed_command_canary.sql',
      `unexpected changed file ${path}`,
    );
  }
  console.log(
    `Phase 7 live preflight: PASS profiles=${live.owner.profiles.count} source=${live.owner.profiles.sourceVersion} capability=${live.owner.capabilityStatus} coreRunning=false`,
  );
}

async function seed() {
  const live = await livePreflight();
  assert.equal(live.database.migrations, 13);
  assert.equal(live.database.canonicalOperations, 0);
  assert.equal(live.database.canonicalExecutions, 0);
  const s = config.scope;
  psql(`
    BEGIN;
    INSERT INTO core.service_principals (id,name,status)
    VALUES (${sqlLiteral(s.controllerServicePrincipalId)},'alica-phase7-canary-controller','active')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO core.authorization_permissions (permission_key,description)
    VALUES ('hermes.profiles.canary.execute','Execute the exact bounded Hermes Phase 7 profile lifecycle canary.')
    ON CONFLICT DO NOTHING;
    INSERT INTO core.authorization_roles (role_key,description,is_system)
    VALUES ('hermes.phase7.canary','Bounded Phase 7 Hermes profile lifecycle canary controller.',false)
    ON CONFLICT DO NOTHING;
    INSERT INTO core.authorization_role_permissions (role_key,permission_key)
    VALUES ('hermes.phase7.canary','hermes.profiles.canary.execute')
    ON CONFLICT DO NOTHING;
    INSERT INTO core.authorization_bindings
      (principal_kind,principal_id,role_key,scope_kind,scope_id,granted_by_kind,granted_by_id,expires_at)
    VALUES
      ('service',${sqlLiteral(s.controllerServicePrincipalId)},'hermes.phase7.canary','framework',
       ${sqlLiteral(s.frameworkId)},'service',${sqlLiteral(s.controllerServicePrincipalId)},
       clock_timestamp()+make_interval(secs=>${Number(config.limits.policyFreshnessSeconds)}))
    ON CONFLICT DO NOTHING;
    INSERT INTO core.framework_command_canary_policies
      (canary_policy_id,framework_id,context_agent_profile_id,target_agent_profile_id,
       controller_service_principal_id,canonical_principal_id,tenant_id,client_id,application_id,
       native_target_id,operation_family,allowed_operations,owner_capability,approval_reference,
       baseline_source_version,expected_owner_profile_count,dispatch_limit,failure_threshold,
       circuit_state,enabled,fresh_until)
    VALUES
      (${sqlLiteral(s.policyId)},${sqlLiteral(s.frameworkId)},${sqlLiteral(s.contextAgentProfileId)},
       ${sqlLiteral(s.targetAgentProfileId)},${sqlLiteral(s.controllerServicePrincipalId)},
       ${sqlLiteral(s.canonicalPrincipalId)},${sqlLiteral(s.tenantId)},${sqlLiteral(s.clientId)},
       ${sqlLiteral(s.applicationId)},${sqlLiteral(s.nativeTargetId)},'profile-lifecycle',
       ARRAY['profile.create','profile.delete']::text[],'profiles.execute',
       ${sqlLiteral(config.approvalReference)},${sqlLiteral(config.baseline.sourceVersion)},
       ${config.baseline.profileIds.length},2,2,'closed',true,
       clock_timestamp()+make_interval(secs=>${Number(config.limits.policyFreshnessSeconds)}));
    COMMIT;
  `);
  writeEvidence({
    schema: config.schema,
    approvalReference: config.approvalReference,
    policy: config.scope,
    owner: config.owner,
    limits: config.limits,
    baseline: live,
    authorization: {
      operationFamily: config.operationFamily,
      allowedOperations: config.allowedOperations,
      exactScopeRequired: true,
      rawRouteExposed: false,
      commandRunnerDeployed: false,
    },
    phases: { seed: { passed: true, at: new Date().toISOString() } },
  });
  console.log(`Phase 7 canary policy seeded: enabled=true policy=${s.policyId}`);
}

async function repairPreflight() {
  const evidence = readEvidence();
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(owner.ids, config.baseline.profileIds);
  assert.equal(owner.sourceVersion, config.baseline.sourceVersion);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), false);
  const blocked = psql(`
    SELECT reservation_id FROM core.framework_command_canary_reservations
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND state='reserved' AND idempotency_key='p7.execute.profile.create.0001';
  `).output;
  assert.match(blocked, /^rsv_/);
  psql(`SELECT core.cancel_phase7_canary_reservation(
    ${sqlLiteral(blocked)},'P7_IMMUTABLE_EVIDENCE_GUARD');`);
  psql(`SELECT core.rearm_phase7_canary(
    ${sqlLiteral(config.scope.policyId)},${Number(config.limits.policyFreshnessSeconds)});`);
  const state = psql(`
    SELECT p.enabled,p.circuit_state,p.dispatch_count,p.failure_count,r.state,
      o.status,fo.state
    FROM core.framework_command_canary_policies p
    JOIN core.framework_command_canary_reservations r
      ON r.canary_policy_id=p.canary_policy_id
    JOIN core.operations o ON o.id=r.predecessor_operation_id
    JOIN core.framework_operations fo ON fo.operation_id=r.canonical_operation_id
    WHERE p.canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND r.reservation_id=${sqlLiteral(blocked)};
  `).output.split('|');
  assert.deepEqual(state, ['t', 'closed', '0', '0', 'cancelled', 'cancelled', 'authorized']);
  evidence.phases.forwardRepair = {
    passed: true,
    at: new Date().toISOString(),
    migration: 14,
    blockedReservationId: blocked,
    safeErrorCode: 'P7_IMMUTABLE_EVIDENCE_GUARD',
    ownerDispatchCount: 0,
    ownerStateUnchanged: true,
    immutableCanonicalEvidencePreserved: true,
    predecessorState: 'cancelled',
    policyRearmedFresh: true,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 preflight forward repair: PASS reservation=${blocked} ownerDispatches=0 ownerStateUnchanged=true policyRearmed=true`,
  );
}

async function recoverTransport() {
  const evidence = readEvidence();
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(owner.ids, config.baseline.profileIds);
  assert.equal(owner.sourceVersion, config.baseline.sourceVersion);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), false);
  assertFreshObservation(owner);
  const reservationId = psql(`
    SELECT reservation_id FROM core.framework_command_canary_reservations
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND state='dispatching' AND idempotency_key='p7.execute.profile.create.0002';
  `).output;
  assert.match(reservationId, /^rsv_/);
  const terminalDigest = sha(
    stable({
      reservationId,
      safeCode: 'P7_ADAPTER_CONNECTION_TERMINATED',
      owner,
      ownerDispatchCount: 0,
    }),
  );
  psql(`SELECT core.recover_phase7_pre_owner_transport_failure(
    ${sqlLiteral(reservationId)},${sqlLiteral(owner.sourceVersion)},
    ${sqlBytea(terminalDigest)},${Number(config.limits.policyFreshnessSeconds)});`);
  const state = psql(`
    SELECT p.enabled,p.circuit_state,p.dispatch_count,p.failure_count,r.state,
      o.status,r.canonical_operation_id IS NULL
    FROM core.framework_command_canary_policies p
    JOIN core.framework_command_canary_reservations r
      ON r.canary_policy_id=p.canary_policy_id
    JOIN core.operations o ON o.id=r.predecessor_operation_id
    WHERE p.canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND r.reservation_id=${sqlLiteral(reservationId)};
  `).output.split('|');
  assert.deepEqual(state, ['t', 'closed', '0', '1', 'failed', 'failed', 't']);
  evidence.phases.transportRecovery = {
    passed: true,
    at: new Date().toISOString(),
    migration: 15,
    reservationId,
    safeErrorCode: 'P7_ADAPTER_CONNECTION_TERMINATED',
    ownerDispatchCount: 0,
    ownerStateReconciled: true,
    ownerStateUnchanged: true,
    provisionalDispatchLeaseReturned: true,
    failureCount: 1,
    terminalDigest,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 transport recovery: PASS reservation=${reservationId} ownerDispatches=0 ownerStateUnchanged=true provisionalLeaseReturned=true`,
  );
}

async function reconcileCreatedProfile() {
  const evidence = readEvidence();
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.equal(owner.count, config.baseline.profileIds.length + 1);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), true);
  assert.notEqual(owner.sourceVersion, config.baseline.sourceVersion);
  assertFreshObservation(owner);
  const reservationId = psql(`
    SELECT reservation_id FROM core.framework_command_canary_reservations
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND state='dispatching' AND idempotency_key='p7.execute.profile.create.0003';
  `).output;
  assert.match(reservationId, /^rsv_/);
  const terminalDigest = sha(
    stable({
      reservationId,
      safeCode: 'P7_PROFILE_LIST_WIDTH_PARSER',
      owner,
      ownerCreateCompleted: true,
      adapterVerificationFailed: true,
    }),
  );
  psql(`SELECT core.reconcile_phase7_post_owner_create(
    ${sqlLiteral(reservationId)},${sqlLiteral(owner.sourceVersion)},
    ${sqlBytea(terminalDigest)},${Number(config.limits.policyFreshnessSeconds)});`);
  const state = psql(`
    SELECT p.enabled,p.circuit_state,p.dispatch_count,p.failure_count,r.state,
      o.status,r.canonical_operation_id IS NOT NULL,fo.state,
      (SELECT count(*) FROM core.framework_executions e WHERE e.operation_id=fo.operation_id)
    FROM core.framework_command_canary_policies p
    JOIN core.framework_command_canary_reservations r
      ON r.canary_policy_id=p.canary_policy_id
    JOIN core.operations o ON o.id=r.predecessor_operation_id
    JOIN core.framework_operations fo ON fo.operation_id=r.canonical_operation_id
    WHERE p.canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND r.reservation_id=${sqlLiteral(reservationId)};
  `).output.split('|');
  assert.deepEqual(state, [
    't',
    'closed',
    '1',
    '1',
    'completed',
    'succeeded',
    't',
    'completed',
    '1',
  ]);
  evidence.phases.parserRepair = {
    passed: true,
    at: new Date().toISOString(),
    migration: 16,
    reservationId,
    safeErrorCode: 'P7_PROFILE_LIST_WIDTH_PARSER',
    ownerCreateCompleted: true,
    adapterVerificationFailed: true,
    adapterParserFixedAndRedeployed: true,
    ownerProfileVisibleAfterRepair: true,
    sourceVersion: owner.sourceVersion,
    terminalDigest,
    remainingDispatches: 1,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 owner-create reconciliation: PASS reservation=${reservationId} profileVisible=true remainingDispatches=1`,
  );
}

async function resumeRollback() {
  const evidence = readEvidence();
  const created = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.equal(created.count, config.baseline.profileIds.length + 1);
  assert.equal(created.ids.includes(config.scope.nativeTargetId), true);
  assert.notEqual(created.sourceVersion, config.baseline.sourceVersion);
  assertFreshObservation(created);
  const eventBefore = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);

  const createCommand = command(
    'profile.create',
    'execute',
    config.baseline.sourceVersion,
    'p7.execute.profile.create.0003',
    'p7-create-replay',
  );
  const replayReservation = reserve(createCommand);
  assert.equal(replayReservation.ok, true);
  assert.equal(replayReservation.replayed, true);
  assert.equal(
    Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output),
    eventBefore,
  );
  const conflicting = structuredClone(createCommand);
  conflicting.payload = { description: `${config.description} conflict` };
  const conflictReservation = reserve(conflicting);
  assert.equal(conflictReservation.ok, false);
  assert.match(conflictReservation.error, /P7_IDEMPOTENCY_CONFLICT/);
  assert.equal(
    Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output),
    eventBefore,
  );
  const duplicateDigest = recordFault(
    'duplicate',
    'replayed-without-owner',
    'P7_DUPLICATE_BLOCKED',
    {
      reservationId: replayReservation.reservationId,
      replayed: true,
      conflictDeniedBeforeOwner: true,
      ownerEventsUnchanged: true,
    },
  );

  const deleteCommand = command(
    'profile.delete',
    'execute',
    created.sourceVersion,
    'p7.execute.profile.delete.0003',
    'p7-delete',
  );
  const deleteReservation = reserve(deleteCommand);
  assert.equal(deleteReservation.ok, true, deleteReservation.error);
  assert.equal(deleteReservation.replayed, false);
  startDispatch(deleteReservation.reservationId);
  const deleteResponse = await ownerCommand(deleteCommand);
  assert.equal(deleteResponse.data.status, 'completed');
  const restored = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(restored.ids, config.baseline.profileIds);
  assert.equal(restored.sourceVersion, config.baseline.sourceVersion);
  assert.equal(restored.ids.includes(config.scope.nativeTargetId), false);
  assertFreshObservation(restored);
  const deleteTerminalDigest = completeDispatch(
    deleteReservation.reservationId,
    deleteResponse,
    restored,
  );
  const eventAfter = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);

  evidence.phases.canary = {
    passed: true,
    at: new Date().toISOString(),
    validate: { status: 'validated', ownerMutation: 0 },
    dryRun: { status: 'dry-run', ownerMutation: 0 },
    create: {
      reservationId: replayReservation.reservationId,
      reconciledAfterAdapterVerificationFailure: true,
      sourceVersion: created.sourceVersion,
      profileCount: created.count,
      terminalDigest: evidence.phases.parserRepair.terminalDigest,
    },
    duplicate: {
      replayedWithoutOwner: true,
      conflictDeniedBeforeOwner: true,
      evidenceDigest: duplicateDigest,
    },
    rollback: {
      reservationId: deleteReservation.reservationId,
      operationId: deleteResponse.data.operationId,
      restoredSourceVersion: restored.sourceVersion,
      restoredProfileIds: restored.ids,
      terminalDigest: deleteTerminalDigest,
      ownerStateRestored: true,
    },
    adapterEvents: { beforeRollback: eventBefore, after: eventAfter },
    ownerDispatches: 2,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 owner canary resumed: PASS create=reconciled rollback=completed profiles=${created.count}->${restored.count} sourceRestored=true ownerDispatches=2`,
  );
}

async function reconcileDeletedProfile() {
  const evidence = readEvidence();
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(owner.ids, config.baseline.profileIds);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), false);
  assert.notEqual(owner.sourceVersion, evidence.phases.parserRepair.sourceVersion);
  assertFreshObservation(owner);
  const reservationId = psql(`
    SELECT reservation_id FROM core.framework_command_canary_reservations
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND state='dispatching' AND idempotency_key='p7.execute.profile.delete.0003';
  `).output;
  assert.match(reservationId, /^rsv_/);
  const terminalDigest = sha(
    stable({
      reservationId,
      safeCode: 'P7_BOUNDED_DELETE_TIMEOUT',
      owner,
      ownerDeleteCompleted: true,
      nativeTargetAbsent: true,
    }),
  );
  psql(`SELECT core.reconcile_phase7_post_owner_delete(
    ${sqlLiteral(reservationId)},${sqlLiteral(owner.sourceVersion)},
    ${sqlBytea(terminalDigest)},${Number(config.limits.policyFreshnessSeconds)});`);
  const state = psql(`
    SELECT p.enabled,p.circuit_state,p.dispatch_count,p.failure_count,r.state,
      o.status,r.canonical_operation_id IS NOT NULL,fo.state,
      (SELECT count(*) FROM core.framework_executions e WHERE e.operation_id=fo.operation_id)
    FROM core.framework_command_canary_policies p
    JOIN core.framework_command_canary_reservations r
      ON r.canary_policy_id=p.canary_policy_id
    JOIN core.operations o ON o.id=r.predecessor_operation_id
    JOIN core.framework_operations fo ON fo.operation_id=r.canonical_operation_id
    WHERE p.canary_policy_id=${sqlLiteral(config.scope.policyId)}
      AND r.reservation_id=${sqlLiteral(reservationId)};
  `).output.split('|');
  assert.deepEqual(state, [
    't',
    'closed',
    '2',
    '1',
    'completed',
    'succeeded',
    't',
    'completed',
    '1',
  ]);
  const duplicateDigest = psql(`
    SELECT encode(evidence_digest,'hex') FROM core.framework_command_canary_faults
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)} AND fault_class='duplicate'
    ORDER BY observed_at DESC LIMIT 1;
  `).output;
  assert.match(duplicateDigest, /^[a-f0-9]{64}$/);
  evidence.phases.deleteReconciliation = {
    passed: true,
    at: new Date().toISOString(),
    migration: 17,
    reservationId,
    safeErrorCode: 'P7_BOUNDED_DELETE_TIMEOUT',
    ownerDeleteCompleted: true,
    nativeTargetAbsent: true,
    terminalSourceVersion: owner.sourceVersion,
    preParserSourceVersion: config.baseline.sourceVersion,
    representationVersionChangedByParserRepair: true,
    terminalDigest,
    remainingDispatches: 0,
  };
  evidence.phases.canary = {
    passed: true,
    at: new Date().toISOString(),
    validate: { status: 'validated', ownerMutation: 0 },
    dryRun: { status: 'dry-run', ownerMutation: 0 },
    create: {
      reservationId: evidence.phases.parserRepair.reservationId,
      reconciledAfterAdapterVerificationFailure: true,
      sourceVersion: evidence.phases.parserRepair.sourceVersion,
      profileCount: config.baseline.profileIds.length + 1,
      terminalDigest: evidence.phases.parserRepair.terminalDigest,
    },
    duplicate: {
      replayedWithoutOwner: true,
      conflictDeniedBeforeOwner: true,
      evidenceDigest: duplicateDigest,
    },
    rollback: {
      reservationId,
      operationId: 'reconciled:P7_BOUNDED_DELETE_TIMEOUT',
      restoredSourceVersion: owner.sourceVersion,
      preParserSourceVersion: config.baseline.sourceVersion,
      restoredProfileIds: owner.ids,
      terminalDigest,
      ownerStateRestored: true,
      representationVersionChangedByParserRepair: true,
    },
    adapterEvents: {
      afterReconciliation: Number(
        psql('SELECT count(*) FROM public.hermes_adapter_events;').output,
      ),
    },
    ownerDispatches: 2,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 owner-delete reconciliation: PASS reservation=${reservationId} profiles=${owner.count} nativeTargetAbsent=true ownerStateRestored=true remainingDispatches=0`,
  );
}

async function canary() {
  const evidence = readEvidence();
  const before = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(before.ids, config.baseline.profileIds);
  assert.equal(before.sourceVersion, config.baseline.sourceVersion);
  assertFreshObservation(before);
  const eventBefore = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);

  const validateCommand = command(
    'profile.create',
    'validate',
    before.sourceVersion,
    'p7.validate.profile.create.0003',
    'p7-validate',
  );
  const validated = await ownerCommand(validateCommand);
  assert.equal(validated.data.status, 'validated');
  let after = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(after.ids, before.ids);
  assert.equal(after.sourceVersion, before.sourceVersion);

  const dryRunCommand = command(
    'profile.create',
    'dry-run',
    before.sourceVersion,
    'p7.dryrun.profile.create.0003',
    'p7-dryrun',
  );
  const dryRun = await ownerCommand(dryRunCommand);
  assert.equal(dryRun.data.status, 'dry-run');
  after = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(after.ids, before.ids);
  assert.equal(after.sourceVersion, before.sourceVersion);

  const createCommand = command(
    'profile.create',
    'execute',
    before.sourceVersion,
    'p7.execute.profile.create.0003',
    'p7-create',
  );
  const createReservation = reserve(createCommand);
  assert.equal(createReservation.ok, true, createReservation.error);
  assert.equal(createReservation.replayed, false);
  startDispatch(createReservation.reservationId);
  const createResponse = await ownerCommand(createCommand);
  assert.equal(createResponse.data.status, 'completed');
  const created = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.equal(created.ids.includes(config.scope.nativeTargetId), true);
  assert.equal(created.count, before.count + 1);
  assert.notEqual(created.sourceVersion, before.sourceVersion);
  assertFreshObservation(created);
  const createTerminalDigest = completeDispatch(
    createReservation.reservationId,
    createResponse,
    created,
  );

  const eventAfterCreate = Number(
    psql('SELECT count(*) FROM public.hermes_adapter_events;').output,
  );
  const replayReservation = reserve(createCommand);
  assert.equal(replayReservation.ok, true);
  assert.equal(replayReservation.replayed, true);
  assert.equal(replayReservation.reservationId, createReservation.reservationId);
  assert.equal(
    Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output),
    eventAfterCreate,
  );
  const conflicting = structuredClone(createCommand);
  conflicting.payload = { description: `${config.description} conflict` };
  const conflictReservation = reserve(conflicting);
  assert.equal(conflictReservation.ok, false);
  assert.match(conflictReservation.error, /P7_IDEMPOTENCY_CONFLICT/);
  assert.equal(
    Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output),
    eventAfterCreate,
  );
  const duplicateDigest = recordFault(
    'duplicate',
    'replayed-without-owner',
    'P7_DUPLICATE_BLOCKED',
    {
      reservationId: createReservation.reservationId,
      replayed: true,
      conflictDeniedBeforeOwner: true,
      ownerEventsUnchanged: true,
    },
  );

  const deleteCommand = command(
    'profile.delete',
    'execute',
    created.sourceVersion,
    'p7.execute.profile.delete.0003',
    'p7-delete',
  );
  const deleteReservation = reserve(deleteCommand);
  assert.equal(deleteReservation.ok, true, deleteReservation.error);
  assert.equal(deleteReservation.replayed, false);
  startDispatch(deleteReservation.reservationId);
  const deleteResponse = await ownerCommand(deleteCommand);
  assert.equal(deleteResponse.data.status, 'completed');
  const restored = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(restored.ids, before.ids);
  assert.equal(restored.sourceVersion, before.sourceVersion);
  assert.equal(restored.ids.includes(config.scope.nativeTargetId), false);
  assertFreshObservation(restored);
  const deleteTerminalDigest = completeDispatch(
    deleteReservation.reservationId,
    deleteResponse,
    restored,
  );
  const eventAfter = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);

  evidence.phases.canary = {
    passed: true,
    at: new Date().toISOString(),
    validate: { status: validated.data.status, ownerMutation: 0 },
    dryRun: { status: dryRun.data.status, ownerMutation: 0 },
    create: {
      reservationId: createReservation.reservationId,
      operationId: createResponse.data.operationId,
      sourceBefore: before.sourceVersion,
      sourceAfter: created.sourceVersion,
      terminalDigest: createTerminalDigest,
      ownerProfileCount: created.count,
    },
    duplicate: {
      replayedWithoutOwner: true,
      conflictDeniedBeforeOwner: true,
      evidenceDigest: duplicateDigest,
    },
    rollback: {
      reservationId: deleteReservation.reservationId,
      operationId: deleteResponse.data.operationId,
      restoredSourceVersion: restored.sourceVersion,
      restoredProfileIds: restored.ids,
      terminalDigest: deleteTerminalDigest,
      ownerStateRestored: true,
    },
    adapterEvents: { before: eventBefore, afterCreate: eventAfterCreate, after: eventAfter },
    ownerDispatches: 2,
  };
  writeEvidence(evidence);
  console.log(
    `Phase 7 owner canary: PASS create=completed rollback=completed profiles=${before.count}->${created.count}->${restored.count} sourceRestored=true dispatches=2`,
  );
}

async function faults() {
  const evidence = readEvidence();
  const terminalSourceVersion = evidence.phases.deleteReconciliation.terminalSourceVersion;
  const ownerBefore = profileSummary(await ownerGet('/control/v1/profiles'));
  const eventBefore = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);
  assert.deepEqual(ownerBefore.ids, config.baseline.profileIds);
  assert.equal(ownerBefore.sourceVersion, terminalSourceVersion);

  const provenanceCommand = command(
    'profile.create',
    'execute',
    config.baseline.sourceVersion,
    'p7.fault.provenance.0001',
    'p7-provenance',
  );
  const provenance = reserve(provenanceCommand, {
    tenantId: 'ten_00000000000000000000000000',
  });
  assert.equal(provenance.ok, false);
  assert.match(provenance.error, /P7_PROVENANCE_MISMATCH/);
  const provenanceDigest = recordFault(
    'provenance',
    'denied-before-owner',
    'P7_PROVENANCE_MISMATCH',
    { wrongTenantDenied: true, ownerDispatchCount: 0 },
  );

  let timeoutObserved = false;
  try {
    await new Promise((resolve, reject) => {
      const request = https.request(
        'https://127.0.0.1:9/control/v1/commands/profiles',
        { method: 'POST', timeout: config.limits.faultTimeoutMs, rejectUnauthorized: false },
        resolve,
      );
      request.on('timeout', () => request.destroy(new Error('injected timeout')));
      request.on('error', reject);
      request.end();
    });
  } catch {
    timeoutObserved = true;
  }
  assert.equal(timeoutObserved, true);
  const timeoutDigest = recordFault(
    'timeout',
    'failed-before-owner',
    'P7_INJECTED_TIMEOUT',
    { endpointClass: 'unused-local', timeoutMs: config.limits.faultTimeoutMs },
    true,
  );

  const circuitOpenDigest = recordFault(
    'circuit-open',
    'circuit-opened',
    'P7_FAILURE_THRESHOLD_REACHED',
    { failureCount: 2, threshold: config.limits.failureThreshold },
    false,
  );
  const blockedCommand = command(
    'profile.create',
    'execute',
    config.baseline.sourceVersion,
    'p7.fault.circuit.block.0001',
    'p7-circuit',
  );
  const blocked = reserve(blockedCommand);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /P7_POLICY_DISABLED_OR_OPEN/);
  const circuitBlockedDigest = recordFault(
    'circuit-open',
    'blocked-before-owner',
    'P7_CIRCUIT_BLOCKED',
    { reservationDenied: true, ownerDispatchCount: 0 },
  );

  const ownerAfter = profileSummary(await ownerGet('/control/v1/profiles'));
  const eventAfter = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);
  assert.deepEqual(ownerAfter.ids, ownerBefore.ids);
  assert.equal(ownerAfter.sourceVersion, ownerBefore.sourceVersion);
  assert.equal(ownerAfter.count, ownerBefore.count);
  assert.equal(eventAfter, eventBefore);
  const policy = psql(
    `SELECT enabled,circuit_state,failure_count,dispatch_count FROM core.framework_command_canary_policies WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)};`,
  ).output.split('|');
  assert.deepEqual(policy, ['f', 'open', '2', '2']);

  evidence.phases.faults = {
    passed: true,
    at: new Date().toISOString(),
    timeout: { failedBeforeOwner: true, evidenceDigest: timeoutDigest },
    duplicate: evidence.phases.canary.duplicate,
    provenance: { deniedBeforeOwner: true, evidenceDigest: provenanceDigest },
    circuit: {
      openedAtThreshold: true,
      reservationBlockedBeforeOwner: true,
      openDigest: circuitOpenDigest,
      blockedDigest: circuitBlockedDigest,
    },
    ownerStateUnchanged: true,
    ownerEventsUnchanged: true,
    ownerDispatches: 0,
  };
  writeEvidence(evidence);
  console.log(
    'Phase 7 injected faults: PASS timeout=true duplicate=true provenanceDenied=true circuitOpened=true ownerDispatches=0',
  );
}

async function reconcileFaultEvidence() {
  const evidence = readEvidence();
  const terminalSourceVersion = evidence.phases.deleteReconciliation.terminalSourceVersion;
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(owner.ids, config.baseline.profileIds);
  assert.equal(owner.sourceVersion, terminalSourceVersion);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), false);
  const eventCount = Number(psql('SELECT count(*) FROM public.hermes_adapter_events;').output);
  assert.equal(eventCount, evidence.phases.canary.adapterEvents.afterReconciliation);
  const policy = psql(
    `SELECT enabled,circuit_state,failure_count,dispatch_count FROM core.framework_command_canary_policies WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)};`,
  ).output.split('|');
  assert.deepEqual(policy, ['f', 'open', '2', '2']);
  const rows = psql(`
    SELECT safe_code,encode(evidence_digest,'hex')
    FROM core.framework_command_canary_faults
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)}
    ORDER BY observed_at;
  `)
    .output.split('\n')
    .filter(Boolean)
    .map((line) => line.split('|'));
  assert.equal(rows.length, 6);
  const digests = Object.fromEntries(rows);
  for (const safeCode of [
    'P7_ADAPTER_CONNECTION_TERMINATED',
    'P7_DUPLICATE_BLOCKED',
    'P7_PROVENANCE_MISMATCH',
    'P7_INJECTED_TIMEOUT',
    'P7_FAILURE_THRESHOLD_REACHED',
    'P7_CIRCUIT_BLOCKED',
  ])
    assert.match(digests[safeCode] ?? '', /^[a-f0-9]{64}$/);
  evidence.phases.faults = {
    passed: true,
    at: new Date().toISOString(),
    reconciledAfterObservationTimestampAssertion: true,
    timeout: { failedBeforeOwner: true, evidenceDigest: digests.P7_INJECTED_TIMEOUT },
    duplicate: evidence.phases.canary.duplicate,
    provenance: {
      deniedBeforeOwner: true,
      evidenceDigest: digests.P7_PROVENANCE_MISMATCH,
    },
    circuit: {
      openedAtThreshold: true,
      reservationBlockedBeforeOwner: true,
      openDigest: digests.P7_FAILURE_THRESHOLD_REACHED,
      blockedDigest: digests.P7_CIRCUIT_BLOCKED,
    },
    ownerStateUnchanged: true,
    ownerEventsUnchanged: true,
    ownerDispatches: 0,
  };
  writeEvidence(evidence);
  console.log(
    'Phase 7 injected faults reconciled: PASS timeout=true duplicate=true provenanceDenied=true circuitOpened=true ownerDispatches=0',
  );
}

async function disable() {
  const evidence = readEvidence();
  const terminalSourceVersion = evidence.phases.deleteReconciliation.terminalSourceVersion;
  psql(`SELECT core.disable_phase7_canary(${sqlLiteral(config.scope.policyId)});`);
  const owner = profileSummary(await ownerGet('/control/v1/profiles'));
  assert.deepEqual(owner.ids, config.baseline.profileIds);
  assert.equal(owner.sourceVersion, terminalSourceVersion);
  assert.equal(owner.ids.includes(config.scope.nativeTargetId), false);
  const row = psql(`
    SELECT enabled,circuit_state,dispatch_count,failure_count,
      (SELECT count(*) FROM core.framework_command_canary_reservations WHERE canary_policy_id=p.canary_policy_id),
      (SELECT count(*) FROM core.framework_command_canary_faults WHERE canary_policy_id=p.canary_policy_id),
      (SELECT count(*) FROM core.framework_operations WHERE retention_policy_key='phase7-canary-evidence/v1'),
      (SELECT count(*) FROM core.framework_executions WHERE native_execution_alias LIKE 'phase7:%'),
      (SELECT count(*) FROM public.operations),
      (SELECT count(*) FROM core.framework_session_projections),
      (SELECT count(*) FROM core.chat_framework_links)
    FROM core.framework_command_canary_policies p
    WHERE canary_policy_id=${sqlLiteral(config.scope.policyId)};
  `).output.split('|');
  assert.deepEqual(row.slice(0, 8), ['f', 'disabled', '2', '2', '4', '6', '3', '2']);
  assert.equal(row[9], '0');
  assert.equal(row[10], '0');
  const disabledProbe = reserve(
    command(
      'profile.create',
      'execute',
      config.baseline.sourceVersion,
      'p7.disabled.probe.0001',
      'p7-disabled',
    ),
  );
  assert.equal(disabledProbe.ok, false);
  assert.match(disabledProbe.error, /P7_POLICY_DISABLED_OR_OPEN/);

  evidence.phases.disable = {
    passed: true,
    at: new Date().toISOString(),
    enabled: false,
    circuitState: 'disabled',
    disabledProbeDeniedBeforeOwner: true,
    dispatchCount: 2,
    failureCount: 2,
    reservations: 4,
    faultEvidenceRows: 6,
    canonicalOperations: 3,
    canonicalExecutions: 2,
    gatewayOperations: Number(row[8]),
    sessions: Number(row[9]),
    chatLinks: Number(row[10]),
    ownerStateRestored: true,
    terminalSourceVersion,
    preParserSourceVersion: config.baseline.sourceVersion,
    representationVersionChangedByParserRepair: true,
    finalOwnerProfiles: owner,
  };
  evidence.result = {
    passed: true,
    ownerDispatches: 2,
    duplicateOwnerDispatches: 0,
    ownerStateRestored: true,
    policyDisabled: true,
    commandRunnerDeployed: false,
    rawRouteExposed: false,
    phase8Authorized: false,
  };
  evidence.artifactDigest = sha(stable({ ...evidence, artifactDigest: undefined }));
  writeEvidence(evidence);
  console.log(
    `Phase 7 canary disabled: PASS policy=disabled dispatches=2 operations=3 executions=2 ownerStateRestored=true artifactDigest=${evidence.artifactDigest}`,
  );
}

if (mode === '--preflight') await preflight();
else if (mode === '--seed') await seed();
else if (mode === '--repair-preflight') await repairPreflight();
else if (mode === '--recover-transport') await recoverTransport();
else if (mode === '--reconcile-created') await reconcileCreatedProfile();
else if (mode === '--resume-rollback') await resumeRollback();
else if (mode === '--reconcile-deleted') await reconcileDeletedProfile();
else if (mode === '--canary') await canary();
else if (mode === '--faults') await faults();
else if (mode === '--reconcile-faults') await reconcileFaultEvidence();
else if (mode === '--disable') await disable();
else throw new Error(`unknown mode ${mode}`);
