#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventoryLiveIdentityContext } from './lib/alica-live-identity-inventory.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const psiRoot = resolve(process.env.PSI_ROOT ?? '/srv/psi/repos/AliceClaw');
const manifest = JSON.parse(
  readFileSync(
    resolve(root, 'deploy/five-service/identity-tenancy-phase1-baseline.v1.json'),
    'utf8',
  ),
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

assert.equal(manifest.contractVersion, 'alica-identity-tenancy-phase1-baseline/v0.1');
assert.equal(manifest.workstream.programOrdinal, '11/13');
assert.equal(manifest.workstream.subprojectNumber, 6);
assert.deepEqual(manifest.workstream.dependencies, [1, 2, 5]);
assert.deepEqual(
  manifest.phaseSequence.map((phase) => phase.id),
  ['I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'],
);
assert.deepEqual(
  manifest.phaseSequence.map((phase) => phase.status),
  ['completed', 'completed', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'],
);
assert.deepEqual(manifest.terminal, {
  mutation: false,
  enforcement: false,
  credentialsRead: false,
  identifiersEmitted: false,
  phaseI0: 'passed',
  phaseI1: 'passed',
  nextGate:
    'I2 requires explicit approval of an executable additive migration and isolated rehearsal',
});

const implementationRevision = run('git', ['rev-parse', 'HEAD'], root);
run(
  'git',
  ['merge-base', '--is-ancestor', manifest.observed.unify.baselineRevision, implementationRevision],
  root,
);

const psiRevision = run('git', ['rev-parse', 'HEAD'], psiRoot);
assert.equal(psiRevision, manifest.observed.psi.revision);
assert.notEqual(
  run('git', ['status', '--short'], psiRoot),
  '',
  'PSI working tree unexpectedly clean',
);
for (const [relativePath, expectedDigest] of Object.entries(manifest.psiSourceDigests)) {
  assert.equal(
    digest(resolve(psiRoot, relativePath)),
    expectedDigest,
    `PSI source drift: ${relativePath}`,
  );
}

const auth = readFileSync(resolve(psiRoot, 'apps/backend-api/src/auth.ts'), 'utf8');
const authTypes = readFileSync(resolve(psiRoot, 'apps/backend-api/src/types.ts'), 'utf8');
const uprmIdentity = readFileSync(
  resolve(psiRoot, 'apps/backend-api/src/integrations/uprm/identity.ts'),
  'utf8',
);
const psiSchema = readFileSync(resolve(psiRoot, 'packages/db/src/schema.ts'), 'utf8');
assert.match(auth, /jwt\.sign/);
assert.match(authTypes, /sub: string;[\s\S]*email: string;[\s\S]*role: 'user'/);
assert.doesNotMatch(authTypes, /tenant(?:Id|_id)|instance(?:Id|_id)|principalId/);
assert.match(uprmIdentity, /externalUserId: input\.userId/);
assert.doesNotMatch(uprmIdentity, /issuer_normalized|source_version|fresh_until|principal_id/);
assert.equal(
  (psiSchema.match(/uuid\('user_id'\)/g) ?? []).length,
  manifest.observed.psi.userIdSchemaFields,
);
assert.equal(
  (psiSchema.match(/export const (?:vpsInstances|containerInstances) = pgTable/g) ?? []).length,
  manifest.observed.psi.instanceTableCount,
);
assert.doesNotMatch(
  psiSchema,
  /alica_tenants|alica_principals|tenant_memberships|instance_authorization/,
);

const live = inventoryLiveIdentityContext();
assert.equal(live.mutationPerformed, false);
assert.equal(live.transaction.readOnly, true);
assert.equal(live.counts.users, manifest.observed.unify.liveCounts.users);
assert.equal(live.counts.roles, manifest.observed.unify.liveCounts.roles);
assert.equal(live.counts.permissions, manifest.observed.unify.liveCounts.permissions);
assert.equal(live.counts.sessions >= manifest.observed.unify.liveCounts.sessionsAtLeast, true);
assert.equal(live.counts.applicationRegistrations, manifest.observed.unify.liveCounts.applications);
assert.equal(live.counts.frameworkRegistrations, manifest.observed.unify.liveCounts.frameworks);

const catalog = run(
  'docker',
  [
    'exec',
    'unify-postgres-1',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'unify',
    '-d',
    'unify',
    '-At',
    '-F',
    '|',
    '-c',
    `SELECT
       (SELECT count(*) FROM core.schema_migrations),
       (SELECT count(*) FROM information_schema.tables
        WHERE table_name IN (
          'alica_installation_identity','alica_tenants','alica_principals',
          'alica_principal_aliases','alica_external_identity_bindings',
          'alica_tenant_memberships','alica_registered_clients',
          'alica_tenant_client_grants','alica_principal_client_grants',
          'alica_managed_projection_state'
        ));`,
  ],
  root,
);
const [migrationCount, canonicalTableCount] = catalog.split('|').map(Number);
assert.equal(migrationCount, manifest.observed.unify.coreMigrations);
assert.equal(canonicalTableCount, manifest.observed.unify.canonicalIdentityTables);

console.log(
  JSON.stringify(
    {
      ok: true,
      contractVersion: manifest.contractVersion,
      workstream: `${manifest.workstream.subprojectNumber} (${manifest.workstream.programOrdinal})`,
      phases: manifest.phaseSequence.length,
      completedPhases: 2,
      unify: {
        baselineRevision: manifest.observed.unify.baselineRevision,
        implementationRevision,
        users: live.counts.users,
        roles: live.counts.roles,
        permissions: live.counts.permissions,
        sessions: live.counts.sessions,
        canonicalIdentityTables: canonicalTableCount,
      },
      psi: {
        revision: psiRevision,
        sourceFilesVerified: Object.keys(manifest.psiSourceDigests).length,
        userIdSchemaFields: manifest.observed.psi.userIdSchemaFields,
        instanceTables: manifest.observed.psi.instanceTableCount,
        tenantClaims: 0,
        instanceClaims: 0,
      },
      mutation: false,
      enforcement: false,
      secretOutput: false,
      nextGate: 'I2',
    },
    null,
    2,
  ),
);
