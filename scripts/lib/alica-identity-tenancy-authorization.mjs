import { createHash, verify as verifySignature } from 'node:crypto';

export const IDENTITY_TENANCY_AUTHORIZATION_CONTRACT = 'alica-identity-tenancy-authorization/v0.1';

function deny(reasonCode) {
  return { effect: 'deny', reasonCode };
}

export function evaluateIdentityTenancyAuthorization(input) {
  if (!input || typeof input !== 'object') throw new TypeError('authorization input is required');
  const { principal, membership, client, tenantGrant, principalGrant, instance, instanceGrant } =
    input;
  if (!principal?.id?.startsWith('prn_')) return deny('PRINCIPAL_BINDING_MISSING');
  if (principal.status !== 'active') return deny('PRINCIPAL_INACTIVE');
  if (!membership?.id?.startsWith('mbr_')) return deny('MEMBERSHIP_MISSING');
  if (membership.principalId !== principal.id) return deny('MEMBERSHIP_PRINCIPAL_MISMATCH');
  if (membership.tenantId !== input.tenantId) return deny('MEMBERSHIP_TENANT_MISMATCH');
  if (membership.status !== 'active') return deny('MEMBERSHIP_INACTIVE');
  if (!membership.fresh) return deny('MEMBERSHIP_STALE');
  if (!client?.id?.startsWith('cli_')) return deny('CLIENT_CONTEXT_MISSING');
  if (client.status !== 'active') return deny('CLIENT_INACTIVE');
  if (tenantGrant?.tenantId !== input.tenantId || tenantGrant.clientId !== client.id)
    return deny('TENANT_CLIENT_GRANT_MISMATCH');
  if (tenantGrant.status !== 'active') return deny('TENANT_CLIENT_GRANT_DENIED');
  if (principalGrant?.membershipId !== membership.id || principalGrant.clientId !== client.id)
    return deny('PRINCIPAL_CLIENT_GRANT_MISMATCH');
  if (principalGrant.status !== 'active') return deny('PRINCIPAL_CLIENT_GRANT_DENIED');
  if (!instance?.id?.startsWith('ins_')) return deny('INSTANCE_CONTEXT_MISSING');
  if (instance.tenantId !== input.tenantId) return deny('INSTANCE_TENANT_MISMATCH');
  if (instance.status !== 'active') return deny('INSTANCE_INACTIVE');
  if (!instance.fresh) return deny('INSTANCE_STALE');
  if (
    instanceGrant?.membershipId !== membership.id ||
    instanceGrant.clientId !== client.id ||
    instanceGrant.instanceId !== instance.id
  )
    return deny('INSTANCE_GRANT_MISMATCH');
  if (instanceGrant.status !== 'active') return deny('INSTANCE_GRANT_DENIED');
  const capability = input.capability;
  if (typeof capability !== 'string' || !capability) return deny('CAPABILITY_MISSING');
  for (const ceiling of [
    tenantGrant.capabilities,
    principalGrant.capabilities,
    instanceGrant.capabilities,
  ]) {
    if (!Array.isArray(ceiling) || !ceiling.includes(capability)) return deny('CAPABILITY_DENIED');
  }
  if (input.entitlement === 'denied') return deny('ENTITLEMENT_DENIED');
  if (input.entitlement === 'granted' && input.technicalPermission !== true)
    return deny('TECHNICAL_PERMISSION_REQUIRED');
  if (input.technicalPermission !== true) return deny('TECHNICAL_PERMISSION_REQUIRED');
  return { effect: 'allow', reasonCode: 'AUTHORIZED' };
}

function canonicalProjectionBody(envelope) {
  return JSON.stringify({
    audienceCell: envelope.audienceCell,
    expiresAt: envelope.expiresAt,
    issuedAt: envelope.issuedAt,
    issuer: envelope.issuer,
    messageId: envelope.messageId,
    payloadDigest: envelope.payloadDigest,
    projectionKind: envelope.projectionKind,
    sourceVersion: envelope.sourceVersion,
    tenantId: envelope.tenantId,
  });
}

export function projectionDigest(envelope) {
  return createHash('sha256').update(canonicalProjectionBody(envelope)).digest('hex');
}

export function verifyManagedProjectionEnvelope(envelope, context) {
  if (!envelope || !context) throw new TypeError('projection envelope and context are required');
  if (envelope.issuer !== context.expectedIssuer) return deny('PROJECTION_ISSUER_MISMATCH');
  if (envelope.audienceCell !== context.expectedCell) return deny('PROJECTION_AUDIENCE_MISMATCH');
  if (
    !Number.isInteger(envelope.sourceVersion) ||
    envelope.sourceVersion <= context.currentSourceVersion
  )
    return deny('PROJECTION_REORDERED');
  if (context.seenMessageIds.has(envelope.messageId)) return deny('PROJECTION_REPLAYED');
  const now = context.now.getTime();
  if (Date.parse(envelope.issuedAt) > now || Date.parse(envelope.expiresAt) <= now)
    return deny('PROJECTION_EXPIRED');
  if (!/^[a-f0-9]{64}$/u.test(envelope.payloadDigest)) return deny('PROJECTION_DIGEST_INVALID');
  let valid = false;
  try {
    valid = verifySignature(
      null,
      Buffer.from(canonicalProjectionBody(envelope)),
      context.publicKey,
      Buffer.from(envelope.signature, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return deny('PROJECTION_SIGNATURE_INVALID');
  return {
    effect: 'allow',
    reasonCode: 'PROJECTION_ACCEPTED',
    payloadDigest: envelope.payloadDigest,
    sourceVersion: envelope.sourceVersion,
  };
}

export function managedProjectionSigningBody(envelope) {
  return Buffer.from(canonicalProjectionBody(envelope));
}
