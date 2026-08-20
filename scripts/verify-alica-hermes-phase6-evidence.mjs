#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(
  join(root, 'deploy/five-service/hermes-phase6/live-projection.sql'),
  'utf8',
);
const liveVerifier = readFileSync(
  join(root, 'scripts/verify-alica-hermes-phase6-live.mjs'),
  'utf8',
);
const backupScript = readFileSync(join(root, 'scripts/backup-gateway.sh'), 'utf8');
const evidenceText = readFileSync(
  join(root, 'evidence/alica-hermes-phase6-live-observation.json'),
  'utf8',
);
const evidence = JSON.parse(evidenceText);

assert.equal(evidence.schemaVersion, 'alica-hermes-live-read-observation/v0.1');
assert.equal(evidence.approvedRevision, '66b7196df1cb6f305706944a6b25fc0bdb08b49b');
assert.equal(evidence.target, 'unify-postgres-1/unify');
assert.equal(
  evidence.backup.sha256,
  '7442d8c98417b2b8ed7303ac9310971c5955bec491a5ae7b5df58818356047cc',
);
assert.equal(evidence.backup.restoreRehearsal, 'passed');
assert.deepEqual(evidence.projection.counts, {
  frameworks: 1,
  profiles: 6,
  aliases: 10,
  capabilities: 4,
  holds: 3,
  observations: 4,
  registrations: 0,
  operations: 0,
  executions: 0,
  sessions: 0,
  chatLinks: 0,
});
assert.equal(evidence.projection.ownerMatched, true);
assert.equal(evidence.projection.observedFresh, true);
assert.equal(evidence.degradation.conversations, 'unavailable');
assert.equal(evidence.degradation.sessionsPersisted, 0);
assert.equal(evidence.degradation.chatLinksPersisted, 0);
assert.equal(evidence.events.advertised, false);
assert.equal(evidence.events.ownerCursorBefore, evidence.events.ownerCursorAfter);
assert.equal(evidence.events.moved, false);
assert.equal(evidence.faults.staleClassified, true);
assert.equal(evidence.faults.unavailableClassified, true);
assert.equal(evidence.faults.ownerMutation, 0);
assert.equal(evidence.commandPathChanges, 0);
assert.equal(evidence.runtimeHooks, 0);
assert.equal(evidence.enforcementChanges, 0);

assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/im);
for (const forbidden of [
  'INSERT INTO core.framework_registrations',
  'INSERT INTO core.framework_operations',
  'INSERT INTO core.framework_executions',
  'INSERT INTO core.framework_session_projections',
  'INSERT INTO core.chat_framework_links',
  'INSERT INTO core.framework_event_receipts',
]) {
  assert.ok(!sql.includes(forbidden), `forbidden Phase 6 persistence: ${forbidden}`);
}
for (const required of [
  "'IDENTITY_CONTEXT_MISSING'",
  "'OWNER_CAPABILITY_UNADVERTISED'",
  "'CHAT_OWNERSHIP_UNRESOLVED'",
  "'profiles.read'",
  "'hermes.native-profile'",
  "'held'",
]) {
  assert.ok(sql.includes(required), `missing Phase 6 invariant: ${required}`);
}
assert.ok(!liveVerifier.includes('/control/v1/events'));
assert.ok(!liveVerifier.includes("method: 'POST'"));
assert.ok(!liveVerifier.includes("method: 'PUT'"));
assert.ok(!liveVerifier.includes("method: 'DELETE'"));
assert.ok(backupScript.includes('for candidate in unify-postgres postgres'));
assert.ok(backupScript.includes('DB_SERVICE=$candidate'));

const artifactDigest = createHash('sha256')
  .update([sql, liveVerifier, backupScript, evidenceText].join('\n-- phase6 boundary --\n'))
  .digest('hex');
console.log(
  `ALICA Hermes Phase 6 static evidence: PASS checks=41 profiles=6 ownerMatched=true cursorMoved=false ownerMutation=0 runtimeHooks=0 enforcementChanges=0 artifactSha256=${artifactDigest}`,
);
