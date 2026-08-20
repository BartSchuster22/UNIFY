#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(
  join(root, 'apps/core/migrations/018_alica_chat_hermes_integration.sql'),
  'utf8',
);
const isolation = readFileSync(
  join(root, 'scripts/verify-alica-hermes-phase8-isolation.sql'),
  'utf8',
);
const config = JSON.parse(
  readFileSync(join(root, 'deploy/five-service/hermes-phase8/chat-integration.v0.1.json'), 'utf8'),
);
const liveEvidence = JSON.parse(
  readFileSync(join(root, 'deploy/five-service/hermes-phase8/live-evidence.v1.json'), 'utf8'),
);
const migrationsSource = readFileSync(join(root, 'apps/core/src/database/migrations.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};
const includes = (text, value) => check(text.includes(value), `missing ${value}`);

check(
  readdirSync(join(root, 'apps/core/migrations')).filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .length === 18,
  'exactly 18 Core migrations required',
);
for (const table of [
  'chat_product_session_projections',
  'chat_link_authorization_receipts',
  'chat_framework_link_receipts',
  'chat_integration_faults',
]) {
  includes(migration, `CREATE TABLE core.${table}`);
  includes(migrationsSource, `'${table}'`);
}
for (const invariant of [
  'content_classification', // required concept is asserted through config below; schema must not replicate content
  "core.is_canonical_id(product_conversation_id, 'con')",
  "core.is_canonical_id(principal_id, 'prn')",
  "core.is_canonical_id(tenant_id, 'ten')",
  "core.is_canonical_id(client_id, 'cli')",
  "core.is_canonical_id(application_id, 'app')",
  "core.is_canonical_id(product_agent_id, 'agt')",
  'chat_framework_link_receipts_one_active',
  'owner_mutation_count = 0',
  'EXECUTE FUNCTION core.reject_mutation()',
  'REVOKE INSERT, UPDATE, DELETE, TRUNCATE',
]) {
  if (invariant === 'content_classification') continue;
  includes(migration, invariant);
}
check(!/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(migration), 'migration must be additive');
check(
  !/\bTRUNCATE\b(?!\s+ON)/i.test(
    migration.replaceAll('REVOKE INSERT, UPDATE, DELETE, TRUNCATE', ''),
  ),
  'migration must not truncate data',
);
check(!/DELETE\s+FROM/i.test(migration), 'migration must not delete data');
check(
  !/\b(message_content|message_body|attachment_content|prompt|tool_input|tool_output)\b/i.test(
    migration,
  ),
  'migration must not define content columns',
);
check(!/INSERT\s+INTO/i.test(migration), 'migration must not seed production rows');
for (const invariant of [
  'cross-tenant authorization unexpectedly accepted',
  'denied authorization unexpectedly linked',
  'second active link unexpectedly accepted',
  "EXCEPTION WHEN SQLSTATE '55000'",
  'fault owner mutation unexpectedly accepted',
  "'contentColumns'",
  'ROLLBACK;',
])
  includes(isolation, invariant);
check(config.schema === 'alica-chat-hermes-integration/v0.1', 'contract mismatch');
check(config.chatOwner.authority === 'chat.aquiero.com', 'CHAT authority mismatch');
check(config.chatOwner.owns.includes('messages'), 'CHAT message ownership missing');
check(
  config.hermesOwner.owns.includes('native-sessions'),
  'Hermes native session ownership missing',
);
check(
  config.projection.contentClassification === 'metadata-only',
  'projection must be metadata-only',
);
for (const forbidden of [
  'message-content',
  'attachments',
  'prompts',
  'tool-inputs',
  'tool-outputs',
  'provider-credentials',
  'model-credentials',
])
  check(config.projection.forbidden.includes(forbidden), `missing forbidden class ${forbidden}`);
check(
  config.realtime.durableEvents === 'sequenced-and-replayable',
  'durable replay contract missing',
);
check(
  config.realtime.ephemeralFrames === 'non-authoritative-not-persisted',
  'ephemeral frame contract missing',
);
check(config.deletion.hardCascade === false, 'hard cascade must be forbidden');
check(config.deletion.messageEvidenceRetained === true, 'message evidence retention required');
check(config.deployment.runtimeWriterDeployed === false, 'runtime writer unexpectedly authorized');
check(config.deployment.rawRouteExposed === false, 'raw route unexpectedly authorized');
check(
  config.deployment.productionChatMutationAuthorized === false,
  'production CHAT mutation unexpectedly authorized',
);
check(
  liveEvidence.chatOwner.commit === '5c4bdc0d29160af7874339b402ec6c0439025b0f',
  'CHAT commit evidence mismatch',
);
check(liveEvidence.liveCore.migration === 18, 'live migration evidence mismatch');
check(
  liveEvidence.liveCore.migrationSha256 ===
    'ccfec0a3a8c6ac0e47e0c3e1e055cb9707495569239b398953203702893a1653',
  'live migration checksum mismatch',
);
check(liveEvidence.liveCore.phase8Rows === 0, 'live Phase 8 rows must remain zero');
check(liveEvidence.liveCore.auditViolations === 0, 'live audit violations must remain zero');
check(liveEvidence.verification.ownerMutation === 0, 'owner mutation must remain zero');
check(liveEvidence.verification.runtimeHooks === 0, 'runtime hooks must remain zero');
check(liveEvidence.recovery.restoredMigrationCount === 17, 'recovery baseline mismatch');
check(liveEvidence.recovery.restoredPhase8Tables === 0, 'recovery Phase 8 table boundary mismatch');
check(liveEvidence.recovery.restoredAuditViolations === 0, 'recovery audit mismatch');
for (const [field, prefix] of [
  ['principalId', 'prn'],
  ['tenantId', 'ten'],
  ['clientId', 'cli'],
  ['applicationId', 'app'],
  ['productAgentId', 'agt'],
  ['agentProfileId', 'agp'],
]) {
  check(
    new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(config.scope[field]),
    `${field} is not canonical`,
  );
}
check(
  typeof packageJson.scripts['five-service:hermes-phase8:verify'] === 'string',
  'missing Phase 8 verifier script',
);
includes(packageJson.scripts.qa, 'five-service:hermes-phase8:verify');
console.log(`ALICA Hermes Phase 8 /CHAT integration verification: PASS (${checks} checks)`);
