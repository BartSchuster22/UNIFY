#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HermesConversationOperationSchema,
  HermesModelManagementOperationSchema,
  HermesProfileOperationSchema,
  HermesWorkOperationSchema,
} from '../packages/contracts/dist/index.js';
import {
  HERMES_AUTHORIZATION_SHADOW_CONTRACT,
  HERMES_AUTHORIZATION_SHADOW_DECISION,
  HERMES_AUTHORIZATION_SURFACE,
  evaluateHermesAuthorizationShadow,
  inspectHermesAuthorizationSurface,
} from './lib/alica-hermes-authorization-shadow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = 'deploy/five-service/hermes-authorization-shadow-fixtures.v1.json';
const tracked = [
  'apps/gateway/src/app.ts',
  'apps/gateway/src/mutations/types.ts',
  'apps/hermes-control-adapter/src/app.ts',
  'packages/contracts/src/hermes-control.ts',
  fixturePath,
  'scripts/generate-alica-hermes-authorization-shadow-fixtures.mjs',
  'scripts/lib/alica-hermes-authorization-shadow.mjs',
  'scripts/verify-alica-hermes-authorization-shadow.mjs',
];
const read = (path) => readFileSync(join(root, path), 'utf8');
const digest = (path) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
const snapshot = () => Object.fromEntries(tracked.map((path) => [path, digest(path)]));
const schemas = {
  profile: HermesProfileOperationSchema,
  model: HermesModelManagementOperationSchema,
  work: HermesWorkOperationSchema,
  conversation: HermesConversationOperationSchema,
};

function inventory() {
  return inspectHermesAuthorizationSurface({
    gatewaySource: read('apps/gateway/src/app.ts'),
    adapterSource: read('apps/hermes-control-adapter/src/app.ts'),
    mutationDefinitionsSource: read('apps/gateway/src/mutations/types.ts'),
    schemas,
  });
}

const before = snapshot();
const surface = inventory();
assert.equal(surface.schemaVersion, HERMES_AUTHORIZATION_SURFACE);
assert.equal(surface.contractVersion, HERMES_AUTHORIZATION_SHADOW_CONTRACT);
assert.equal(surface.gatewayRoutes.length, 29);
assert.equal(surface.adapterRoutes.length, 19);
assert.equal(surface.operations.length, 31);
assert.equal(surface.catalog.length, 79);
assert.deepEqual(surface.dynamicPermissionExpressions, ['mutations.permission(input)']);
assert.equal(surface.mutationPerformed, false);
assert.equal(surface.enforcementChanged, false);
assert.match(surface.sourceVersion, /^sha256:[a-f0-9]{64}$/u);

const document = JSON.parse(read(fixturePath));
assert.equal(document.contractVersion, HERMES_AUTHORIZATION_SHADOW_CONTRACT);
assert.equal(document.sourceVersion, surface.sourceVersion);
assert.deepEqual(document.inventory, {
  gatewayRoutes: 29,
  adapterRoutes: 19,
  operations: 31,
  dynamicPermissionExpressions: ['mutations.permission(input)'],
});
assert.deepEqual(document.boundary, {
  mode: 'shadow-only',
  enforcementApplied: false,
  executionAuthorized: false,
  liveAccess: false,
  mutationPerformed: false,
});
assert.equal(document.fixtures.length, 128);

const coverageNames = new Set(
  document.fixtures.filter((item) => item.name.startsWith('coverage:')).map((item) => item.name),
);
assert.equal(coverageNames.size, 79);
for (const item of surface.catalog)
  assert.ok(coverageNames.has(`coverage:${item.key}`), `Missing coverage fixture: ${item.key}`);

const operationCoverage = document.fixtures.filter((item) =>
  item.name.startsWith('coverage:operation:'),
);
assert.equal(operationCoverage.length, 31);
assert.deepEqual(
  operationCoverage.map((item) => item.input.surface.operation).sort(),
  surface.operations.map((item) => item.operation).sort(),
);

const counts = { matched: 0, tightened: 0, widened: 0, allow: 0, deny: 0 };
const reasonCodes = new Set();
for (const item of document.fixtures) {
  const first = evaluateHermesAuthorizationShadow(item.input);
  const second = evaluateHermesAuthorizationShadow(item.input);
  assert.equal(first.schemaVersion, HERMES_AUTHORIZATION_SHADOW_DECISION, item.name);
  assert.equal(first.contractVersion, HERMES_AUTHORIZATION_SHADOW_CONTRACT, item.name);
  assert.equal(first.enforcementApplied, false, item.name);
  assert.equal(first.executionAuthorized, false, item.name);
  assert.equal(first.mutationPerformed, false, item.name);
  assert.deepEqual(first, second, `${item.name}: evaluator is not deterministic`);
  assert.deepEqual(
    {
      predecessor: first.predecessor,
      shadowTarget: first.shadowTarget,
      comparison: first.comparison,
    },
    item.expected,
    item.name,
  );
  counts[first.comparison] += 1;
  counts[first.shadowTarget.effect] += 1;
  reasonCodes.add(first.shadowTarget.reasonCode);
}
assert.deepEqual(counts, { matched: 82, tightened: 46, widened: 0, allow: 78, deny: 50 });

