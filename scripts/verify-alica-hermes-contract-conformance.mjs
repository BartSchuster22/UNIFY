#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as contracts from '../packages/contracts/dist/index.js';
import {
  HMI_PHASE3_SCHEMA,
  HMI_PHASE3_TARGET,
  evaluateCommandFixture,
  evaluateEventFixture,
  evaluateReadFixture,
  findSensitiveField,
  summarizeFixtureResults,
} from './lib/alica-hermes-contract-conformance.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesPath = join(root, 'deploy/five-service/hermes-contract-conformance-fixtures.v1.json');
const tracked = [
  'deploy/five-service/hermes-contract-conformance-fixtures.v1.json',
  'scripts/generate-alica-hermes-contract-fixtures.mjs',
  'scripts/lib/alica-hermes-contract-conformance.mjs',
  'scripts/verify-alica-hermes-contract-conformance.mjs',
];

function digest(path) {
  return createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
}

function snapshot() {
  return Object.fromEntries(tracked.map((path) => [path, digest(path)]));
}

function expectedSubset(actual, expected, name) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `${name}: ${key}`);
  }
}

function schema(name) {
  const value = contracts[name];
  assert.ok(value && typeof value === 'object', `Unknown TypeBox schema reference: ${name}`);
  return value;
}

function runFixtures(document) {
  const results = [];
  for (const fixture of document.reads) {
    const result = evaluateReadFixture({ ...fixture, schema: schema(fixture.schema) });
    expectedSubset(result, fixture.expected, fixture.name);
    results.push({ family: 'read', name: fixture.name, ...result });
  }

  const ledgers = {};
  for (const fixture of document.commands) {
    const ledger = ledgers[fixture.ledgerGroup] ?? {};
    const result = evaluateCommandFixture({
      schema: schema(fixture.schema),
      command: fixture.command,
      context: fixture.context,
      ledger,
    });
    expectedSubset(result, fixture.expected, fixture.name);
    ledgers[fixture.ledgerGroup] = result.ledger;
    results.push({ family: 'command', name: fixture.name, ...result, ledger: undefined });
  }

  const eventStates = {};
  for (const fixture of document.events) {
    const group = fixture.context.stateGroup;
    const result = evaluateEventFixture({
      schema: schema(fixture.schema),
      response: fixture.response,
      context: { ...fixture.context, state: eventStates[group] },
    });
    expectedSubset(result, fixture.expected, fixture.name);
    eventStates[group] = result.state;
    results.push({ family: 'event', name: fixture.name, ...result, state: undefined });
  }
  return results;
}

const before = snapshot();
const fixtureDocument = JSON.parse(readFileSync(fixturesPath, 'utf8'));
assert.equal(fixtureDocument.schemaVersion, 'alica-hermes-contract-fixtures/v1');
assert.equal(fixtureDocument.contractVersion, HMI_PHASE3_TARGET.contractVersion);
assert.equal(fixtureDocument.projectionSchemaVersion, 'alica-hermes-projection-schema/v0.1');
assert.deepEqual(fixtureDocument.target, {
  frameworkId: HMI_PHASE3_TARGET.frameworkId,
  frameworkVersion: HMI_PHASE3_TARGET.frameworkVersion,
  frameworkCommit: HMI_PHASE3_TARGET.frameworkCommit,
});
assert.equal(fixtureDocument.mode, 'static-fixture-only');
assert.equal(fixtureDocument.mutationPerformed, false);
assert.equal(fixtureDocument.liveAccessPerformed, false);
assert.equal(fixtureDocument.ownerDispatchPerformed, false);
assert.equal(fixtureDocument.reads.length, 8);
assert.equal(fixtureDocument.commands.length, 14);
assert.equal(fixtureDocument.events.length, 15);
for (const name of fixtureDocument.schemaRefs) schema(name);

