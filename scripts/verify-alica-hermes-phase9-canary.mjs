#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Agent, request } from 'node:https';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const config = JSON.parse(
  readFileSync(`${root}/deploy/five-service/hermes-phase9/capability-policy.v1.json`, 'utf8'),
);
const token = readFileSync(`${root}/.secrets/hermes_main_control_token`, 'utf8').trim();
const ca = readFileSync(`${root}/.secrets/hermes_adapter_ca.crt`);
const agent = new Agent({ ca, rejectUnauthorized: true });

function psql(sql) {
  const result = spawnSync(
    'docker',
    [
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
      '-A',
      '-t',
      '-F',
      '|',
    ],
    { input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  return result.stdout.trim();
}
function api(path) {
  return new Promise((resolve, reject) => {
    const req = request(
      `https://127.0.0.1:28082/control/v1${path}`,
      { agent, headers: { authorization: `Bearer ${token}` } },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
function assert(condition, code) {
  if (!condition) throw new Error(code);
}

const policies = psql(`SELECT family,capability_status,disposition,execute_enabled,dispatch_count,
  failure_count,circuit_state,enabled,disabled_at IS NOT NULL
  FROM core.framework_capability_canary_policies ORDER BY family;`).split('\n');
assert(policies.length === 6, 'POLICY_COUNT');
for (const row of policies) {
  const [
    family,
    capability,
    disposition,
    executeEnabled,
    dispatch,
    failures,
    circuit,
    enabled,
    disabled,
  ] = row.split('|');
  assert(
    enabled === 'f' && disabled === 't' && circuit === 'disabled',
    `POLICY_NOT_DISABLED_${family}`,
  );
  assert(disposition === (family === 'conversation' ? 'held' : 'passed'), `DISPOSITION_${family}`);
  assert(
    capability === (family === 'conversation' ? 'unavailable' : 'supported'),
    `CAPABILITY_${family}`,
  );
  assert(executeEnabled === (family === 'profile' ? 't' : 'f'), `EXECUTE_SCOPE_${family}`);
  assert(Number(dispatch) === (family === 'profile' ? 3 : 0), `DISPATCH_COUNT_${family}`);
  assert(Number(failures) === (family === 'profile' ? 2 : 0), `FAILURE_COUNT_${family}`);
}
const reservations = psql(`SELECT count(*),count(*) FILTER (WHERE state='completed'),
  count(*) FILTER (WHERE mode='execute'),count(*) FILTER (WHERE mode<>'execute')
  FROM core.framework_capability_canary_reservations;`)
  .split('|')
  .map(Number);
assert(reservations.join('|') === '11|11|3|8', 'RESERVATION_TERMINAL_COUNTS');
assert(
  Number(psql('SELECT count(*) FROM core.framework_capability_canary_faults;')) === 5,
  'FAULT_COUNT',
);
assert(
  Number(
    psql(`SELECT count(*) FROM core.framework_operations fo
  JOIN core.framework_capability_canary_reservations r ON r.canonical_operation_id=fo.operation_id
  WHERE fo.state='authorized' AND fo.authorization_state='authorized';`),
  ) === 11,
  'IMMUTABLE_AUTHORIZATION',
);
assert(
  Number(
    psql(`SELECT count(*) FROM core.framework_executions e
  JOIN core.framework_capability_canary_reservations r ON r.canonical_operation_id=e.operation_id;`),
  ) === 3,
  'EXECUTION_COUNT',
);
assert(
  Number(
    psql(`SELECT count(*) FROM public.hermes_adapter_idempotency
      WHERE idempotency_key LIKE 'alica-p9-secret-%';`),
  ) === 0,
  'SECRET_MATERIAL_RISK',
);

const [identity, health, profiles, models, providers, projects, cronjobs, conversations] =
  await Promise.all([
    api('/identity'),
    api('/health'),
    api('/profiles'),
    api('/models'),
    api('/providers'),
    api('/work/projects'),
    api('/work/cronjobs'),
    api('/conversations/sessions'),
  ]);
assert(identity.status === 200 && identity.body.frameworkId === 'hermes-main', 'IDENTITY');
assert(health.status === 200 && health.body.data.checks.eventStore.status === 'healthy', 'HEALTH');
assert(profiles.status === 200 && profiles.body.data.items.length === 6, 'PROFILE_COUNT');
assert(
  !profiles.body.data.items.some((x) => x.id === 'alica-p9-profile-canary'),
  'PROFILE_TARGET_RETAINED',
);
const selected = models.body.data.items
  .filter((x) => x.selected)
  .map((x) => `${x.providerId}/${x.id}`);
assert(selected.join(',') === 'openai-codex/gpt-5.6-sol', 'HERMAN_MODEL_CHANGED');
assert(
  providers.body.data.items.filter((x) => x.credentialStatus === 'configured').length === 4,
  'CREDENTIAL_STATUS_CHANGED',
);
assert(projects.body.data.items.length === 0, 'PROJECT_RETAINED');
assert(cronjobs.body.data.items.length === 0, 'CRON_RETAINED');
assert(
  conversations.status === 503 && conversations.body.error.code === 'capability_unavailable',
  'CONVERSATION_NOT_HELD',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      contractVersion: config.contractVersion,
      policies: policies.length,
      reservations: { total: 11, completed: 11, execute: 3, nonExecute: 8 },
      faults: 5,
      immutableAuthorizations: 11,
      executions: 3,
      terminal: {
        profiles: 6,
        selectedModel: selected[0],
        configuredProviders: 4,
        projects: 0,
        cronjobs: 0,
        conversations: 'unavailable',
      },
    },
    null,
    2,
  ),
);
