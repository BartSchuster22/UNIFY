#!/usr/bin/env node
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHermesAuthorizationShadow } from './lib/alica-hermes-authorization-shadow.mjs';
import {
  IDENTITY_TENANCY_AUTHORIZATION_CONTRACT,
  evaluateIdentityTenancyAuthorization,
  managedProjectionSigningBody,
  projectionDigest,
  verifyManagedProjectionEnvelope,
} from './lib/alica-identity-tenancy-authorization.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shadow = JSON.parse(
  readFileSync(
    join(root, 'deploy/five-service/hermes-authorization-shadow-fixtures.v1.json'),
    'utf8',
  ),
);
assert.equal(IDENTITY_TENANCY_AUTHORIZATION_CONTRACT, 'alica-identity-tenancy-authorization/v0.1');
assert.equal(shadow.fixtures.length, 128);
const predecessorCounts = { matched: 0, tightened: 0, widened: 0 };
for (const fixture of shadow.fixtures) {
  const decision = evaluateHermesAuthorizationShadow(fixture.input);
  predecessorCounts[decision.comparison] += 1;
}
assert.deepEqual(predecessorCounts, { matched: 82, tightened: 46, widened: 0 });
const coverage = shadow.fixtures.filter((fixture) => fixture.name.startsWith('coverage:'));
assert.equal(coverage.length, 79);

