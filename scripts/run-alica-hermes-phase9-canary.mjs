#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Agent, request } from 'node:https';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const config = JSON.parse(
  readFileSync(`${root}/deploy/five-service/hermes-phase9/capability-policy.v1.json`, 'utf8'),
);
const token = readFileSync(`${root}/.secrets/hermes_main_control_token`, 'utf8').trim();
const ca = readFileSync(`${root}/.secrets/hermes_adapter_ca.crt`);
const base = 'https://127.0.0.1:28082/control/v1';
const scope = config.scope;
const byFamily = Object.fromEntries(config.families.map((x) => [x.family, x]));
const results = [];

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `ARRAY[${value.map(sqlLiteral).join(',')}]::text[]`;
  return `'${String(value).replaceAll("'", "''")}'`;
}
function psql(sql, tuples = false) {
  const args = [
    'exec',
    '-i',
    'unify-postgres-1',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'unify',
    '-d',
    'unify',
    '-X',
  ];
  if (tuples) args.push('-A', '-t', '-F', '|');
  const r = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`PSQL_FAILED:${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const tlsAgent = new Agent({ ca, rejectUnauthorized: true });
async function api(path, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof options.body === 'string' ? options.body : undefined;
    const req = request(
      `${base}${path}`,
      {
        method: options.method ?? 'GET',
        agent: tlsAgent,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...(options.headers ?? {}),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          let body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = {};
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function command(operation, mode, targetId, payload, suffix, expectedSourceVersion) {
  return {
    operation,
    mode,
    targetId,
    idempotencyKey: `alica-p9-${suffix}-20260820`,
    expectedSourceVersion,
    requestId: `req-p9-${suffix}`,
    correlationId: `cor-p9-${suffix}`,
    actor: { type: 'service', id: scope.controllerServicePrincipalId },
    payload,
  };
}
function reserve(policy, cmd) {
  const hash = digest(cmd);
  const q = `SELECT * FROM core.reserve_phase9_capability_command(
    ${sqlLiteral(policy.policyId)},${sqlLiteral(scope.controllerServicePrincipalId)},
    ${sqlLiteral(scope.canonicalPrincipalId)},${sqlLiteral(scope.tenantId)},
    ${sqlLiteral(scope.clientId)},${sqlLiteral(scope.applicationId)},
    ${sqlLiteral(scope.frameworkId)},${sqlLiteral(scope.contextAgentProfileId)},
    ${sqlLiteral(policy.nativeTargetId)},${sqlLiteral(cmd.operation)},${sqlLiteral(cmd.mode)},
    ${sqlLiteral(cmd.idempotencyKey)},decode('${hash}','hex'),${sqlLiteral(cmd.expectedSourceVersion)});`;
  const [reservationId, state, replayed] = psql(q, true).split('|');
  return { reservationId, state, replayed: replayed === 't', hash };
}
function expectDenied(label, fn, code) {
  try {
    fn();
    throw new Error(`${label}_UNEXPECTEDLY_ALLOWED`);
  } catch (error) {
    if (
      String(error.message).includes('_UNEXPECTEDLY_ALLOWED') ||
      !String(error.message).includes(code)
    )
      throw error;
    results.push({ label, status: 'denied-before-owner', code });
  }
}
async function issue(policy, path, cmd) {
  const r = reserve(policy, cmd);
  if (r.replayed && r.state === 'completed')
    return { replayedByCore: true, reservationId: r.reservationId };
  if (r.replayed && !['reserved', 'dispatching'].includes(r.state))
    throw new Error(`UNCERTAIN_RESERVATION_${r.state}`);
  const recoveringDispatch = r.replayed && r.state === 'dispatching';
  if (cmd.mode === 'execute' && r.state === 'reserved')
    psql(`SELECT core.start_phase9_capability_dispatch(${sqlLiteral(r.reservationId)});`);
  const response = await api(path, { method: 'POST', body: JSON.stringify(cmd) });
  if (response.status !== 200)
    throw new Error(
      `ADAPTER_${cmd.operation}_${cmd.mode}_${response.status}_${response.body?.error?.code ?? 'UNKNOWN'}`,
    );
  const data = response.body.data;
  if (!['validated', 'dry-run', 'completed'].includes(data?.status))
    throw new Error(`BAD_ADAPTER_STATUS_${cmd.operation}`);
  if (recoveringDispatch && data.replayed !== true)
    throw new Error(`RECOVERY_WAS_NOT_ADAPTER_REPLAY_${cmd.operation}`);
  const terminal = digest({
    status: response.status,
    sourceVersion: response.body.sourceVersion,
    data,
  });
  psql(`SELECT core.complete_phase9_capability_command(${sqlLiteral(r.reservationId)},
    ${sqlLiteral(data.operationId)},${sqlLiteral(response.body.sourceVersion)},decode('${terminal}','hex'));`);
  results.push({
    family: policy.family,
    operation: cmd.operation,
    mode: cmd.mode,
    reservationId: r.reservationId,
    adapterOperationId: data.operationId,
    status: data.status,
    replayed: data.replayed,
  });
  return { response, reservationId: r.reservationId, hash: r.hash };
}
function seedPolicies() {
  const values = config.families
    .map((p) => {
      const identity = [
        p.policyId,
        scope.frameworkId,
        scope.contextAgentProfileId,
        scope.controllerServicePrincipalId,
        scope.canonicalPrincipalId,
        scope.tenantId,
        scope.clientId,
        scope.applicationId,
        p.family,
        p.riskTier,
        p.ownerCapability,
        p.capabilityStatus,
        p.nativeTargetId,
      ]
        .map(sqlLiteral)
        .join(',');
      return `(${identity},${sqlLiteral(p.allowedOperations)},${sqlLiteral(p.allowedModes)},
        ${sqlLiteral(p.executeEnabled)},${sqlLiteral(config.approvalReference)},${sqlLiteral(p.baselineSourceVersion)},
        ${sqlLiteral(p.dispatchLimit)},2,'closed','pending',${p.capabilityStatus === 'supported' ? 'true' : 'false'},
        clock_timestamp()+interval '30 minutes')`;
    })
    .join(',\n');
  psql(`BEGIN;
    INSERT INTO core.framework_capability_canary_policies
    (policy_id,framework_id,context_agent_profile_id,controller_service_principal_id,
      canonical_principal_id,tenant_id,client_id,application_id,family,risk_tier,
      owner_capability,capability_status,native_target_id,allowed_operations,allowed_modes,
      execute_enabled,approval_reference,baseline_source_version,dispatch_limit,failure_threshold,
      circuit_state,disposition,enabled,fresh_until)
    VALUES ${values}
    ON CONFLICT (policy_id) DO NOTHING;
    COMMIT;`);
  const count = Number(
    psql(
      `SELECT count(*) FROM core.framework_capability_canary_policies WHERE policy_id=ANY(${sqlLiteral(
        config.families.map((item) => item.policyId),
      )});`,
      true,
    ),
  );
  if (count !== config.families.length) throw new Error('PHASE9_POLICY_SET_INCOMPLETE');
}
function recordFault(policy, faultClass, expected, safeCode, increment = false) {
  const h = digest({ policy: policy.policyId, faultClass, expected, safeCode });
  psql(`SELECT core.record_phase9_capability_fault(${sqlLiteral(policy.policyId)},
    ${sqlLiteral(faultClass)},${sqlLiteral(expected)},decode('${h}','hex'),${sqlLiteral(safeCode)},${increment});`);
}
function close(policy, disposition, code) {
  psql(
    `SELECT core.close_phase9_capability_policy(${sqlLiteral(policy.policyId)},${sqlLiteral(disposition)},${sqlLiteral(code)});`,
  );
}

async function main() {
  const identity = await api('/identity');
  const capabilities = await api('/capabilities');
  if (identity.status !== 200 || identity.body.frameworkId !== 'hermes-main')
    throw new Error('IDENTITY_MISMATCH');
  const caps = capabilities.body.data.capabilities;
  for (const p of config.families) {
    if (caps[p.ownerCapability]?.status !== p.capabilityStatus)
      throw new Error(`CAPABILITY_DRIFT_${p.family}`);
  }
  const profiles0 = await api('/profiles');
  const profileReservationState = psql(
    `SELECT coalesce((SELECT r.state FROM core.framework_capability_canary_reservations r
      JOIN core.framework_capability_canary_policies p USING(policy_id)
      WHERE p.family='profile' AND r.operation='profile.create' LIMIT 1),'none');`,
    true,
  );
  const targetPresent = profiles0.body.data.items.some(
    (x) => x.id === byFamily.profile.nativeTargetId,
  );
  const normalProfileBaseline =
    profiles0.body.data.items.length === 6 &&
    !targetPresent &&
    ['none', 'reserved'].includes(profileReservationState);
  const recoverableProfileBaseline =
    profiles0.body.data.items.length === 7 &&
    targetPresent &&
    profileReservationState === 'dispatching';
  if (profiles0.status !== 200 || (!normalProfileBaseline && !recoverableProfileBaseline))
    throw new Error('PROFILE_BASELINE_MISMATCH');
  const models0 = await api('/models');
  const providers0 = await api('/providers');
  const projects0 = await api('/work/projects');
  const cron0 = await api('/work/cronjobs');
  if (projects0.body.data.items.length !== 0 || cron0.body.data.items.length !== 0)
    throw new Error('WORK_BASELINE_NOT_EMPTY');
  const configuredProviders0 = providers0.body.data.items.filter(
    (x) => x.credentialStatus === 'configured',
  ).length;
  const selectedModels0 = models0.body.data.items
    .filter((x) => x.selected)
    .map((x) => `${x.providerId}/${x.id}`)
    .sort();
  if (configuredProviders0 !== 4 || selectedModels0.join(',') !== 'openai-codex/gpt-5.6-sol')
    throw new Error('HERMAN_MODEL_BASELINE_MISMATCH');

  seedPolicies();

  const profile = byFamily.profile;
  const create = command(
    'profile.create',
    'execute',
    profile.nativeTargetId,
    { description: 'Disposable ALICA Phase 9 governance canary' },
    'profile-create',
    profile.baselineSourceVersion,
  );
  await issue(profile, '/commands/profiles', create);
  const profiles1 = await api('/profiles');
  if (
    profiles1.body.data.items.length !== 7 ||
    !profiles1.body.data.items.some((x) => x.id === profile.nativeTargetId)
  )
    throw new Error('PROFILE_CREATE_READBACK_FAILED');
  const update = command(
    'profile.update',
    'execute',
    profile.nativeTargetId,
    { description: 'Disposable ALICA Phase 9 governance canary updated' },
    'profile-update',
    profiles1.body.sourceVersion,
  );
  await issue(profile, '/commands/profiles', update);
  const profiles2 = await api('/profiles');
  const updated = profiles2.body.data.items.find((x) => x.id === profile.nativeTargetId);
  if (!updated || updated.description !== 'Disposable ALICA Phase 9 governance canary updated')
    throw new Error('PROFILE_UPDATE_READBACK_FAILED');
  const remove = command(
    'profile.delete',
    'execute',
    profile.nativeTargetId,
    {},
    'profile-delete',
    profiles2.body.sourceVersion,
  );
  await issue(profile, '/commands/profiles', remove);
  const profiles3 = await api('/profiles');
  if (
    profiles3.body.data.items.length !== 6 ||
    profiles3.body.data.items.some((x) => x.id === profile.nativeTargetId)
  )
    throw new Error('PROFILE_RECOVERY_FAILED');

  const replay = reserve(profile, create);
  if (!replay.replayed || replay.state !== 'completed') throw new Error('CORE_REPLAY_FAILED');
  results.push({
    label: 'exact-replay',
    status: 'replayed-without-owner',
    reservationId: replay.reservationId,
  });
  expectDenied(
    'idempotency-conflict',
    () => reserve(profile, { ...create, payload: { description: 'changed' } }),
    'P9_IDEMPOTENCY_CONFLICT',
  );
  recordFault(profile, 'idempotency-conflict', 'denied-before-owner', 'P9_IDEMPOTENCY_CONFLICT');

  const model = byFamily.model;
  for (const mode of ['validate', 'dry-run'])
    await issue(
      model,
      '/commands/models',
      command(
        'model.select',
        mode,
        model.nativeTargetId,
        { providerId: 'openai-codex' },
        `model-${mode}`,
        models0.body.sourceVersion,
      ),
    );
  expectDenied(
    'model-execute',
    () =>
      reserve(
        model,
        command(
          'model.select',
          'execute',
          model.nativeTargetId,
          { providerId: 'openai-codex' },
          'model-execute',
          models0.body.sourceVersion,
        ),
      ),
    'P9_OPERATION_OR_MODE_FORBIDDEN',
  );
  recordFault(model, 'capability', 'blocked-before-owner', 'P9_EXECUTE_HELD');

  const work = byFamily.work;
  for (const mode of ['validate', 'dry-run'])
    await issue(
      work,
      '/commands/work',
      command(
        'project.create',
        mode,
        work.nativeTargetId,
        { name: 'ALICA Phase 9 dry-run only' },
        `work-${mode}`,
        projects0.body.sourceVersion,
      ),
    );
  const wrongScope = {
    ...command(
      'project.create',
      'dry-run',
      work.nativeTargetId,
      { name: 'changed' },
      'work-wrong-scope',
      projects0.body.sourceVersion,
    ),
  };
  const originalTenant = scope.tenantId;
  scope.tenantId = 'ten_00000000000000000000000000';
  expectDenied('scope-isolation', () => reserve(work, wrongScope), 'P9_PROVENANCE_MISMATCH');
  scope.tenantId = originalTenant;
  recordFault(work, 'provenance', 'denied-before-owner', 'P9_PROVENANCE_MISMATCH');

  const cron = byFamily.cron;
  for (const mode of ['validate', 'dry-run'])
    await issue(
      cron,
      '/commands/work',
      command(
        'cron.create',
        mode,
        cron.nativeTargetId,
        {
          name: 'ALICA Phase 9 dry-run only',
          schedule: '2035-01-01T00:00:00Z',
          prompt: 'Do not execute; Phase 9 dry-run contract probe.',
        },
        `cron-${mode}`,
        cron0.body.sourceVersion,
      ),
    );

  const secret = byFamily.secret;
  for (const mode of ['validate', 'dry-run'])
    await issue(
      secret,
      '/commands/models',
      command(
        'provider.credential.remove',
        mode,
        secret.nativeTargetId,
        {},
        `secret-${mode}`,
        providers0.body.sourceVersion,
      ),
    );

  recordFault(profile, 'circuit-open', 'blocked-before-owner', 'P9_INJECTED_FAILURE_ONE', true);
  recordFault(profile, 'circuit-open', 'blocked-before-owner', 'P9_INJECTED_FAILURE_TWO', true);

  const models1 = await api('/models'),
    providers1 = await api('/providers'),
    projects1 = await api('/work/projects'),
    cron1 = await api('/work/cronjobs');
  const configuredProviders1 = providers1.body.data.items.filter(
    (x) => x.credentialStatus === 'configured',
  ).length;
  const selectedModels1 = models1.body.data.items
    .filter((x) => x.selected)
    .map((x) => `${x.providerId}/${x.id}`)
    .sort();
  if (
    configuredProviders1 !== configuredProviders0 ||
    selectedModels1.join(',') !== selectedModels0.join(',')
  )
    throw new Error('MODEL_OR_SECRET_MUTATION_DETECTED');
  if (projects1.body.data.items.length !== 0 || cron1.body.data.items.length !== 0)
    throw new Error('WORK_OR_CRON_MUTATION_DETECTED');

  close(profile, 'passed', 'PROFILE_LIFECYCLE_RESTORED');
  close(model, 'passed', 'MODEL_VALIDATE_DRY_RUN_ONLY');
  close(work, 'passed', 'WORK_VALIDATE_DRY_RUN_ONLY');
  close(cron, 'passed', 'CRON_VALIDATE_DRY_RUN_ONLY');
  close(byFamily.conversation, 'held', 'HERMES_API_NOT_CONFIGURED');
  close(secret, 'passed', 'SECRET_VALIDATE_DRY_RUN_NO_MATERIAL');

  const summary = psql(
    `SELECT family,risk_tier,capability_status,disposition,execute_enabled,
    dispatch_count,failure_count,circuit_state,enabled FROM core.framework_capability_canary_policies
    ORDER BY array_position(ARRAY['profile','model','work','cron','conversation','secret']::text[],family);`,
    true,
  );
  const reservationSummary = psql(
    `SELECT p.family,r.mode,count(*) FROM core.framework_capability_canary_reservations r
    JOIN core.framework_capability_canary_policies p USING(policy_id) GROUP BY p.family,r.mode ORDER BY p.family,r.mode;`,
    true,
  );
  const faultCount = Number(
    psql('SELECT count(*) FROM core.framework_capability_canary_faults;', true),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        contractVersion: config.contractVersion,
        results,
        summary: summary.split('\n'),
        reservationSummary: reservationSummary.split('\n'),
        faultCount,
        terminal: {
          profiles: profiles3.body.data.items.length,
          projects: projects1.body.data.items.length,
          cronjobs: cron1.body.data.items.length,
          configuredProviders: configuredProviders1,
          selectedModels: selectedModels1,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(String(error.stack || error));
  process.exit(1);
});
