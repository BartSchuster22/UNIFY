#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(
  root,
  'apps/core/migrations/013_alica_hermes_governed_command_canary.sql',
);
const repairPath = join(
  root,
  'apps/core/migrations/014_phase7_immutable_evidence_forward_repair.sql',
);
const transportRecoveryPath = join(
  root,
  'apps/core/migrations/015_phase7_pre_owner_transport_recovery.sql',
);
const postOwnerReconciliationPath = join(
  root,
  'apps/core/migrations/016_phase7_post_owner_create_reconciliation.sql',
);
const postOwnerDeleteReconciliationPath = join(
  root,
  'apps/core/migrations/017_phase7_post_owner_delete_reconciliation.sql',
);
const configPath = join(root, 'deploy/five-service/hermes-phase7/canary-policy.v1.json');
const runnerPath = join(root, 'scripts/run-alica-hermes-phase7-canary.mjs');
const evidencePath = join(root, 'evidence/alica-hermes-phase7-live-canary.json');
const preLive = process.argv.includes('--pre-live');
const migration = readFileSync(migrationPath, 'utf8');
const repair = readFileSync(repairPath, 'utf8');
const transportRecovery = readFileSync(transportRecoveryPath, 'utf8');
const postOwnerReconciliation = readFileSync(postOwnerReconciliationPath, 'utf8');
const postOwnerDeleteReconciliation = readFileSync(postOwnerDeleteReconciliationPath, 'utf8');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const runner = readFileSync(runnerPath, 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};
const includes = (text, needle, label = needle) => check(text.includes(needle), `missing ${label}`);

const migrationNames = readdirSync(join(root, 'apps/core/migrations'))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
check(migrationNames.length >= 17, 'Phase 7 requires the original 17 Core migrations');
check(
  migrationNames.slice(0, 17).every((name, index) => Number(name.slice(0, 3)) === index + 1),
  'Phase 7 requires a contiguous ordered migration prefix 001-017',
);
check(
  migrationNames[16] === '017_phase7_post_owner_delete_reconciliation.sql',
  'Phase 7 migration prefix must end with the approved migration 017',
);
for (const table of [
  'core.framework_command_canary_policies',
  'core.framework_command_canary_reservations',
  'core.framework_command_canary_faults',
])
  includes(migration, `CREATE TABLE ${table}`);
for (const fn of [
  'core.reserve_phase7_canary_command',
  'core.start_phase7_canary_dispatch',
  'core.complete_phase7_canary_dispatch',
  'core.record_phase7_canary_fault',
  'core.disable_phase7_canary',
]) {
  includes(migration, `FUNCTION ${fn}`);
  includes(migration, `REVOKE EXECUTE ON FUNCTION ${fn}`);
}
for (const invariant of [
  'dispatch_limit = 2',
  'failure_threshold = 2',
  "allowed_operations = ARRAY['profile.create','profile.delete']",
  'P7_PROVENANCE_MISMATCH',
  'P7_SOURCE_VERSION_MISMATCH',
  'P7_IDEMPOTENCY_CONFLICT',
  'P7_DISPATCH_LIMIT',
  'authorization_state, state',
  "'authorized', 'authorized'",
  'retention_policy_key',
  "'phase7-canary-evidence/v1'",
  "state='completed'",
  "'succeeded'",
])
  includes(migration, invariant);
