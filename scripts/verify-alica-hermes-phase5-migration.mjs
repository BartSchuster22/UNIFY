#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const phase5 = join(root, 'deploy/five-service/hermes-phase5');
const migrationPath = join(root, 'apps/core/migrations/012_alica_hermes_projection.sql');
const migration = readFileSync(migrationPath, 'utf8');
const down = readFileSync(join(phase5, '012_alica_hermes_projection.down.sql'), 'utf8');
const repair = readFileSync(join(phase5, '012_alica_hermes_projection.forward-repair.sql'), 'utf8');
const fixture = readFileSync(join(phase5, 'predecessor-fixture.sql'), 'utf8');
const assertions = readFileSync(join(phase5, 'rehearsal-assertions.sql'), 'utf8');

const migrations = readdirSync(join(root, 'apps/core/migrations'))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.deepEqual(
  migrations.map((name) => Number(name.slice(0, 3))),
  Array.from({ length: 12 }, (_, index) => index + 1),
);

const requiredTables = [
  'framework_types',
  'framework_instance_metadata',
  'framework_native_aliases',
  'framework_registrations',
  'agent_profile_projections',
  'product_agent_profile_bindings',
  'framework_capability_state',
  'framework_operations',
  'framework_executions',
  'framework_session_projections',
  'chat_framework_links',
  'framework_projection_state',
  'framework_event_stream_state',
  'framework_event_receipts',
  'framework_compatibility_edges',
  'framework_predecessor_holds',
  'framework_migration_evidence',
];
for (const table of requiredTables) {
  assert.match(migration, new RegExp(`CREATE TABLE core\\.${table}\\s*\\(`));
}

for (const token of [
  "core.generate_alica_id('agp')",
  "core.generate_alica_id('op')",
  "'CHAT_OWNERSHIP_UNRESOLVED'",
  "'RUN_CLASS_AMBIGUOUS'",
  "'IDENTITY_CONTEXT_MISSING'",
  "'PREDECESSOR_CURSOR_HELD'",
  "'core.profiles.id'",
  "'core.operations.id'",
  "'gateway.framework_registrations.id'",
  'ON DELETE RESTRICT',
]) {
  assert.ok(migration.includes(token), `missing migration invariant ${token}`);
}
assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
assert.doesNotMatch(
  migration,
  /\b(?:DROP|TRUNCATE)\s+(?:TABLE\s+)?(?:core\.)?(?:frameworks|profiles|operations|events|event_consumers|inbound_receipts|conversations|conversation_dispatches|work_runs)\b/i,
);
assert.doesNotMatch(
  migration,
  /\bUPDATE\s+core\.(?:frameworks|profiles|operations|events|event_consumers|inbound_receipts|conversations|conversation_dispatches|work_runs)\b/i,
);
assert.match(down, /ALICA_HERMES_FORWARD_REPAIR_REQUIRED/);
assert.match(down, /EXISTS \(SELECT 1 FROM core\.framework_native_aliases\)/);
assert.doesNotMatch(
  repair,
  /\bUPDATE\s+core\.framework_(?:native_aliases|operations|event_receipts)\b/i,
);
assert.match(repair, /WHERE NOT EXISTS/);
assert.match(fixture, /Synthetic, secret-free predecessor corpus/);
assert.match(assertions, /phase5_assertions=PASS/);

const runtimeRoots = [join(root, 'apps/core/src'), join(root, 'apps/gateway/src')];
for (const runtimeRoot of runtimeRoots) {
  const stack = [runtimeRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (
        entry.name.endsWith('.ts') &&
        !path.endsWith('database/migrations.ts') &&
        !path.endsWith('database/migrations.test.ts')
      ) {
        const source = readFileSync(path, 'utf8');
        for (const table of requiredTables.filter((name) => name !== 'framework_registrations')) {
          assert.ok(
            !source.includes(table),
            `runtime source imports Phase 5 table ${table}: ${path}`,
          );
        }
        assert.ok(
          !source.includes('core.framework_registrations'),
          `runtime source imports Phase 5 core.framework_registrations: ${path}`,
        );
      }
    }
  }
}

const artifactDigest = createHash('sha256')
  .update([migration, down, repair, fixture, assertions].join('\n-- artifact boundary --\n'))
  .digest('hex');
console.log(
  `ALICA Hermes Phase 5 static migration: PASS migrations=${migrations.length} targetTables=${requiredTables.length} runtimeHooks=0 liveTargets=0 artifactSha256=${artifactDigest}`,
);
