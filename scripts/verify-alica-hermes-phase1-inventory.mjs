#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { Value } from '@sinclair/typebox/value';
import {
  HermesBoardsResponseSchema,
  HermesCapabilitiesResponseSchema,
  HermesCronjobsResponseSchema,
  HermesEventsResponseSchema,
  HermesHealthResponseSchema,
  HermesIdentityResponseSchema,
  HermesModelsResponseSchema,
  HermesProfilesResponseSchema,
  HermesProjectsResponseSchema,
  HermesProvidersResponseSchema,
  HermesSessionsResponseSchema,
  HermesTasksResponseSchema,
  HermesVersionResponseSchema,
} from '../packages/contracts/dist/index.js';
import {
  APPROVED_TARGET,
  assertExactMetadata,
  assertRedactedReport,
  CONTROL_PATHS,
  diagnoseConversations,
  HMI_PHASE1_SCHEMA,
  summarizeCapabilities,
  summarizeCollection,
  summarizeGaps,
  summarizeHealth,
  unavailableCollection,
} from './lib/alica-hermes-phase1-inventory.mjs';

const root = new URL('..', import.meta.url).pathname;
const tokenFile = process.env.HMI_PHASE1_TOKEN_FILE ?? `${root}.secrets/hermes_main_control_token`;
const caFile = process.env.HMI_PHASE1_CA_FILE ?? `${root}.secrets/hermes_adapter_ca.crt`;
const baseUrl = new URL(process.env.HMI_PHASE1_BASE_URL ?? 'https://127.0.0.1:28082');
const token = readFileSync(tokenFile, 'utf8').trim();
const ca = readFileSync(caFile);
assert.equal(token.length > 0, true, 'adapter token is empty');
assert.equal(baseUrl.protocol, 'https:');
assert.equal(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(baseUrl.hostname), true);
assert.equal(baseUrl.username, '');
assert.equal(baseUrl.password, '');
assert.equal(baseUrl.pathname, '/');

const INVENTORY_SQL = String.raw`
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH registration AS (
  SELECT json_build_object(
    'adapterRows', count(*),
    'targetRows', count(*) FILTER (WHERE id = 'hermes-main'),
    'enabledTargetRows', count(*) FILTER (WHERE id = 'hermes-main' AND enabled),
    'verifiedTargetRows', count(*) FILTER (WHERE id = 'hermes-main' AND status = 'verified'),
    'contractMatchRows', count(*) FILTER (WHERE id = 'hermes-main' AND contract_version = 'hermes-control/v1'),
    'releaseMatchRows', count(*) FILTER (WHERE id = 'hermes-main' AND framework_version = '0.20.0'),
    'commitMatchRows', count(*) FILTER (WHERE id = 'hermes-main' AND framework_commit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4'),
    'scopeClasses', json_build_object(
      'read', count(*) FILTER (WHERE id = 'hermes-main' AND 'control:read' = ANY(scopes)),
      'execute', count(*) FILTER (WHERE id = 'hermes-main' AND 'control:execute' = ANY(scopes)),
      'events', count(*) FILTER (WHERE id = 'hermes-main' AND 'control:events' = ANY(scopes)),
      'secrets', count(*) FILTER (WHERE id = 'hermes-main' AND 'control:secrets' = ANY(scopes))
    ),
    'serviceAuthReferenceClasses', json_build_object(
      'environment', count(*) FILTER (WHERE id = 'hermes-main' AND secret_reference LIKE 'env:%'),
      'secretStore', count(*) FILTER (WHERE id = 'hermes-main' AND secret_reference LIKE 'secret://%'),
      'other', count(*) FILTER (WHERE id = 'hermes-main' AND secret_reference NOT LIKE 'env:%' AND secret_reference NOT LIKE 'secret://%')
    ),
    'transportClasses', json_build_object(
      'https', count(*) FILTER (WHERE id = 'hermes-main' AND base_url LIKE 'https://%'),
      'loopback', count(*) FILTER (WHERE id = 'hermes-main' AND base_url ~ '^https://(127[.]0[.]0[.]1|localhost|\[::1\])(?::[0-9]+)?$')
    )
  ) AS value
  FROM framework_registrations
  WHERE adapter_id = 'hermes-control/v1'
), isolation AS (
  SELECT json_build_object(
    'runtimeRoleCount', count(*) FILTER (WHERE rolname = 'unify_hermes_adapter_runtime'),
    'isolatedLoginRoleCount', count(*) FILTER (WHERE rolname IN ('unify_alica_adapter','unify_herman_adapter')),
    'rowSecurityTableCount', (SELECT count(*) FROM pg_class WHERE relname IN ('hermes_adapter_events','hermes_adapter_idempotency','hermes_adapter_audit') AND relrowsecurity),
    'frameworkPolicyCount', (SELECT count(*) FROM pg_policies WHERE tablename IN ('hermes_adapter_events','hermes_adapter_idempotency','hermes_adapter_audit'))
  ) AS value
  FROM pg_roles
), state AS (
  SELECT md5(concat(
    COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM framework_registrations r), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence)::text FROM hermes_adapter_events e), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY framework_id, capability, idempotency_key)::text FROM hermes_adapter_idempotency i), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY sequence)::text FROM hermes_adapter_audit a), '[]')
  )) AS fingerprint
)
SELECT json_build_object(
  'transaction', json_build_object(
    'readOnly', current_setting('transaction_read_only')::boolean,
    'isolation', current_setting('transaction_isolation'),
    'transactionIdAssigned', txid_current_if_assigned() IS NOT NULL
  ),
  'registration', (SELECT value FROM registration),
  'isolation', (SELECT value FROM isolation),
  'fingerprint', (SELECT fingerprint FROM state)
);
ROLLBACK;
`;

