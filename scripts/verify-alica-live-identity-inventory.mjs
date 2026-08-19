#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  APPROVED_DATASOURCE,
  INVENTORY_SQL,
  LIVE_IDENTITY_INVENTORY_SCHEMA,
  inventoryLiveIdentityContext,
} from './lib/alica-live-identity-inventory.mjs';

const forbiddenSql =
  /\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|call|do)\b/i;
assert.equal(
  forbiddenSql.test(INVENTORY_SQL),
  false,
  'inventory SQL contains a mutating statement',
);

const report = inventoryLiveIdentityContext();
assert.equal(report.schemaVersion, LIVE_IDENTITY_INVENTORY_SCHEMA);
assert.equal(report.operation, 'redacted-row-validation-inventory');
assert.equal(report.transaction.readOnly, true);
assert.equal(report.transaction.isolation, 'repeatable read');
assert.equal(report.transaction.transactionIdAssigned, false);
assert.equal(report.mutationPerformed, false);
assert.deepEqual(report.redaction, {
  identifiersEmitted: false,
  usernamesEmitted: false,
  credentialMaterialEmitted: false,
  connectionDetailsEmitted: false,
});
assert.equal(report.datasource.composeProject, APPROVED_DATASOURCE.composeProject);
assert.equal(report.datasource.composeService, APPROVED_DATASOURCE.composeService);
assert.equal(report.datasource.containerName, APPROVED_DATASOURCE.containerName);

for (const [key, value] of Object.entries(report.counts)) {
  assert.equal(Number.isSafeInteger(value) && value >= 0, true, `invalid count: ${key}`);
}
const rowCountBindings = {
  users: 'users',
  roles: 'roles',
  permissions: 'permissions',
  sessions: 'sessions',
  userRoleBindings: 'userRoleBindings',
  rolePermissionBindings: 'rolePermissionBindings',
  refreshTokens: 'refreshTokens',
  credentialRevocations: 'credentialRevocations',
  applicationRegistrations: 'applicationRegistrations',
  frameworkRegistrations: 'frameworkRegistrations',
};
let rowsChecked = 0;
for (const [family, validation] of Object.entries(report.rowValidation)) {
  assert.equal(
    validation.rowsChecked,
    report.counts[rowCountBindings[family]],
    `${family} row coverage mismatch`,
  );
  rowsChecked += validation.rowsChecked;
  for (const [key, value] of Object.entries(validation)) {
    assert.equal(
      Number.isSafeInteger(value) && value >= 0,
      true,
      `invalid row validation: ${family}.${key}`,
    );
    if (key !== 'rowsChecked') assert.equal(value, 0, `row anomaly: ${family}.${key}`);
  }
}
assert.equal(rowsChecked > 0, true, 'no rows were validated');
for (const [key, value] of Object.entries(report.legacyScopeCoverage)) {
  assert.equal(Number.isSafeInteger(value) && value >= 0, true, `invalid scope count: ${key}`);
}
for (const value of Object.values(report.targetStructures)) assert.equal(typeof value, 'boolean');

const serialized = JSON.stringify(report).toLowerCase();
for (const forbidden of [
  'password_hash',
  'token_hash',
  'csrf_hash',
  'credential_hash',
  'secret_reference',
  'database_url',
  'username_normalized',
  'redirect_uris',
]) {
  assert.equal(serialized.includes(forbidden), false, `sensitive field leaked: ${forbidden}`);
}

const writeProbe = spawnSync(
  'docker',
  [
    'exec',
    APPROVED_DATASOURCE.containerName,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    APPROVED_DATASOURCE.databaseUser,
    '-d',
    APPROVED_DATASOURCE.databaseName,
    '-Atq',
    '-c',
    'BEGIN TRANSACTION READ ONLY; CREATE TEMP TABLE alica_read_only_probe(id integer); ROLLBACK;',
  ],
  { encoding: 'utf8', timeout: 30_000 },
);
assert.notEqual(writeProbe.status, 0, 'write probe unexpectedly succeeded');
assert.match(
  `${writeProbe.stdout}\n${writeProbe.stderr}`,
  /cannot execute CREATE TABLE in a read-only transaction/,
);

assert.deepEqual(report.targetStructures, {
  tenants: false,
  principals: false,
  principalAliases: false,
  externalIdentityBindings: false,
  tenantMemberships: false,
  applicationGrants: false,
  managedProjections: false,
  explicitDenies: false,
});

console.log(
  `ALICA live identity inventory: PASS users=${report.counts.users} roles=${report.counts.roles} ` +
    `permissions=${report.counts.permissions} sessions=${report.counts.sessions} ` +
    `applications=${report.counts.applicationRegistrations} frameworks=${report.counts.frameworkRegistrations} ` +
    'transaction=read-only write-probe=rejected redaction=verified mutation=false',
);