const ids = {
  principal: 'prn_01M0FC3KKXD92Z74HGF1A87ZYQ',
  membership: 'mbr_01M0FC3KKXD92Z74HGF1A87ZYQ',
  tenant: 'ten_01M0FC3KKXD92Z74HGF1A87ZYQ',
  client: 'cli_01M0FC3KKXD92Z74HGF1A87ZYQ',
  instance: 'ins_01M0FC3KKXD92Z74HGF1A87ZYQ',
};
function context(capability) {
  return {
    tenantId: ids.tenant,
    capability,
    technicalPermission: true,
    entitlement: 'not-required',
    principal: { id: ids.principal, status: 'active' },
    membership: {
      id: ids.membership,
      principalId: ids.principal,
      tenantId: ids.tenant,
      status: 'active',
      fresh: true,
    },
    client: { id: ids.client, status: 'active' },
    tenantGrant: {
      tenantId: ids.tenant,
      clientId: ids.client,
      status: 'active',
      capabilities: [capability],
    },
    principalGrant: {
      membershipId: ids.membership,
      clientId: ids.client,
      status: 'active',
      capabilities: [capability],
    },
    instance: { id: ids.instance, tenantId: ids.tenant, status: 'active', fresh: true },
    instanceGrant: {
      membershipId: ids.membership,
      clientId: ids.client,
      instanceId: ids.instance,
      status: 'active',
      capabilities: [capability],
    },
  };
}
function clone(value) {
  return structuredClone(value);
}
const reasonCounts = new Map();
let decisions = 0;
function expect(input, effect, reasonCode) {
  const first = evaluateIdentityTenancyAuthorization(input);
  const second = evaluateIdentityTenancyAuthorization(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { effect, reasonCode });
  reasonCounts.set(reasonCode, (reasonCounts.get(reasonCode) ?? 0) + 1);
  decisions += 1;
}
for (const fixture of coverage) {
  const capability = fixture.input.surface.capability ?? fixture.input.surface.permission;
  const base = context(capability === 'dynamic' ? 'dynamic' : capability);
  expect(base, 'allow', 'AUTHORIZED');
  const wrongTenant = clone(base);
  wrongTenant.instance.tenantId = 'ten_01M0FC3KKXD92Z74HGF1A87ZYR';
  expect(wrongTenant, 'deny', 'INSTANCE_TENANT_MISMATCH');
  const wrongInstance = clone(base);
  wrongInstance.instanceGrant.instanceId = 'ins_01M0FC3KKXD92Z74HGF1A87ZYR';
  expect(wrongInstance, 'deny', 'INSTANCE_GRANT_MISMATCH');
  const inactiveMembership = clone(base);
  inactiveMembership.membership.status = 'suspended';
  expect(inactiveMembership, 'deny', 'MEMBERSHIP_INACTIVE');
  const staleMembership = clone(base);
  staleMembership.membership.fresh = false;
  expect(staleMembership, 'deny', 'MEMBERSHIP_STALE');
  const disabledClient = clone(base);
  disabledClient.client.status = 'disabled';
  expect(disabledClient, 'deny', 'CLIENT_INACTIVE');
  const revokedTenantGrant = clone(base);
  revokedTenantGrant.tenantGrant.status = 'revoked';
  expect(revokedTenantGrant, 'deny', 'TENANT_CLIENT_GRANT_DENIED');
  const revokedInstance = clone(base);
  revokedInstance.instanceGrant.status = 'revoked';
  expect(revokedInstance, 'deny', 'INSTANCE_GRANT_DENIED');
  const capabilityDenied = clone(base);
  capabilityDenied.instanceGrant.capabilities = [];
  expect(capabilityDenied, 'deny', 'CAPABILITY_DENIED');
  const entitlementOnly = clone(base);
  entitlementOnly.entitlement = 'granted';
  entitlementOnly.technicalPermission = false;
  expect(entitlementOnly, 'deny', 'TECHNICAL_PERMISSION_REQUIRED');
}
assert.equal(decisions, 790);
assert.equal(reasonCounts.get('AUTHORIZED'), 79);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const now = new Date('2026-08-20T16:00:00.000Z');
const envelope = {
  issuer: 'https://psi.aquiero.com',
  audienceCell: 'ins_01M0FC3KKXD92Z74HGF1A87ZYQ',
  tenantId: ids.tenant,
  projectionKind: 'instance-grant',
  sourceVersion: 2,
  messageId: 'msg-phase11-0001',
  issuedAt: '2026-08-20T15:59:00.000Z',
  expiresAt: '2026-08-20T16:05:00.000Z',
  payloadDigest: 'a'.repeat(64),
};
envelope.signature = sign(null, managedProjectionSigningBody(envelope), privateKey).toString(
  'base64url',
);
const projectionContext = {
  expectedIssuer: envelope.issuer,
  expectedCell: envelope.audienceCell,
  currentSourceVersion: 1,
  seenMessageIds: new Set(),
  now,
  publicKey,
};
const accepted = verifyManagedProjectionEnvelope(envelope, projectionContext);
assert.equal(accepted.effect, 'allow');
assert.equal(accepted.reasonCode, 'PROJECTION_ACCEPTED');
assert.match(projectionDigest(envelope), /^[a-f0-9]{64}$/u);
for (const [change, code] of [
  [{ audienceCell: 'ins_wrong' }, 'PROJECTION_AUDIENCE_MISMATCH'],
  [{ issuer: 'https://wrong.invalid' }, 'PROJECTION_ISSUER_MISMATCH'],
  [{ sourceVersion: 1 }, 'PROJECTION_REORDERED'],
  [{ expiresAt: '2026-08-20T15:59:59.000Z' }, 'PROJECTION_EXPIRED'],
  [{ signature: Buffer.alloc(64).toString('base64url') }, 'PROJECTION_SIGNATURE_INVALID'],
]) {
  assert.equal(
    verifyManagedProjectionEnvelope({ ...envelope, ...change }, projectionContext).reasonCode,
    code,
  );
}
assert.equal(
  verifyManagedProjectionEnvelope(envelope, {
    ...projectionContext,
    seenMessageIds: new Set([envelope.messageId]),
  }).reasonCode,
  'PROJECTION_REPLAYED',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      contractVersion: IDENTITY_TENANCY_AUTHORIZATION_CONTRACT,
      predecessorFixtures: 128,
      routeOperationSurfaces: 79,
      decisions,
      allows: 79,
      denies: 711,
      widened: 0,
      managedProjectionAccepted: true,
      managedProjectionNegativeCases: 6,
      secretMaterialPersisted: false,
      mutation: false,
      enforcement: false,
    },
    null,
    2,
  ),
);
