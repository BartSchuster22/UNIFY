#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISION_SCHEMA,
  IDENTITY_SHADOW_CONTRACT,
  INVENTORY_SCHEMA,
  evaluateAuthorizationShadow,
  inspectIdentityAuthorizationContext,
} from './lib/alica-identity-shadow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesPath = join(root, 'deploy/five-service/identity-shadow-fixtures.v1.json');
const tracked = [
  'Dockerfile.gateway',
  'deploy/five-service/compose.yaml',
  'apps/gateway/src/app.ts',
  'apps/gateway/src/auth/service.ts',
  'apps/gateway/src/auth/types.ts',
  'apps/gateway/src/auth/postgres-store.ts',
  'apps/gateway/migrations/001_gateway_foundation.up.sql',
  'apps/core/src/auth/service.ts',
  'apps/core/src/auth/types.ts',
  'apps/core/migrations/002_identity_authorization.sql',
  'apps/core/migrations/006_authentication_runtime.sql',
  'deploy/five-service/identity-shadow-fixtures.v1.json',
  'scripts/lib/alica-identity-shadow.mjs',
  'deploy/five-service/identity-shadow.mjs',
];

function digest(path) {
  return createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
}

function snapshot() {
  return Object.fromEntries(tracked.map((path) => [path, digest(path)]));
}

const before = snapshot();
const inventory = inspectIdentityAuthorizationContext(root);
assert.equal(inventory.schemaVersion, INVENTORY_SCHEMA);
assert.equal(inventory.contractVersion, IDENTITY_SHADOW_CONTRACT);
assert.equal(inventory.mutationPerformed, false);
assert.equal(inventory.enforcementChanged, false);
assert.equal(inventory.runtime.fiveServiceAuthSurface, 'apps/gateway');
assert.equal(inventory.targetContext.principalBinding.state, 'absent');
assert.equal(inventory.targetContext.tenant.state, 'absent');
assert.equal(inventory.targetContext.applicationClient.state, 'catalog-only-not-bound');
assert.ok(inventory.currentAuthorization.staticPermissions.includes('frameworks.read'));
assert.ok(inventory.currentAuthorization.staticPermissions.includes('settings.manage'));
assert.ok(inventory.currentAuthorization.routePermissionCalls.length > 10);
assert.match(inventory.sourceVersion, /^sha256:[a-f0-9]{64}$/u);

const fixtureDocument = JSON.parse(readFileSync(fixturesPath, 'utf8'));
assert.equal(fixtureDocument.contractVersion, IDENTITY_SHADOW_CONTRACT);
assert.equal(fixtureDocument.fixtures.length, 8);
const comparisons = { matched: 0, tightened: 0, widened: 0 };
for (const fixture of fixtureDocument.fixtures) {
  const first = evaluateAuthorizationShadow(fixture.input);
  const second = evaluateAuthorizationShadow(fixture.input);
  assert.equal(first.schemaVersion, DECISION_SCHEMA, fixture.name);
  assert.equal(first.enforcementApplied, false, fixture.name);
  assert.equal(first.executionAuthorized, false, fixture.name);
  assert.deepEqual(first, second, `${fixture.name}: evaluator must be deterministic`);
  assert.deepEqual(
    { legacy: first.legacy, shadowTarget: first.shadowTarget, comparison: first.comparison },
    fixture.expected,
    fixture.name,
  );
  comparisons[first.comparison] += 1;
}
assert.equal(comparisons.widened, 0);
assert.ok(comparisons.matched > 0);
assert.ok(comparisons.tightened > 0);

for (const invalid of [
  null,
  {},
  { principalKind: 'unknown', legacy: {}, target: {} },
  {
    principalKind: 'user',
    legacy: {
      authenticated: 'yes',
      principalActive: true,
      passwordChangeRequired: false,
      permissionGranted: true,
      credentialScopeAllowed: true,
    },
    target: {},
  },
]) {
  assert.throws(() => evaluateAuthorizationShadow(invalid));
}

const librarySource = readFileSync(join(root, 'scripts/lib/alica-identity-shadow.mjs'), 'utf8');
const cliSource = readFileSync(join(root, 'deploy/five-service/identity-shadow.mjs'), 'utf8');
for (const forbidden of [
  /writeFile/u,
  /appendFile/u,
  /mkdir/u,
  /rename/u,
  /unlink/u,
  /child_process/u,
  /fetch\s*\(/u,
  /\.query\s*\(/u,
]) {
  assert.doesNotMatch(librarySource, forbidden);
  assert.doesNotMatch(cliSource, forbidden);
}
for (const runtimeSource of [
  'apps/gateway/src/app.ts',
  'apps/gateway/src/auth/service.ts',
  'apps/core/src/auth/http.ts',
  'apps/core/src/auth/service.ts',
]) {
  assert.doesNotMatch(readFileSync(join(root, runtimeSource), 'utf8'), /alica-identity-shadow/u);
}

const after = snapshot();
assert.deepEqual(after, before, 'inventory and evaluator must not mutate inspected evidence');
process.stdout.write(
  `ALICA identity shadow: PASS inventory=read-only fixtures=${fixtureDocument.fixtures.length} matched=${comparisons.matched} tightened=${comparisons.tightened} widened=${comparisons.widened} enforcement=false mutation=false\n`,
);