check(!/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(migration), 'migration must be additive');
check(!/\bTRUNCATE\b/i.test(migration), 'migration must not truncate');
check(!/DELETE\s+FROM/i.test(migration), 'migration must not delete');
check(
  !/INSERT\s+INTO\s+core\.framework_command_canary_policies/i.test(migration),
  'migration must not enable or seed a policy',
);
includes(repair, 'ALTER COLUMN canonical_operation_id DROP NOT NULL');
includes(repair, 'core.cancel_phase7_canary_reservation');
includes(repair, 'core.rearm_phase7_canary');
includes(repair, 'canonical_operation_id IS NOT NULL');
includes(repair, "'completed'");
includes(repair, "'succeeded'");
check(
  !repair.includes("UPDATE core.framework_operations SET state='dispatched'"),
  'forward repair must not mutate canonical operation evidence',
);
check(!/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(repair), 'repair must preserve tables');
includes(transportRecovery, 'core.recover_phase7_pre_owner_transport_failure');
includes(transportRecovery, 'dispatch_count=dispatch_count-1');
includes(transportRecovery, "'P7_ADAPTER_CONNECTION_TERMINATED'");
includes(transportRecovery, "'ownerDispatchCount',0");
check(
  !/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(transportRecovery),
  'transport recovery must preserve tables',
);
includes(postOwnerReconciliation, 'core.reconcile_phase7_post_owner_create');
includes(postOwnerReconciliation, "'reconciled:P7_PROFILE_LIST_WIDTH_PARSER'");
includes(postOwnerReconciliation, 'core.complete_phase7_canary_dispatch');
check(
  !/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(postOwnerReconciliation),
  'post-owner reconciliation must preserve tables',
);
includes(postOwnerDeleteReconciliation, 'core.reconcile_phase7_post_owner_delete');
includes(postOwnerDeleteReconciliation, "'reconciled:P7_BOUNDED_DELETE_TIMEOUT'");
includes(postOwnerDeleteReconciliation, 'core.complete_phase7_canary_dispatch');
check(
  !/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(postOwnerDeleteReconciliation),
  'post-owner delete reconciliation must preserve tables',
);

check(config.schema === 'alica-hermes-governed-command-canary/v0.1', 'contract mismatch');
check(config.owner.frameworkId === 'hermes-main', 'owner framework mismatch');
check(config.owner.instanceId === 'herman-local-private', 'owner instance mismatch');
check(config.owner.capability === 'profiles.execute', 'capability mismatch');
check(config.scope.contextNativeProfileId === 'default', 'context profile mismatch');
check(config.scope.nativeTargetId === 'alica-p7-canary', 'target mismatch');
check(
  JSON.stringify(config.allowedOperations) === JSON.stringify(['profile.create', 'profile.delete']),
  'operation allowlist mismatch',
);
check(config.limits.dispatchLimit === 2, 'dispatch limit mismatch');
check(config.limits.failureThreshold === 2, 'failure threshold mismatch');
check(config.baseline.profileIds.length === 6, 'baseline profile count mismatch');
check(config.baseline.sourceVersion.startsWith('sha256:'), 'baseline source version missing');
for (const [field, prefix] of [
  ['policyId', 'cny'],
  ['frameworkId', 'frm'],
  ['contextAgentProfileId', 'agp'],
  ['targetAgentProfileId', 'agp'],
  ['controllerServicePrincipalId', 'svc'],
  ['canonicalPrincipalId', 'prn'],
  ['tenantId', 'ten'],
  ['clientId', 'cli'],
  ['applicationId', 'app'],
])
  check(
    new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(config.scope[field]),
    `${field} is not canonical`,
  );

for (const invariant of [
  '--preflight',
  '--seed',
  '--repair-preflight',
  '--recover-transport',
  '--reconcile-created',
  '--resume-rollback',
  '--reconcile-deleted',
  '--canary',
  '--faults',
  '--reconcile-faults',
  '--disable',
  'reserve_phase7_canary_command',
  'start_phase7_canary_dispatch',
  'complete_phase7_canary_dispatch',
  'record_phase7_canary_fault',
  'disable_phase7_canary',
  'cancel_phase7_canary_reservation',
  'rearm_phase7_canary',
  'recover_phase7_pre_owner_transport_failure',
  'reconcile_phase7_post_owner_create',
  'reconcile_phase7_post_owner_delete',
  'P7_IDEMPOTENCY_CONFLICT',
  'P7_PROVENANCE_MISMATCH',
  "'https://127.0.0.1:9/control/v1/commands/profiles'",
  'ownerStateRestored: true',
  'commandRunnerDeployed: false',
  'rawRouteExposed: false',
])
  includes(runner, invariant);
