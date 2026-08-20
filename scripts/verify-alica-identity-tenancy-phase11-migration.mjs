#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(root, 'apps/core/migrations/023_alica_identity_tenancy_phase11.sql');
const deploy = join(root, 'deploy/five-service/identity-tenancy-phase11');
const migration = readFileSync(migrationPath, 'utf8');
const down = readFileSync(join(deploy, '023_alica_identity_tenancy_phase11.down.sql'), 'utf8');
const repair = readFileSync(
  join(deploy, '023_alica_identity_tenancy_phase11.forward-repair.sql'),
  'utf8',
);
const migrations = readdirSync(join(root, 'apps/core/migrations'))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
  .sort();
assert.deepEqual(
  migrations.map((name) => Number(name.slice(0, 3))),
  Array.from({ length: migrations.length }, (_, index) => index + 1),
);
assert.equal(migrations.at(-1), '023_alica_identity_tenancy_phase11.sql');
const tables = [
  'alica_tenants',
  'alica_installation_identity',
  'alica_principals',
  'alica_principal_aliases',
  'alica_external_identity_bindings',
  'alica_tenant_memberships',
  'alica_membership_role_bindings',
  'alica_registered_clients',
  'alica_tenant_client_grants',
  'alica_principal_client_grants',
  'alica_cell_instances',
  'alica_principal_instance_grants',
  'alica_managed_trust_anchors',
  'alica_managed_projection_state',
  'alica_identity_canary_policies',
  'alica_identity_phase_evidence',
];
for (const table of tables)
  assert.match(migration, new RegExp(`CREATE TABLE core\\.${table} \\(`, 'u'), table);
for (const invariant of [
  "core.is_canonical_id(tenant_id, 'ten')",
  "core.is_canonical_id(principal_id, 'prn')",
  "core.is_canonical_id(instance_id, 'ins')",
  "'gateway-user-uuid'",
  "'psi-user-uuid'",
  'ON DELETE RESTRICT',
  'TECHNICAL_PERMISSION_REQUIRED',
  'ENTITLEMENT_DENIED',
  'enabled boolean NOT NULL DEFAULT false CHECK (NOT enabled)',
  'secret_material_persisted boolean NOT NULL CHECK (NOT secret_material_persisted)',
])
  assert.ok(migration.includes(invariant), `missing invariant: ${invariant}`);
assert.doesNotMatch(migration, /ON DELETE CASCADE/iu);
assert.doesNotMatch(
  migration,
  /\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:public\.)?(?:users|sessions|roles|permissions|user_roles|role_permissions|application_registrations)\b/iu,
);
assert.match(down, /ALICA_IDENTITY_FORWARD_REPAIR_REQUIRED/u);
assert.match(repair, /WHERE NOT EXISTS|IF NOT EXISTS/u);
assert.doesNotMatch(repair, /\b(?:UPDATE|DELETE|TRUNCATE)\s+core\.alica_/iu);
for (const runtimeRoot of [join(root, 'apps/core/src'), join(root, 'apps/gateway/src')]) {
  const stack = [runtimeRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith('.ts') && !path.endsWith('database/migrations.ts')) {
        const source = readFileSync(path, 'utf8');
        for (const table of tables)
          assert.ok(!source.includes(`core.${table}`), `runtime reader found: ${path} → ${table}`);
      }
    }
  }
}
const artifactDigest = createHash('sha256')
  .update([migration, down, repair].join('\n-- artifact boundary --\n'))
  .digest('hex');
console.log(
  `ALICA Identity Phase 11 static migration: PASS migrations=${migrations.length} tables=${tables.length} runtimeReaders=0 predecessorMutations=0 artifactSha256=${artifactDigest}`,
);