for (const reason of [
  'AUTHENTICATION_REQUIRED',
  'PRINCIPAL_BINDING_MISSING',
  'AUTHENTICATION_STALE',
  'STEP_UP_REQUIRED',
  'TENANT_CONTEXT_MISSING',
  'TENANT_INACTIVE',
  'MEMBERSHIP_INACTIVE',
  'MEMBERSHIP_STALE',
  'CLIENT_CONTEXT_MISSING',
  'CLIENT_INACTIVE',
  'TENANT_CLIENT_GRANT_DENIED',
  'PRINCIPAL_CLIENT_GRANT_DENIED',
  'RESOURCE_CONTEXT_MISSING',
  'FRAMEWORK_SCOPE_MISMATCH',
  'TENANT_SCOPE_MISMATCH',
  'RESOURCE_GRANT_DENIED',
  'COLLECTION_FILTER_MISSING',
  'FRAMEWORK_REGISTRATION_INACTIVE',
  'FRAMEWORK_REGISTRATION_UNVERIFIED',
  'FRAMEWORK_COMPATIBILITY_DENIED',
  'FRAMEWORK_AVAILABILITY_DENIED',
  'ADAPTER_SCOPE_DENIED',
  'CAPABILITY_UNKNOWN',
  'CAPABILITY_MISMATCH',
  'CAPABILITY_UNSUPPORTED',
  'CAPABILITY_UNAVAILABLE',
  'CAPABILITY_FORBIDDEN',
  'CAPABILITY_MODE_DENIED',
  'CAPABILITY_UNADVERTISED',
  'EXPLICIT_DENY',
  'PROJECTION_STALE',
  'APPROVAL_REQUIRED',
  'AGENT_DELEGATION_INACTIVE',
  'AGENT_TENANT_MISMATCH',
  'AGENT_CLIENT_MISMATCH',
  'AGENT_PRINCIPAL_MISMATCH',
  'AGENT_CAPABILITY_CEILING',
  'AGENT_FRAMEWORK_MISMATCH',
  'CHAT_LINK_MISSING',
  'CHAT_ACCESS_DENIED',
  'CHAT_TENANT_MISMATCH',
  'CHAT_CLIENT_MISMATCH',
  'CHAT_FRAMEWORK_MISMATCH',
  'CHAT_NATIVE_LINK_MISMATCH',
]) {
  assert.ok(reasonCodes.has(reason), `Missing reason-code fixture: ${reason}`);
}

const eventTightenings = document.fixtures.filter(
  (item) => item.expected.shadowTarget.reasonCode === 'CAPABILITY_UNADVERTISED',
);
assert.equal(eventTightenings.length, 2);
assert.ok(eventTightenings.every((item) => item.input.surface.path.endsWith('/events')));
const agentAllow = document.fixtures.find(
  (item) => item.name === 'delegation:product-agent-chat-message-allow',
);
assert.equal(agentAllow?.expected.shadowTarget.effect, 'allow');
assert.equal(agentAllow?.input.target.delegation.kind, 'product-agent');
assert.ok(agentAllow?.input.target.chat.conversationId.startsWith('con_'));
const rawIsolation = document.fixtures.find(
  (item) => item.name === 'deny:chat-access-does-not-grant-raw-hermes',
);
assert.equal(rawIsolation?.expected.shadowTarget.reasonCode, 'RESOURCE_GRANT_DENIED');

for (const invalid of [
  null,
  {},
  { surface: {}, predecessor: {}, target: {} },
  {
    surface: {},
    predecessor: {
      authenticated: 'yes',
      principalActive: true,
      permissionGranted: true,
      adapterScopeAllowed: true,
    },
    target: {},
  },
]) {
  assert.throws(() => evaluateHermesAuthorizationShadow(invalid));
}

const librarySource = read('scripts/lib/alica-hermes-authorization-shadow.mjs');
for (const forbidden of [
  /writeFile/u,
  /appendFile/u,
  /mkdir/u,
  /rename\s*\(/u,
  /unlink/u,
  /child_process/u,
  /fetch\s*\(/u,
  /https?:\/\//u,
  /\.query\s*\(/u,
  /\.inject\s*\(/u,
  /beginTransaction/u,
  /ownerDispatch/u,
]) {
  assert.doesNotMatch(librarySource, forbidden);
}
for (const runtimeSource of [
  'apps/gateway/src/app.ts',
  'apps/gateway/src/mutations/service.ts',
  'apps/hermes-control-adapter/src/app.ts',
  'apps/hermes-control-adapter/src/server.ts',
]) {
  assert.doesNotMatch(read(runtimeSource), /alica-hermes-authorization-shadow/u);
}
assert.deepEqual(inventory(), surface, 'surface inventory is not deterministic');
assert.deepEqual(snapshot(), before, 'Phase 4 verifier mutated tracked evidence');

process.stdout.write(
  `ALICA Hermes Phase 4 authorization shadow: PASS fixtures=${document.fixtures.length} gatewayRoutes=${surface.gatewayRoutes.length} adapterRoutes=${surface.adapterRoutes.length} operations=${surface.operations.length} matched=${counts.matched} tightened=${counts.tightened} widened=${counts.widened} shadowAllows=${counts.allow} shadowDenies=${counts.deny} eventCapabilityGaps=${eventTightenings.length} enforcement=false executionAuthorized=false liveAccess=0 mutation=0\n`,
);