check(!runner.includes('console.log(token'), 'runner must never print token');
check(!runner.includes('writeFileSync(token'), 'runner must never write token');
check(!runner.includes('process.env.DATABASE_URL'), 'runner must pin container/database/role');
for (const name of [
  'five-service:hermes-phase7:verify',
  'five-service:hermes-phase7:preflight',
  'five-service:hermes-phase7:seed',
  'five-service:hermes-phase7:repair-preflight',
  'five-service:hermes-phase7:recover-transport',
  'five-service:hermes-phase7:reconcile-created',
  'five-service:hermes-phase7:resume-rollback',
  'five-service:hermes-phase7:reconcile-deleted',
  'five-service:hermes-phase7:canary',
  'five-service:hermes-phase7:faults',
  'five-service:hermes-phase7:reconcile-faults',
  'five-service:hermes-phase7:disable',
])
  check(typeof packageJson.scripts[name] === 'string', `missing package script ${name}`);
includes(packageJson.scripts.qa, 'five-service:hermes-phase7:verify');

if (!preLive) {
  check(existsSync(evidencePath), 'live evidence is required');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  check(evidence.schema === config.schema, 'evidence contract mismatch');
  check(evidence.policy.policyId === config.scope.policyId, 'evidence policy mismatch');
  check(evidence.phases.seed.passed === true, 'seed evidence failed');
  check(evidence.phases.forwardRepair.passed === true, 'forward repair evidence failed');
  check(evidence.phases.forwardRepair.ownerDispatchCount === 0, 'blocked preflight reached owner');
  check(evidence.phases.transportRecovery.passed === true, 'transport recovery evidence failed');
  check(
    evidence.phases.transportRecovery.ownerDispatchCount === 0,
    'transport failure reached owner',
  );
  check(
    evidence.phases.transportRecovery.provisionalDispatchLeaseReturned === true,
    'provisional dispatch lease was not returned',
  );
  check(evidence.phases.parserRepair.passed === true, 'parser repair evidence failed');
  check(
    evidence.phases.parserRepair.ownerCreateCompleted === true,
    'owner create was not reconciled',
  );
  check(
    evidence.phases.parserRepair.adapterParserFixedAndRedeployed === true,
    'adapter parser was not repaired',
  );
  check(
    evidence.phases.deleteReconciliation.passed === true,
    'delete reconciliation evidence failed',
  );
  check(
    evidence.phases.deleteReconciliation.ownerDeleteCompleted === true,
    'owner delete was not reconciled',
  );
  check(
    evidence.phases.deleteReconciliation.nativeTargetAbsent === true,
    'native target remains after rollback',
  );
  check(evidence.phases.canary.passed === true, 'canary evidence failed');
  check(evidence.phases.canary.validate.ownerMutation === 0, 'validate mutated owner');
  check(evidence.phases.canary.dryRun.ownerMutation === 0, 'dry-run mutated owner');
  check(evidence.phases.canary.duplicate.replayedWithoutOwner === true, 'duplicate replay failed');
  check(evidence.phases.canary.rollback.ownerStateRestored === true, 'rollback failed');
  check(evidence.phases.faults.passed === true, 'fault evidence failed');
  check(evidence.phases.faults.ownerDispatches === 0, 'faults dispatched owner command');
  check(evidence.phases.disable.enabled === false, 'policy remains enabled');
  check(evidence.phases.disable.circuitState === 'disabled', 'policy not disabled');
  check(evidence.phases.disable.dispatchCount === 2, 'unexpected dispatch count');
  check(evidence.phases.disable.reservations === 4, 'reservation count mismatch');
  check(evidence.phases.disable.faultEvidenceRows === 6, 'fault evidence count mismatch');
  check(evidence.phases.disable.canonicalOperations === 3, 'canonical operation count mismatch');
  check(evidence.phases.disable.canonicalExecutions === 2, 'canonical execution count mismatch');
  check(evidence.phases.disable.sessions === 0, 'session scope changed');
  check(evidence.phases.disable.chatLinks === 0, '/CHAT scope changed');
  check(evidence.result.passed === true, 'Phase 7 result failed');
  check(evidence.result.ownerStateRestored === true, 'owner state not restored');
  check(evidence.result.policyDisabled === true, 'command policy enabled');
  check(evidence.result.commandRunnerDeployed === false, 'runner unexpectedly deployed');
  check(evidence.result.rawRouteExposed === false, 'raw route unexpectedly exposed');
  check(evidence.result.phase8Authorized === false, 'Phase 8 unexpectedly authorized');
}

console.log(
  `ALICA Hermes Phase 7 canary verification: PASS (${checks} checks, ${preLive ? 'pre-live' : 'live evidence'})`,
);