assert.equal(
  /\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|call|do)\b/iu.test(
    INVENTORY_SQL,
  ),
  false,
);

const beforeDatabase = databaseInventory();
const beforeContainer = containerState();

const identity = await getJson(CONTROL_PATHS.identity, HermesIdentityResponseSchema);
const version = await getJson(CONTROL_PATHS.version, HermesVersionResponseSchema);
const health = await getJson(CONTROL_PATHS.health, HermesHealthResponseSchema);
const capabilities = await getJson(CONTROL_PATHS.capabilities, HermesCapabilitiesResponseSchema);
for (const response of [identity, version, health, capabilities]) assertExactMetadata(response);
assert.equal(identity.data.runtime, 'hermes-agent');
assert.equal(version.data.release, APPROVED_TARGET.frameworkRelease);
assert.equal(version.data.commit, APPROVED_TARGET.frameworkCommit);
assert.equal(version.data.dirty, false);

const collectionDefinitions = [
  ['profiles', CONTROL_PATHS.profiles, HermesProfilesResponseSchema],
  ['providers', CONTROL_PATHS.providers, HermesProvidersResponseSchema],
  ['models', CONTROL_PATHS.models, HermesModelsResponseSchema],
  ['projects', CONTROL_PATHS.projects, HermesProjectsResponseSchema],
  ['boards', CONTROL_PATHS.boards, HermesBoardsResponseSchema],
  ['cronjobs', CONTROL_PATHS.cronjobs, HermesCronjobsResponseSchema],
];
const responses = {};
const families = {};
for (const [name, path, schema] of collectionDefinitions) {
  const response = await getJson(path, schema);
  responses[name] = response;
  families[name] = summarizeCollection(response);
}

let taskCount = 0;
let tasksExact = true;
for (const board of responses.boards.data.items) {
  assert.equal(typeof board.id, 'string');
  const tasks = await getJson(
    `/control/v1/work/boards/${encodeURIComponent(board.id)}/tasks?limit=100`,
    HermesTasksResponseSchema,
  );
  const summary = summarizeCollection(tasks);
  taskCount += summary.observedCount;
  tasksExact = tasksExact && summary.exact;
}
families.tasks = {
  status: 'available',
  observedCount: taskCount,
  exact: tasksExact,
  boardCount: responses.boards.data.items.length,
};

const sessionCapability = capabilities.data.capabilities['conversations.sessions.read'];
if (sessionCapability?.status === 'supported') {
  families.sessions = summarizeCollection(
    await getJson(CONTROL_PATHS.sessions, HermesSessionsResponseSchema),
  );
} else {
  families.sessions = unavailableCollection(sessionCapability);
}
const eventResponse = await getJson(CONTROL_PATHS.events, HermesEventsResponseSchema);
families.events = { ...summarizeCollection(eventResponse), pageLimit: 1 };