const first = runFixtures(fixtureDocument);
const second = runFixtures(fixtureDocument);
assert.deepEqual(first, second, 'fresh-state fixture runs must be deterministic');
assert.equal(first.length, 37);
const summary = summarizeFixtureResults(first);
assert.equal(summary.schemaVersion, HMI_PHASE3_SCHEMA);
assert.equal(summary.counts.accepted, 12);
assert.equal(summary.counts.rejected, 25);
assert.equal(summary.counts.ownerDispatch, 1);
assert.equal(summary.counts.replayed, 1);
assert.equal(summary.counts.held, 10);

for (const result of first) {
  if (!result.accepted) {
    assert.ok(result.safeError, `${result.name}: rejection must expose a schema-valid safe error`);
    assert.equal(
      findSensitiveField(result.safeError),
      null,
      `${result.name}: safe error leaked a secret`,
    );
  }
}
assert.equal(summary.reasons.CAPABILITY_UNSUPPORTED, 1);
assert.equal(summary.reasons.CAPABILITY_UNAVAILABLE, 1);
assert.equal(summary.reasons.CAPABILITY_FORBIDDEN, 1);
assert.equal(summary.reasons.IDEMPOTENT_REPLAY, 1);
assert.equal(summary.reasons.IDEMPOTENCY_CONFLICT, 1);
assert.equal(summary.reasons.SOURCE_VERSION_MISMATCH, 1);
assert.equal(summary.reasons.EVENT_DUPLICATE_CONFLICT, 1);
assert.equal(summary.reasons.EVENT_REORDER, 1);
assert.equal(summary.reasons.EVENT_GAP, 1);
assert.equal(summary.reasons.CURSOR_STALL, 2);
assert.equal(summary.reasons.EVENT_SOURCE_RESET, 1);
assert.equal(summary.reasons.SECOND_CONSUMER_FORBIDDEN, 1);
assert.equal(summary.reasons.SECRET_FIELD_DENIED, 3);

const librarySource = readFileSync(
  join(root, 'scripts/lib/alica-hermes-contract-conformance.mjs'),
  'utf8',
);
const verifierSource = readFileSync(
  join(root, 'scripts/verify-alica-hermes-contract-conformance.mjs'),
  'utf8',
);
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
  /buildHermesControlAdapter/u,
  /HermesNativeSource/u,
]) {
  assert.doesNotMatch(librarySource, forbidden, `library contains forbidden API ${forbidden}`);
}
for (const forbidden of [
  `node:${'child_' + 'process'}`,
  `node:${'http'}`,
  `node:${'https'}`,
  `${'write' + 'File'}(`,
  `${'append' + 'File'}(`,
  `${'fet' + 'ch'}(`,
  `${'.in' + 'ject'}(`,
  `${'.qu' + 'ery'}(`,
]) {
  assert.equal(
    verifierSource.includes(forbidden),
    false,
    `verifier contains forbidden API ${forbidden}`,
  );
}
for (const runtimeSource of [
  'apps/gateway/src/app.ts',
  'apps/core/src/index.ts',
  'apps/hermes-control-adapter/src/app.ts',
]) {
  assert.doesNotMatch(
    readFileSync(join(root, runtimeSource), 'utf8'),
    /alica-hermes-contract-conformance/u,
    `${runtimeSource}: Phase 3 harness must not be imported by runtime code`,
  );
}

assert.deepEqual(snapshot(), before, 'fixture verification must not mutate tracked evidence');
process.stdout.write(
  `ALICA Hermes Phase 3 conformance: PASS fixtures=${first.length} reads=${fixtureDocument.reads.length} commands=${fixtureDocument.commands.length} events=${fixtureDocument.events.length} accepted=${summary.counts.accepted} rejected=${summary.counts.rejected} held=${summary.counts.held} simulatedOwnerDispatch=${summary.counts.ownerDispatch} realOwnerDispatch=0 liveAccess=0 mutation=0\n`,
);