const afterDatabase = databaseInventory();
const afterContainer = containerState();
assert.equal(
  beforeDatabase.fingerprint,
  afterDatabase.fingerprint,
  'database state changed during inventory',
);
assert.deepEqual(
  beforeContainer,
  afterContainer,
  'adapter container state changed during inventory',
);

const report = {
  schemaVersion: HMI_PHASE1_SCHEMA,
  approvedWorkPackages: ['HMI-P1-W1', 'HMI-P1-W2', 'HMI-P1-W3', 'HMI-P1-W4', 'HMI-P1-W5'],
  target: {
    canonicalReference: APPROVED_TARGET.frameworkId,
    adapterContract: APPROVED_TARGET.adapterContract,
    frameworkRelease: APPROVED_TARGET.frameworkRelease,
    frameworkCommit: APPROVED_TARGET.frameworkCommit,
    transportClass: 'https-loopback',
  },
  transaction: beforeDatabase.transaction,
  registration: beforeDatabase.registration,
  databaseIsolation: beforeDatabase.isolation,
  identity: { runtime: identity.data.runtime, exactTarget: true },
  version: {
    release: version.data.release,
    commit: version.data.commit,
    dirty: version.data.dirty,
  },
  health: summarizeHealth(health),
  capabilities: summarizeCapabilities(capabilities),
  families,
  conversationDiagnosis: diagnoseConversations(health, capabilities),
  contractGaps: summarizeGaps(),
  noMutationEvidence: {
    databaseStateUnchanged: true,
    containerRestartStateUnchanged: true,
    transactionIdAssigned: beforeDatabase.transaction.transactionIdAssigned,
  },
  mutationPerformed: false,
  cursorAdvanced: false,
  ownerStorageInspected: false,
  redaction: {
    identifiersEmitted: false,
    itemFieldsEmitted: false,
    contentEmitted: false,
    secretReferencesEmitted: false,
    endpointsEmitted: false,
  },
};

assert.equal(report.transaction.readOnly, true);
assert.equal(report.transaction.isolation, 'repeatable read');
assert.equal(report.transaction.transactionIdAssigned, false);
assert.equal(report.registration.targetRows, 1);
assert.equal(report.registration.enabledTargetRows, 1);
assert.equal(report.registration.contractMatchRows, 1);
assert.equal(report.registration.releaseMatchRows, 1);
assert.equal(report.registration.commitMatchRows, 1);
assert.equal(report.conversationDiagnosis.classification, 'configuration-absent');
assertRedactedReport(report);

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `ALICA Hermes Phase 1: PASS target=${report.target.canonicalReference} ` +
      `release=${report.version.release} capabilities=${report.capabilities.total} ` +
      `profiles=${report.families.profiles.observedCount} providers=${report.families.providers.observedCount} ` +
      `models=${report.families.models.observedCount} conversation=${report.conversationDiagnosis.safeCode} ` +
      'redaction=verified mutation=false cursor=false',
  );
}

function databaseInventory() {
  const result = spawnSync(
    'docker',
    [
      'exec',
      APPROVED_TARGET.databaseContainer,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'unify',
      '-d',
      'unify',
      '-Atq',
      '-c',
      INVENTORY_SQL,
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error('read-only registration inventory failed');
  const line = result.stdout
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith('{'));
  if (!line) throw new Error('read-only registration inventory returned no report');
  return JSON.parse(line);
}

function containerState() {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{json .}}', APPROVED_TARGET.containerName],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error('adapter container inspection failed');
  const inspected = JSON.parse(result.stdout);
  const state = inspected.State;
  return {
    running: state.Running === true,
    restartCount: Number(inspected.RestartCount ?? 0),
    startedAt: String(state.StartedAt),
  };
}

function getJson(path, schema) {
  return new Promise((resolveRequest, rejectRequest) => {
    const url = new URL(path, baseUrl);
    const request = https.request(
      url,
      {
        method: 'GET',
        ca,
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        rejectUnauthorized: true,
        timeout: 8_000,
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) request.destroy(new Error('response exceeded 1 MiB'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            if (response.statusCode !== 200)
              throw new Error(`safe GET returned HTTP ${response.statusCode}`);
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!Value.Check(schema, value)) throw new Error('safe GET violated its frozen schema');
            resolveRequest(value);
          } catch (error) {
            rejectRequest(error);
          }
        });
      },
    );
    request.once('timeout', () => request.destroy(new Error('safe GET timed out')));
    request.once('error', rejectRequest);
    request.end();
  });
}
